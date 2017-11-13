const EventEmitter=require('events');
const net = require("net");
const fs = require("fs");
const path = require("path");
const utils = require('../utils');
const inet = require('../inet');
const {TcpRelay}=require('./tcp-relay');


class LocalTcpRelay extends TcpRelay {

    constructor(shadowSocksServerAddr,shadowSocksServerPort,timeout,encryptor) {
        super(timeout,encryptor);
        // ss server addr,port 
        this.shadowSocksServerAddr=shadowSocksServerAddr;
        this.shadowSocksServerPort=shadowSocksServerPort;
    }


    createRemoteConnection(addr,port){
        utils.info(`connecting ${addr}: ${port}`);
        this.remoteConnection = net.connect(port,addr,()=>{
            if (this.remoteConnection) {
                this.remoteConnection.setNoDelay(true);
            }
            return this.setStage(5);
        });
        // call this.onXxx() in a stupid manner because the eventEmitter of Socket will bind `this` to `socket`
        this.remoteConnection.on("data",(d)=> this.onRemoteConnectionData(d));
        this.remoteConnection.on("end", ()=>this.onRemoteConnectionEnd());
        this.remoteConnection.on("error", (e)=>this.onRemoteConnectionError(e));
        this.remoteConnection.on("close", (e)=>this.onRemoteConnectionClose(e));
        this.remoteConnection.on("drain", ()=>this.onRemoteConnectionDrain());
        this.remoteConnection.setTimeout(this.timeout, ()=>this.onRemoteConnectionTimeout());
        return ;
    }

    /**
     * more data from local connection
     * @param {*} data 
     */
    _stage4(data){
        if (this.remoteConnection == null) {
            if (this.localConnection) {
                this.localConnection.destroy();
            }
            return;
        }
        this.remoteConnection.setNoDelay(true);
        this.pipeLocalToRemote(data);
    }

    _stage1(data){
        try {
            /*
                # +----+-----+-------+------+----------+----------+
                # |VER | CMD |  RSV  | ATYP | DST.ADDR | DST.PORT |
                # +----+-----+-------+------+----------+----------+
                # | 1  |  1  | X'00' |  1   | Variable |    2     |
                # +----+-----+-------+------+----------+----------+
            */
            const cmd = data[1];
            const addrtype = data[3];
            let reply;
            // tcp
            if (cmd === 1) {
            } 
            // udp
            else if (cmd === 3) {
                // client request: <version=0x05> <CMD=0x03> <RSV=0x00> <ATYP=0x01> <DST.ADDR> <DST.PORT>
                // sslocal reply : <version=0x05> <REP=0x00> <RSV=0x00> <ATYP=0x01> <DST.ADDR> <DST.PORT>
                utils.info(`UDP assc request from ${this.localConnection.localAddress} : ${this.localConnection.localPort}`);
                reply = Buffer.alloc(10);
                reply.write("\u0005\u0000\u0000\u0001", 0, 4, "binary");
                utils.debug(this.localConnection.localAddress);
                utils.inetAton(this.localConnection.localAddress).copy(reply, 4);
                reply.writeUInt16BE(this.localConnection.localPort, 8);
                this.localConnection.write(reply);
                this.stage = 10;
            } 
            else {
                utils.error("unsupported cmd: " + cmd);
                reply =Buffer.from("\u0005\u0007\u0000\u0001", "binary");
                this.localConnection.end(reply);
                return;
            }

            let addrLen ;
            if (addrtype === 3) {
                addrLen = data[4];
            } 
            else if (addrtype !== 1 && addrtype !== 4) {
                utils.error("unsupported addrtype: " + addrtype);
                this.localConnection.destroy();
                return;
            }

            var headerLength=0;
            var addrToSend = data.slice(3, 4).toString("binary");
            // IPv4
            if (addrtype === 1) {
                this.remoteAddr = utils.inetNtoa(data.slice(4, 8));
                addrToSend += data.slice(4, 10).toString("binary");
                this.remotePort = data.readUInt16BE(8);
                headerLength = 10;
            } 
            // IPv6
            else if (addrtype === 4) {
                this.remoteAddr = inet.inet_ntop(data.slice(4, 20));
                addrToSend += data.slice(4, 22).toString("binary");
                this.remotePort = data.readUInt16BE(20);
                headerLength = 22;
            }
            // <Length><DomainName>
            else {
                this.remoteAddr = data.slice(5, 5 + addrLen).toString("binary");
                addrToSend += data.slice(4, 5 + addrLen + 2).toString("binary");
                this.remotePort = data.readUInt16BE(5 + addrLen);
                headerLength = 5 + addrLen + 2;
            }

            if (cmd === 3) {
                utils.info("UDP assc: " + this.remoteAddr + ":" + this.remotePort);
                return;
            }

            let buf = Buffer.alloc(10);
            buf.write("\u0005\u0000\u0000\u0001", 0, 4, "binary");
            buf.write("\u0000\u0000\u0000\u0000", 4, 4, "binary");
            // 2222 can be any number between 1 and 65535
            buf.writeInt16BE(2222, 8);
            // buf is 0x05 00 00 01 00 00 00 00 <Any>
            this.localConnection.write(buf);

            this.createRemoteConnection(this.shadowSocksServerAddr,this.shadowSocksServerPort);
            let addrToSendBuf = Buffer.from(addrToSend, "binary");
            addrToSendBuf = this.encryptor.encrypt(addrToSendBuf);
            this.remoteConnection.setNoDelay(false);
            this.remoteConnection.write(addrToSendBuf);

            if (data.length > headerLength) {
                buf = Buffer.alloc(data.length - headerLength);
                data.copy(buf, 0, headerLength);
                const piece = this.encryptor.encrypt(buf);
                this.remoteConnection.write(piece);
            }

            return this.setStage(4);
        } catch (e) {
            utils.error(e);
            this.destroyConnection();
            return this.clean();
        }
    }


    onLocalConnectionData(data) {
        utils.log(utils.EVERYTHING, "local connection on data");
        if (this.stage === 5) {
            this.pipeLocalToRemote(data);
            return;
        }
        if (this.stage === 0) {
            let tempBuf = Buffer.alloc(2);
            tempBuf.write("\u0005\u0000", 0);
            this.localConnection.write(tempBuf);
            this.setStage(1);
            return;
        }
        if (this.stage === 1) {
            return this._stage1(data);
        }
        else if (this.stage === 4) {
            return this._stage4(data);
        }
    }


    /**
     * bind a connection to local connection
     * @param {*} localConnection 
     */
    bindLocalConnection(localConnection){
        this.localConnection=localConnection;
        this.localConnection.on('data',(d)=>this.onLocalConnectionData(d));
        this.localConnection.on('end',()=>this.onLocalConnectionEnd())
        this.localConnection.on('error',(e)=>this.onLocalConnectionError(e));
        this.localConnection.on('drain',()=>this.onLocalConnectionDrain());
        this.localConnection.on('close',(e)=>this.onLocalConnectionClose(e));
        this.localConnection.setTimeout(this.timeout,()=>this.onLocalConnectionTimeout());
        this.connected=true;
        this.emit('afterbind');
    }
}    



module.exports={
    LocalTcpRelay,
};