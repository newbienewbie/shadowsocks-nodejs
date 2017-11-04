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

const util = require('util');
const pack = require('../../package.json');



let version = pack.name + " v" + pack.version;

let EVERYTHING = 0;
let DEBUG = 1;
let INFO = 2;
let WARN = 3;
let ERROR = 4;

let _logging_level = INFO;


function printLocalHelp() {
    return console.log("usage: sslocal [-h] -s SERVER_ADDR -p SERVER_PORT [-b LOCAL_ADDR] -l LOCAL_PORT -k PASSWORD -m METHOD [-t TIMEOUT] [-c config]\n\noptional arguments:\n  -h, --help            show this help message and exit\n  -s SERVER_ADDR        server address\n  -p SERVER_PORT        server port\n  -b LOCAL_ADDR         local binding address, default is 127.0.0.1\n  -l LOCAL_PORT         local port\n  -k PASSWORD           password\n  -m METHOD             encryption method, for example, aes-256-cfb\n  -t TIMEOUT            timeout in seconds\n  -c CONFIG             path to config file");
};

function printServerHelp() {
    return console.log("usage: ssserver [-h] -s SERVER_ADDR -p SERVER_PORT -k PASSWORD -m METHOD [-t TIMEOUT] [-c config]\n\noptional arguments:\n  -h, --help            show this help message and exit\n  -s SERVER_ADDR        server address\n  -p SERVER_PORT        server port\n  -k PASSWORD           password\n  -m METHOD             encryption method, for example, aes-256-cfb\n  -t TIMEOUT            timeout in seconds\n  -c CONFIG             path to config file");
};



function parseArgs(isServer) {
    var _, defination, lastKey, nextIsValue, oneArg, ref, result;
    if (isServer == null) {
        isServer = false;
    }
    defination = {
        '-l': 'local_port',
        '-p': 'server_port',
        '-s': 'server',
        '-k': 'password',
        '-c': 'config_file',
        '-m': 'method',
        '-b': 'local_address',
        '-t': 'timeout'
    };
    result = {};
    nextIsValue = false;
    lastKey = null;
    ref = process.argv;
    for (_ in ref) {
        oneArg = ref[_];
        if (nextIsValue) {
            result[lastKey] = oneArg;
            nextIsValue = false;
        } else if (oneArg in defination) {
            lastKey = defination[oneArg];
            nextIsValue = true;
        } else if ('-v' === oneArg) {
            result['verbose'] = true;
        } else if (oneArg.indexOf('-') === 0) {
            if (isServer) {
                printServerHelp();
            } else {
                printLocalHelp();
            }
            process.exit(2);
        }
    }
    return result;
};

function checkConfig (config) {
    var ref;
    if ((ref = config.server) === '127.0.0.1' || ref === 'localhost') {
        warn("Server is set to " + config.server + ", maybe it's not correct");
        warn("Notice server will listen at " + config.server + ":" + config.server_port);
    }
    if ((config.method || '').toLowerCase() === 'rc4') {
        return warn('RC4 is not safe; please use a safer cipher, like AES-256-CFB');
    }
};


function config(level) {
    return _logging_level = level;
};

function log(level, msg) {
    if (level >= _logging_level) {
        if (level >= DEBUG) {
            return util.log(new Date().getMilliseconds() + 'ms ' + msg);
        } else {
            return util.log(msg);
        }
    }
};

function debug(msg) {
    return log(DEBUG, msg);
};

function info(msg) {
    return log(INFO, msg);
};

function warn(msg) {
    return log(WARN, msg);
};

function error(msg) {
    return log(ERROR, (msg != null ? msg.stack : void 0) || msg);
};

function inetNtoa(buf) {
    return buf[0] + "." + buf[1] + "." + buf[2] + "." + buf[3];
};

function  inetAton(ipStr) {
    var buf, i, parts;
    parts = ipStr.split(".");
    if (parts.length !== 4) {
        return null;
    } else {
        buf = new Buffer(4);
        i = 0;
        while (i < 4) {
            buf[i] = +parts[i];
            i++;
        }
        return buf;
    }
};

setInterval(function () {
    var cwd, e, heapdump;
    if (_logging_level <= DEBUG) {
        debug(JSON.stringify(process.memoryUsage(), ' ', 2));
        if (global.gc) {
            debug('GC');
            gc();
            debug(JSON.stringify(process.memoryUsage(), ' ', 2));
            cwd = process.cwd();
            if (_logging_level === DEBUG) {
                try {
                    heapdump = require('heapdump');
                    process.chdir('/tmp');
                    return process.chdir(cwd);
                } catch (error) {
                    e = error;
                    return debug(e);
                }
            }
        }
    }
}, 1000);


module.exports = {
    parseArgs,
    checkConfig,
    version,
    EVERYTHING, DEBUG, INFO, WARN, ERROR, config,
    log, debug, info, warn, error,
    inetAton, inetNtoa,
};