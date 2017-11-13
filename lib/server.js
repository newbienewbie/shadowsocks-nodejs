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
const {ServerTcpRelay}=require('./tcp-relay');


let connections=0;

function createTcpRelayServer(server_ip,server_port,key,method,timeout){

    const server = net.createServer(function (connection) {

        var encryptor = new Encryptor(key, method);
        const x=new ServerTcpRelay(timeout,encryptor);
        x.on('afterbind',_=>connections+=1);
        x.on('afterclean',_=>connections-=1);
        x.bindLocalConnection(connection);
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
