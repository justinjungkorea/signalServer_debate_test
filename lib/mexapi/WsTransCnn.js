"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const alog_1 = require("./alog");
const WebSocket = require("ws");
class SignalMsgBase {
    constructor(signal) {
        this.signal = signal;
    }
}
exports.SignalMsgBase = SignalMsgBase;
class RequestMsg {
    constructor(method) {
        this.method = method;
    }
}
exports.RequestMsg = RequestMsg;
class ResponseMsg {
    constructor(status, desc = null) {
        this.status = status;
        if (desc != null) {
            this.statusDesc = desc;
        }
    }
}
exports.ResponseMsg = ResponseMsg;
class WsRequest {
    constructor(man, tid) {
        this.reqMan = man;
        this.tid = tid;
    }
    setCallback(callback) {
        this.respCallback = callback;
    }
    request(msg, callback) {
        // alog.info('wsreq: request')
        this.reqTimer = setTimeout(() => {
            alog_1.default.info('*** timeout req, method:', msg.method, ', tid:', msg.tid);
            const tmsg = { tid: this.tid, status: 500, message: 'timeout' };
            if (this.respCallback) {
                this.respCallback(undefined, tmsg);
            }
            this.close();
        }, 1000);
        this.reqMsg = msg;
        this.respCallback = callback;
        this.reqMan.writeMsg(JSON.stringify(msg));
    }
    response(status, msg = null) {
        // alog.debug("response, reqmsg:", this.reqMsg)
        const respmsg = new ResponseMsg(status, msg);
        this.responseMsg(respmsg);
        // msg.method = this.reqMsg.method
        // msg.status = status;
        // msg.tid = this.reqMsg.tid
        // this.reqMan.writeMsg(JSON.stringify(msg))
        // this.reqMan.unregRequest(this.tid)
        // if (this.reqTimer) {
        //     clearTimeout(this.reqTimer)
        //     this.reqTimer = null
        // }
    }
    responseMsg(msg) {
        msg.tid = this.tid;
        this.reqMan.writeMsg(JSON.stringify(msg));
        this.reqMan.unregRequest(this.tid);
        if (this.reqTimer) {
            clearTimeout(this.reqTimer);
            this.reqTimer = null;
        }
    }
    responseString(status, str) {
        this.response(status, { statusDesc: str });
    }
    close() {
        // alog.info('req close')
        this.reqMan.unregRequest(this.tid);
        if (this.reqTimer) {
            clearTimeout(this.reqTimer);
            this.reqTimer = null;
        }
    }
    feedMsg(msg) {
        clearTimeout(this.reqTimer);
        if (this.respCallback) {
            this.respCallback(undefined, msg);
        }
        this.close();
    }
}
exports.WsRequest = WsRequest;
class WsTransCnn {
    constructor() {
        this.isConnected = false;
        this.pendingData = [];
        this.trMap = new Map();
    }
    setTag(tag) {
        this.nameTag = tag;
    }
    connect(url, callback) {
        alog_1.default.verbose('wtrman: connecting...');
        this.isServer = false;
        this.tidSeed = 1;
        this.connectionCallback = callback;
        const ws = new WebSocket(url, { rejectUnauthorized: false });
        this.webSock = ws;
        this.initLis();
    }
    accept(ws, callback) {
        this.connectionCallback = callback;
        this.isServer = true;
        this.tidSeed = 0;
        this.webSock = ws;
        this.isConnected = true;
        this.initLis();
    }
    initLis() {
        this.webSock.on('message', (msg) => {
            //alog.verbose(`<${this.nameTag}> recv msg: ${msg}`)
            // const tmsg = "{\"user_id\":\"gildong\",\"passwd\":\"1234\",\"method\":\"login\",\"tid\":\"3\"}"
            const js = JSON.parse(msg);
            if (js.status != null) {
                if (js.tid) {
                    const req = this.trMap.get(js.tid);
                    if (req) {
                        req.feedMsg(js);
                    }
                }
            }
            else if (js.method != null) {
                const req = new WsRequest(this, js.tid);
                req.reqMsg = js;
                if (js.tid) { // tid check
                    const numtid = parseInt(js.tid);
                    const even = numtid % 2 ? false : true;
                    if (this.isServer && even == true) {
                        alog_1.default.info('### even number tid not allowed for server');
                        req.responseString(400, 'even number tid not allowed for server');
                        return;
                    }
                    if (this.isServer == false && even == false) {
                        alog_1.default.info('### odd number tid not allowed for client');
                        req.responseString(400, 'odd number tid not allowed for client');
                        return;
                    }
                }
                else {
                    req.responseString(400, 'tid not found');
                    return;
                }
                req.tid = js.tid;
                if (this.requestCallback) {
                    this.requestCallback(req);
                }
                else {
                    alog_1.default.info('### request callback not specified');
                }
            }
            else if (js.signal != null) {
                this.signalCallback(js);
            }
        });
        this.webSock.on('open', () => {
            // alog.verbose(`<${this.nameTag}> connected`);
            this.isConnected = true;
            if (this.connectionCallback) {
                this.connectionCallback(0);
            }
            for (; this.pendingData.length > 0;) {
                const msg = this.pendingData.shift();
                this.webSock.send(msg);
            }
        });
        this.webSock.on('close', () => {
            // alog.debug('disconnected')
            if (this.connectionCallback && this.isConnected) {
                this.connectionCallback(-1);
            }
            this.isConnected = false;
        });
        this.webSock.on('error', () => {
            alog_1.default.info('### error');
            this.pendingData = [];
            this.trMap.forEach((req, tid) => {
                req.feedMsg({ status: 500, msg: '### network error' });
            });
            this.trMap.clear();
            // TODO: this.isConnected 를 false로 설정해야 하지 않는지 체크 필요??? this.webSock.CLOSED 이걸로 체크???
        });
    }
    getnerateTid() {
        this.tidSeed += 2;
        if (this.tidSeed == 0) {
            this.tidSeed += 2;
        }
        return this.tidSeed.toString();
    }
    request(method, msg, callback = null) {
        msg.method = method;
        return this.requestMsg(msg, callback);
    }
    requestMsg(reqmsg, callback = null) {
        const tid = this.getnerateTid();
        const req = new WsRequest(this, tid);
        reqmsg.tid = tid;
        this.trMap.set(tid, req);
        req.request(reqmsg, callback);
        return req;
    }
    requestMsgPm(reqmsg) {
        return new Promise((resolve, reject) => {
            this.requestMsg(reqmsg, (err, rmsg) => {
                // alog.info('**** on response pm');
                resolve(rmsg);
            });
        });
    }
    writeMsg(msg) {
        // alog.verbose('send msg:', msg, ', isconnected:', this.isConnected, ', pendingdata:', this.pendingData.length)
        // alog.verbose(`<${this.}> send msg:', msg, ', isconnected:', this.isConnected, ', pendingdata:', this.pendingData.length`)
        // alog.verbose(`<${this.nameTag}> send msg: ${msg}`)
        if (this.pendingData.length == 0 && this.isConnected) { // FixMe: 죽은적있음. connection 종료 체크 필요...
            this.webSock.send(msg);
        }
        else {
            this.pendingData.push(msg);
        }
    }
    sendSignal(signal, msg) {
        const tmsg = Object.assign({}, msg);
        tmsg.signal = signal;
        // alog.verbose('send signal:', JSON.stringify(tmsg))
        this.writeMsg(JSON.stringify(tmsg));
    }
    sendSignalMsg(smsg) {
        this.writeMsg(JSON.stringify(smsg));
    }
    unregRequest(tid) {
        this.trMap.delete(tid);
        // alog.info('remain tr cnt:', this.trMap.size)
    }
    setOnConnectionLis(callback) {
        this.connectionCallback = callback;
    }
    setOnSignal(callback) {
        this.signalCallback = callback;
    }
    setOnRequestLis(callback) {
        this.requestCallback = callback;
    }
    close() {
        this.webSock.close();
        this.isConnected = false;
    }
}
exports.WsTransCnn = WsTransCnn;
//
// module.exports = {WsTransCnn:WsTransCnn, WsRequest:WsRequest}
//# sourceMappingURL=WsTransCnn.js.map