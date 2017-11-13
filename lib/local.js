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
const {LocalTcpRelay}=require('./tcp-relay');


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

    const ref=getServer();

    const server = net.createServer(function (connection) {
        const encryptor=new Encryptor(key,method);
        const x=new LocalTcpRelay(ref[0],ref[1],timeout,encryptor);
        x.on('afterbind',_=>connections+=1);
        x.on('afterclean',_=>connections-=1);
        x.bindLocalConnection(connection);
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


function main() {
    console.log(utils.version);
    const config=utils.parseConfig(false);
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
