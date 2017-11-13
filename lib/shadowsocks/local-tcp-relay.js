const EventEmitter=require('events');
const net = require("net");
const fs = require("fs");
const path = require("path");
const udpRelay = require("./udprelay");
const utils = require('./utils');
const inet = require('./inet');



class TcpRelay {

    constructor(shadowSocksServerAddr,shadowSocksServerPort,timeout,encryptor) {

        // ss server addr,port 
        this.shadowSocksServerAddr=shadowSocksServerAddr;
        this.shadowSocksServerPort=shadowSocksServerPort;
        this.timeout=timeout;
        this.encryptor = encryptor;

        this.eventEmitter=new EventEmitter();
        this.on=this.eventEmitter.on;
        this.emit=this.eventEmitter.emit;

        this.connected = false;

        // connection to local client
        this.localConnection = null;

        // connection to remote server
        this.remoteConnection = null;

        // remote addr of remoteConnection
        this.remoteAddr = null;
        // remote port of remoteConnection
        this.remotePort = null;

        /**
         * stage 0 auth METHOD received from local, reply with selection message 
         * stage 1 addr received from local, query DNS for remote 
         * stage 2 UDP assoc 
         * stage 3 DNS resolved, connect to remote 
         * stage 4 still connecting, more data from local received 
         * stage 5 remote connected, piping local and remote
         */
        this.stage = 0;
    }

    setStage(stage=0){
        this.stage=stage;
        utils.debug(`set stage = ${stage}`);
        return;
    }

    /**
     * free vars
     */
    clean() {
        utils.debug("do clean");
        this.localConnection= null;
        this.remoteConnection = null;
        this.encryptor = null;
        this.emit('afterclean',this);
    }

    /**
     * when local connection ends , the remote connection to server should end too
     */
    onLocalConnectionEnd(){
        this.connected = false;
        utils.debug("local connection on end");
        if (this.remoteConnection){ 
            return this.remoteConnection.end(); 
        }
    }

    /**
     * when remote connection ends ,the local connection to client should end too
     */
    onRemoteConnectionEnd(){
        utils.debug("remote connection on end");
        if (this.localConnection) {
            return this.localConnection.end();
        }
    }

    /**
     * when local connection close , the remote connection to server should destroy/end too
     * @param {*} error 
     */
    onLocalConnectionClose(error){
        this.connected = false;
        utils.debug("local connection on close:" + error);
        if (error) {
            if (this.remoteConnection) {
                this.remoteConnection.destroy();
            }
        } else {
            if (this.remoteConnection) {
                this.remoteConnection.end();
            }
        }
        return this.clean();
    }

    /**
     * when remote connection close , the local connection to client should destroy/end too
     * @param {*} error 
     */
    onRemoteConnectionClose(error){
        utils.debug("remote connection on close:" + error);
        if (error) {
            if (this.localConnection) {
                return this.localConnection.destroy();
            }
        } else {
            if (this.localConnection) {
                return this.localConnection.end();
            }
        }
    }


    /**
     * when local connection timeout , the local and remote connection should destory
     */
    onLocalConnectionTimeout(){
        utils.debug("local connection on timeout");
        this.destroyConnection();
    }

    onRemoteConnectionTimeout(){
        utils.debug("remote connection on timeout");
        this.destroyConnection();
    }

    /**
     * destory the local connection and remote connection
     */
    destroyConnection(){
        if (this.remoteConnection) {
            this.remoteConnection.destroy();
        }
        if (this.localConnection) {
            this.localConnection.destroy();
        }
        return;
    }

    /**
     * when local connection drain event happens, try to resume the remote connection
     */
    onLocalConnectionDrain(){
        utils.debug("local connection on drain");
        if (this.remoteConnection && this.stage === 5) {
            return this.remoteConnection.resume();
        }
    }

    /**
     * when remote connection drain event happens , try to resume the local connection
     */
    onRemoteConnectionDrain(){
        utils.debug("remote connection on drain");
        if (this.localConnection) {
            return this.localConnection.resume();
        }
    }

    onLocalConnectionError(e){
        utils.debug("local connection on error");
        return utils.error("local error: " + e);
    }

    onRemoteConnectionError(e){
        utils.debug("remote connection on error");
        return utils.error("remote " + this.remoteAddr+ ":" + this.remotePort + " error: " + e);
    }


    pipeLocalToRemote(data){
        data = this.encryptor.encrypt(data);
        if (!this.remoteConnection.write(data)) {
            this.localConnection.pause();
        }
    }

    pipeRemoteToLocal(data){
        data = this.encryptor.decrypt(data);
        if (!this.localConnection.write(data)) {
            return remoteConnection.pause();
        }
    }

    createRemoteConnection(){
        utils.info(`connecting ${this.shadowSocksServerAddr}: ${this.shadowSocksServerPort}`);
        this.remoteConnection = net.connect(this.shadowSocksServerPort,this.shadowSocksServerAddr,()=>{
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
    stage4(data){
        if (this.remoteConnection == null) {
            if (this.localConnection) {
                this.localConnection.destroy();
            }
            return;
        }
        this.remoteConnection.setNoDelay(true);
        this.pipeLocalToRemote(data);
    }

    stage1(data){
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

            this.createRemoteConnection();
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

    onRemoteConnectionData(data){
        if (!this.connected) {
            return;
        }
        utils.log(utils.EVERYTHING, "remote connection on data");
        try {
            if (this.encryptor) {
                this.pipeRemoteToLocal(data);
            } else {
                return remoteConnection.destroy();
            }
        } catch (e) {
            utils.error(e);
            this.destroyConnection();
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
            return this.stage1(data);
        }
        else if (this.stage === 4) {
            return this.stage4(data);
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
    TcpRelay,
};