/*
  Copyright (c) 2014 clowwindy
  
  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:
  
  The above copyright notice and this permission notice shall be included in
  all copies or substantial portions of the Software.
  
  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.
 */

const net = require("net");
const fs = require("fs");
const path = require("path");
const udpRelay = require("./udprelay");
const utils = require("./utils");
const inet = require("./inet");
const Encryptor = require("./encrypt").Encryptor;



let connections=0;
function createTcpRelayServer(server_ip,server_port,key,method,timeout){

    const server = net.createServer(function (connection) {

        connections += 1;

        var encryptor = new Encryptor(key, method);
        /*
            as sslocal:
            stage 0 auth METHOD received from local, reply with selection message
            stage 1 addr received from local, query DNS for remote
            stage 2 UDP assoc
            stage 3 DNS resolved, connect to remote
            stage 4 still connecting, more data from local received
            stage 5 remote connected, piping local and remote
            
            as ssserver:
            stage 0 just jump to stage 1
            stage 1 addr received from local, query DNS for remote
            stage 3 DNS resolved, connect to remote
            stage 4 still connecting, more data from local received
            stage 5 remote connected, piping local and remote
        */
        var stage = 0;
        var headerLength = 0;
        var remote = null;
        var cachedPieces = [];
        var addrLen = 0;
        var remoteAddr = null;
        var remotePort = null;
        utils.debug("connections: " + connections);

        function clean() {
            utils.debug("clean");
            connections -= 1;
            remote = null;
            connection = null;
            encryptor = null;
            return utils.debug("connections: " + connections);
        };

        connection.on("data", function (data) {
            utils.log(utils.EVERYTHING, "connection on data");
            try {
                data = encryptor.decrypt(data);
            }
            catch (e) {
                utils.error(e);
                if (remote) { remote.destroy(); }
                if (connection) { connection.destroy(); }
                return;
            }

            if (stage === 5) {
                if (!remote.write(data)) {
                    connection.pause();
                }
                return;
            }


            if (stage === 0) {
                try {
                    var addrtype = data[0];
                    if (addrtype === void 0) {
                        return;
                    }
                    if (addrtype === 3) {
                        addrLen = data[1];
                    } else if (addrtype !== 1 && addrtype !== 4) {
                        utils.error("unsupported addrtype: " + addrtype + " maybe wrong password");
                        connection.destroy();
                        return;
                    }
                    if (addrtype === 1) {
                        remoteAddr = utils.inetNtoa(data.slice(1, 5));
                        remotePort = data.readUInt16BE(5);
                        headerLength = 7;
                    } else if (addrtype === 4) {
                        remoteAddr = inet.inet_ntop(data.slice(1, 17));
                        remotePort = data.readUInt16BE(17);
                        headerLength = 19;
                    } else {
                        remoteAddr = data.slice(2, 2 + addrLen).toString("binary");
                        remotePort = data.readUInt16BE(2 + addrLen);
                        headerLength = 2 + addrLen + 2;
                    }
                    connection.pause();
                    // 连接远程服务器
                    remote = net.connect(remotePort, remoteAddr, function () {
                        utils.info("connecting " + remoteAddr + ":" + remotePort);
                        if (!encryptor || !remote || !connection) {
                            if (remote) { remote.destroy(); }
                            return;
                        }
                        connection.resume();
                        let i=0;
                        while (i < cachedPieces.length) {
                            remote.write(cachedPieces[i] );
                            i++;
                        }
                        cachedPieces = null;
                        remote.setTimeout(timeout, function () {
                            utils.debug("remote on timeout during connect()");
                            if (remote) { remote.destroy(); }
                            if (connection) { return connection.destroy(); }
                        });
                        stage = 5;
                        return utils.debug("stage = 5");
                    });
                    // 收到数据后就加密，然后写回到和客户端之间的连接
                    remote.on("data", function (data) {
                        utils.log(utils.EVERYTHING, "remote on data");
                        if (!encryptor) {
                            if (remote) { remote.destroy(); }
                            return;
                        }
                        data = encryptor.encrypt(data);
                        if (!connection.write(data)) {
                            return remote.pause();
                        }
                    });
                    remote.on("end", function () {
                        utils.debug("remote on end");
                        if (connection) { return connection.end(); }
                    });
                    remote.on("error", function (e) {
                        utils.debug("remote on error");
                        return utils.error("remote " + remoteAddr + ":" + remotePort + " error: " + e);
                    });
                    remote.on("close", function (had_error) {
                        utils.debug("remote on close:" + had_error);
                        if (had_error) {
                            if (connection) { return connection.destroy(); }
                        } else {
                            if (connection) { return connection.end(); }
                        }
                    });
                    remote.on("drain", function () {
                        utils.debug("remote on drain");
                        if (connection) {
                            return connection.resume();
                        }
                    });
                    // 设置超时
                    remote.setTimeout(15 * 1000, function () {
                        utils.debug("remote on timeout during connect()");
                        if (remote) { remote.destroy(); }
                        if (connection) { return connection.destroy(); }
                    });
                    if (data.length > headerLength) {
                        let buf = new Buffer(data.length - headerLength);
                        data.copy(buf, 0, headerLength);
                        cachedPieces.push(buf);
                        buf = null;
                    }
                    stage = 4;
                    return utils.debug("stage = 4");
                } catch (error) {
                    e = error;
                    utils.error(e);
                    connection.destroy();
                    if (remote) {
                        return remote.destroy();
                    }
                }
            } else {
                if (stage === 4) { return cachedPieces.push(data); }
            }
        });
        connection.on("end", function () {
            utils.debug("connection on end");
            if (remote) { return remote.end(); }
        });
        connection.on("error", function (e) {
            utils.debug("connection on error");
            return utils.error("local error: " + e);
        });
        connection.on("close", function (had_error) {
            utils.debug("connection on close:" + had_error);
            if (had_error) {
                if (remote) { remote.destroy(); }
            } else {
                if (remote) { remote.end(); }
            }
            return clean();
        });
        connection.on("drain", function () {
            utils.debug("connection on drain");
            if (remote) { return remote.resume(); }
        });
        return connection.setTimeout(timeout, function () {
            utils.debug("connection on timeout");
            if (remote) { remote.destroy(); }
            if (connection) { return connection.destroy(); }
        });
    });
    server.listen(server_port, server_ip, function () {
        return utils.info("server listening at " + server_ip + ":" + server_port + " ");
    });

    server.on("error", function (e) {
        if (e.code === "EADDRINUSE") {
            utils.error("Address in use, aborting");
        } else {
            utils.error(e);
        }
        return process.stdout.on('drain', function () {
            return process.exit(1);
        });
    });
    return server;
}

function main () {

    // initialize conections
    connections = 0;

    console.log(utils.version);

    const config = utils.parseConfig(true);
    const timeout = Math.floor(config.timeout * 1000) || 300000;
    const {method,server,server_port,password}= config;
    // portPassword is sth like { port: key }
    let portPassword = config.port_password;

    if (!(server && (server_port || portPassword) && password)) {
        utils.warn('config.json not found, you have to specify all config in commandline');
        process.exit(1);
    }

    if (portPassword) {
        if (server_port || password) {
            utils.warn('warning: port_password should not be used with server_port and password. server_port and password will be ignored');
        }
    } else {
        portPassword = {};
        portPassword[server_port.toString()] = password;
    }

    let servers = server;
    if (!(servers instanceof Array)) {
        servers = [server];
    }

    /**
     * 以下的各个闭包函数只对 servers、method、timeout 形成闭包
     */
    return Object.keys(portPassword).map(port=>{
        const key = portPassword[port];
        return servers.map(server_ip=>{
            utils.info("calculating ciphers for port " + port);
            const server = createTcpRelayServer(server_ip,port,key,method,timeout);
            server.listen(port, server_ip, function () {
                return utils.info("tcp server listening at " + server_ip + ":" + port + " ");
            });
            udpRelay.createServer(server_ip, port, null, null, key, method, timeout, false);
            server.on("error", function (e) {
                if (e.code === "EADDRINUSE") {
                    utils.error("Address in use, aborting");
                } else {
                    utils.error(e);
                }
                return process.stdout.on('drain', function () {
                    return process.exit(1);
                });
            });
            return server;
        });

    });

};


module.exports={main};
