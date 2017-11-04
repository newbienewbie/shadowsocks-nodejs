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
const utils = require('./utils');
const inet = require('./inet');
const Encryptor = require("./encrypt").Encryptor;


var connections = 0;

function createServer(serverAddr, serverPort, port, key, method, timeout, local_address="127.0.0.1") {

    const udpServer = udpRelay.createServer(local_address, port, serverAddr, serverPort, key, method, timeout, true);

    const getServer = function () {
        var aPort, aServer, r;
        aPort = serverPort;
        aServer = serverAddr;
        if (serverPort instanceof Array) {
            aPort = serverPort[Math.floor(Math.random() * serverPort.length)];
        }
        if (serverAddr instanceof Array) {
            aServer = serverAddr[Math.floor(Math.random() * serverAddr.length)];
        }
        r = /^([^:]*)\:(\d+)$/.exec(aServer);
        if (r != null) {
            aServer = r[1];
            aPort = +r[2];
        }
        return [aServer, aPort];
    };

    const server = net.createServer(function (connection) {
        var addrLen, addrToSend,  connected, encryptor, headerLength, remote, remoteAddr, remotePort, stage;
        connections += 1;
        connected = true;
        encryptor = new Encryptor(key, method);
        stage = 0;
        headerLength = 0;
        remote = null;
        addrLen = 0;
        remoteAddr = null;
        remotePort = null;
        addrToSend = "";
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
            var aPort, aServer, addrToSendBuf, addrtype, buf, cmd, e, piece, ref, reply, tempBuf;
            utils.log(utils.EVERYTHING, "connection on data");
            if (stage === 5) {
                data = encryptor.encrypt(data);
                if (!remote.write(data)) {
                    connection.pause();
                }
                return;
            }
            if (stage === 0) {
                tempBuf = new Buffer(2);
                tempBuf.write("\u0005\u0000", 0);
                connection.write(tempBuf);
                stage = 1;
                utils.debug("stage = 1");
                return;
            }
            if (stage === 1) {
                try {
                    cmd = data[1];
                    addrtype = data[3];
                    if (cmd === 1) {

                    } else if (cmd === 3) {
                        utils.info("UDP assc request from " + connection.localAddress + ":" + connection.localPort);
                        reply = new Buffer(10);
                        reply.write("\u0005\u0000\u0000\u0001", 0, 4, "binary");
                        utils.debug(connection.localAddress);
                        utils.inetAton(connection.localAddress).copy(reply, 4);
                        reply.writeUInt16BE(connection.localPort, 8);
                        connection.write(reply);
                        stage = 10;
                    } else {
                        utils.error("unsupported cmd: " + cmd);
                        reply = new Buffer("\u0005\u0007\u0000\u0001", "binary");
                        connection.end(reply);
                        return;
                    }
                    if (addrtype === 3) {
                        addrLen = data[4];
                    } else if (addrtype !== 1 && addrtype !== 4) {
                        utils.error("unsupported addrtype: " + addrtype);
                        connection.destroy();
                        return;
                    }
                    addrToSend = data.slice(3, 4).toString("binary");
                    if (addrtype === 1) {
                        remoteAddr = utils.inetNtoa(data.slice(4, 8));
                        addrToSend += data.slice(4, 10).toString("binary");
                        remotePort = data.readUInt16BE(8);
                        headerLength = 10;
                    } else if (addrtype === 4) {
                        remoteAddr = inet.inet_ntop(data.slice(4, 20));
                        addrToSend += data.slice(4, 22).toString("binary");
                        remotePort = data.readUInt16BE(20);
                        headerLength = 22;
                    } else {
                        remoteAddr = data.slice(5, 5 + addrLen).toString("binary");
                        addrToSend += data.slice(4, 5 + addrLen + 2).toString("binary");
                        remotePort = data.readUInt16BE(5 + addrLen);
                        headerLength = 5 + addrLen + 2;
                    }
                    if (cmd === 3) {
                        utils.info("UDP assc: " + remoteAddr + ":" + remotePort);
                        return;
                    }
                    buf = new Buffer(10);
                    buf.write("\u0005\u0000\u0000\u0001", 0, 4, "binary");
                    buf.write("\u0000\u0000\u0000\u0000", 4, 4, "binary");
                    buf.writeInt16BE(2222, 8);
                    connection.write(buf);
                    ref = getServer(), aServer = ref[0], aPort = ref[1];
                    utils.info("connecting " + aServer + ":" + aPort);
                    remote = net.connect(aPort, aServer, function () {
                        if (remote) {
                            remote.setNoDelay(true);
                        }
                        stage = 5;
                        return utils.debug("stage = 5");
                    });
                    remote.on("data", function (data) {
                        var e;
                        if (!connected) {
                            return;
                        }
                        utils.log(utils.EVERYTHING, "remote on data");
                        try {
                            if (encryptor) {
                                data = encryptor.decrypt(data);
                                if (!connection.write(data)) {
                                    return remote.pause();
                                }
                            } else {
                                return remote.destroy();
                            }
                        } catch (error) {
                            e = error;
                            utils.error(e);
                            if (remote) {
                                remote.destroy();
                            }
                            if (connection) {
                                return connection.destroy();
                            }
                        }
                    });
                    remote.on("end", function () {
                        utils.debug("remote on end");
                        if (connection) {
                            return connection.end();
                        }
                    });
                    remote.on("error", function (e) {
                        utils.debug("remote on error");
                        return utils.error("remote " + remoteAddr + ":" + remotePort + " error: " + e);
                    });
                    remote.on("close", function (had_error) {
                        utils.debug("remote on close:" + had_error);
                        if (had_error) {
                            if (connection) {
                                return connection.destroy();
                            }
                        } else {
                            if (connection) {
                                return connection.end();
                            }
                        }
                    });
                    remote.on("drain", function () {
                        utils.debug("remote on drain");
                        if (connection) {
                            return connection.resume();
                        }
                    });
                    remote.setTimeout(timeout, function () {
                        utils.debug("remote on timeout");
                        if (remote) {
                            remote.destroy();
                        }
                        if (connection) {
                            return connection.destroy();
                        }
                    });
                    addrToSendBuf = new Buffer(addrToSend, "binary");
                    addrToSendBuf = encryptor.encrypt(addrToSendBuf);
                    remote.setNoDelay(false);
                    remote.write(addrToSendBuf);
                    if (data.length > headerLength) {
                        buf = new Buffer(data.length - headerLength);
                        data.copy(buf, 0, headerLength);
                        piece = encryptor.encrypt(buf);
                        remote.write(piece);
                    }
                    stage = 4;
                    return utils.debug("stage = 4");
                } catch (error) {
                    e = error;
                    utils.error(e);
                    if (connection) {
                        connection.destroy();
                    }
                    if (remote) {
                        remote.destroy();
                    }
                    return clean();
                }
            } 
            else if (stage === 4) {
                if (remote == null) {
                    if (connection) {
                        connection.destroy();
                    }
                    return;
                }
                data = encryptor.encrypt(data);
                remote.setNoDelay(true);
                if (!remote.write(data)) {
                    return connection.pause();
                }
            }
        });
        connection.on("end", function () {
            connected = false;
            utils.debug("connection on end");
            if (remote) {
                return remote.end();
            }
        });
        connection.on("error", function (e) {
            utils.debug("connection on error");
            return utils.error("local error: " + e);
        });
        connection.on("close", function (had_error) {
            connected = false;
            utils.debug("connection on close:" + had_error);
            if (had_error) {
                if (remote) {
                    remote.destroy();
                }
            } else {
                if (remote) {
                    remote.end();
                }
            }
            return clean();
        });
        connection.on("drain", function () {
            utils.debug("connection on drain");
            if (remote && stage === 5) {
                return remote.resume();
            }
        });
        return connection.setTimeout(timeout, function () {
            utils.debug("connection on timeout");
            if (remote) {
                remote.destroy();
            }
            if (connection) {
                return connection.destroy();
            }
        });
    });

    if (local_address != null) {
        server.listen(port, local_address, function () {
            return utils.info("local listening at " + (server.address().address) + ":" + port);
        });
    } 
    else {
        server.listen(port, function () {
            return utils.info("local listening at 0.0.0.0:" + port);
        });
    }

    server.on("error", function (e) {
        if (e.code === "EADDRINUSE") {
            return utils.error("Address in use, aborting");
        } else {
            return utils.error(e);
        }
    });
    server.on("close", function () {
        return udpServer.close();
    });
    return server;
}


function parseConfig(){
    console.log(utils.version);
    configFromArgs = utils.parseArgs();

    let config={};
    // default config path
    let configPath = 'config.json';

    if (configFromArgs.config_file) {
        configPath = configFromArgs.config_file;
    }

    // `configPath` will reference the predifined config file when the given path config file not found
    if (!fs.existsSync(configPath)) {
        configPath = path.resolve(__dirname, "config.json");
        if (!fs.existsSync(configPath)) {
            configPath = path.resolve(__dirname, "../../config.json");
            if (!fs.existsSync(configPath)) {
                configPath = null;
            }
        }
    }

    if (configPath) {
        utils.info('loading config from ' + configPath);
        const configContent = fs.readFileSync(configPath);
        try {
            config = JSON.parse(configContent);
        } catch (e) {
            utils.error('found an error in config.json: ' + e.message);
            process.exit(1);
        }
    } 

    for (let k in configFromArgs) {
        config[k] =configFromArgs[k];
    }

    if (config.verbose) {
        utils.config(utils.DEBUG);
    }
    utils.checkConfig(config);

    return config;
}

function main() {
    console.log(utils.version);

    const config=parseConfig();
    const {server,server_port,local_address,local_port,password,method} = config;
    const timeout = Math.floor(config.timeout * 1000) || 600000;

    if (!(server && server_port && local_port && password)) {
        utils.warn('config.json not found, you have to specify all config in commandline');
        process.exit(1);
    }
    const s = createServer(server, server_port, local_port, password, method, timeout, local_address);
    s.on("error", function (e) {
        return process.stdout.on('drain', function () {
            return process.exit(1);
        });
    });
    return s;
}


module.exports = {
    createServer,
    main,
};
