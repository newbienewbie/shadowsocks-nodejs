const EventEmitter=require('events');
const net = require("net");
const fs = require("fs");
const path = require("path");
const utils = require('../utils');
const inet = require('../inet');



class TcpRelay {

    constructor(timeout,encryptor) {


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
         * as sslocal:
         *     stage 0 auth METHOD received from local, reply with selection message
         *     stage 1 addr received from local, query DNS for remote
         *     stage 2 UDP assoc
         *     stage 3 DNS resolved, connect to remote
         *     stage 4 still connecting, more data from local received
         *     stage 5 remote connected, piping local and remote
         * 
         * as ssserver: 
         *     stage 0 just jump to stage 1 
         *     stage 1 addr received from local, query DNS for remote 
         *     stage 3 DNS resolved, connect to remote 
         *     stage 4 still connecting, more data from local received 
         *     stage 5 remote connected, piping local and remote
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

    /**
     * to be overrided by sub class
     * @param {*} data 
     */
    onLocalConnectionData(data) {
        throw Error(`TcpRelay.onLocalConnectionData() must be overrided `);
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