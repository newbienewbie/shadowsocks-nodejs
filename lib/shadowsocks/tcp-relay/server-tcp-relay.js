const EventEmitter=require('events');
const net = require("net");
const fs = require("fs");
const path = require("path");
const utils = require('../utils');
const inet = require('../inet');
const {TcpRelay}=require('./tcp-relay');


/**
 * SS Server Relay
 */
class ServerTcpRelay extends TcpRelay {

    constructor(timeout,encryptor) {
        super(timeout,encryptor);
        this.cachedPieces = [];
    }

    
    /**
     * parse meta info 
     * @param {*} data 
     */
    parseMetaData(data){
    
        const addrtype = data[0];
    
        let result={
            addrtype,
            addrLen:null,
            remoteAddr:null,
            remotePort:null,
            headerLength:null
        };
    
        // undefined
        if (addrtype === void 0) {
            result={};
            return result;
        }
    
        if (addrtype === 3) {
            result.addrLen = data[1];
        }
    
        else if (addrtype !== 1 && addrtype !== 4) {
            const e="unsupported addrtype: " + addrtype + " maybe wrong password";
            throw e; // just throw
        }
    
        if (addrtype === 1) {
            result.remoteAddr = utils.inetNtoa(data.slice(1, 5));
            result.remotePort = data.readUInt16BE(5);
            result.headerLength = 7;
        } 
        else if (addrtype === 4) {
            result.remoteAddr = inet.inet_ntop(data.slice(1, 17));
            result.remotePort = data.readUInt16BE(17);
            result.headerLength = 19;
        }
        else {
            result.remoteAddr = data.slice(2, 2 + result.addrLen).toString("binary");
            result.remotePort = data.readUInt16BE(2 + result.addrLen);
            result.headerLength = 2 + result.addrLen + 2;
        }
        return result;
    }


    pipeRemoteToLocal(data){
        data = this.encryptor.encrypt(data);
        if (!this.localConnection.write(data)) {
            return this.remoteConnection.pause();
        }
    }

    createRemoteConnection(remoteAddr,remotePort){

        // 连接远程服务器 ，写入当前缓存
        if (!this.encryptor) {
            utils.error(`there's no encryptor !`);
            if (this.remoteConnection) { 
                this.remoteConnection.destroy(); 
            }
            return;
        }
        utils.info(`connecting ${remoteAddr}: ${remotePort}`);

        this.localConnection.pause();
        this.remoteConnection = net.connect(remotePort, remoteAddr, ()=>{
            if(this.localConnection){ this.localConnection.resume(); }
            if(!this.localConnection || !this.remoteConnection || !this.encryptor){
                return;
            }
            let i=0;
            while (i < this.cachedPieces.length) {
                console.log(`cachedPieces written: ${i}`);
                this.remoteConnection.write(this.cachedPieces[i] );
                i++;
            }
            this.cachedPieces = null;
            this.setStage(5);
        });

        // 收到数据后就加密，然后写回到和客户端之间的连接
        this.remoteConnection.on("data",(d)=> this.onRemoteConnectionData(d));
        this.remoteConnection.on("end", ()=>this.onRemoteConnectionEnd());
        this.remoteConnection.on("error", (e)=>this.onRemoteConnectionError(e));
        this.remoteConnection.on("close", (e)=>this.onRemoteConnectionClose(e));
        this.remoteConnection.on("drain", ()=>this.onRemoteConnectionDrain());
        this.remoteConnection.setTimeout(this.timeout, ()=>this.onRemoteConnectionTimeout());
    }

    _stage0(data){
        try {
            const meta=this.parseMetaData(data); // may throw exception

            if(!meta){ return; }
            this.remoteAddr=meta.remoteAddr;
            this.remotePort=meta.remotePort;

            this.createRemoteConnection(meta.remoteAddr,meta.remotePort);

            if (data.length > meta.headerLength) {
                let buf =  Buffer.alloc(data.length - meta.headerLength);
                data.copy(buf, 0, meta.headerLength);
                this.cachedPieces.push(buf);
                buf = null;
            }
            this.setStage(4);
        } catch (error) {
            utils.error(error);
            this.destroyConnection();
        }
    }

    _stage4(data){
        return this.cachedPieces.push(data); 
    }

    _stage5(data){
        if (!this.remoteConnection.write(data)) {
            this.localConnection.pause();
        }
    }

    onLocalConnectionData(data) {
        utils.log(utils.EVERYTHING, "local connection on data");
        // 首先尝试解密
        try {
            data = this.encryptor.decrypt(data);
        }
        catch (e) {
            this.destroyConnection();
            return;
        }
        // 然后再根据当前状态处理解密后的数据
        if (this.stage === 5) {
            return this._stage5(data);
        }
        else if (this.stage === 0) {
            return this._stage0(data);
        } 
        else if(this.stage===4){
            return this._stage4(data); 
        }
    }

    onRemoteConnectionData(data){
        utils.log(utils.EVERYTHING, "remote connection on data");
        try {
            this.pipeRemoteToLocal(data);
        } catch (e) {
            utils.error(e);
            this.destroyConnection();
        }
    }

}    



module.exports={
    ServerTcpRelay,
};