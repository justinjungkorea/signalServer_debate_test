const logger   = require('../common/logger');
const commonFn = require('./fn.common.service');
const syncFn   = require('./fn.sync.service');

const sjj = require('sdp-jingle-json');

const WebSocket = require('ws');

const PUBLISHERS = 50;
const transactions = {};
const bitrate = 144000;
let apisecret;

let signalSocketio;
let redisInfo;
let VIDEOROOM_PLUGIN_ID = 'janus.plugin.videoroom';
let janus_arr = []; //url만 저장
let janus_hash = {}; //websocket을 저장
let counter = 0;

var fs = require('fs');

let _self = this;

let ws_reconnect_urls = {};
// init();
exports.init = function (_signalSocketio, _redisInfo) {
    signalSocketio = _signalSocketio;
    redisInfo = _redisInfo;
    apisecret = commonFn.getJanusSecret();
    let janusUrls = commonFn.getJanusUrl();
    for(let i in janusUrls) {
        createWebSocket(janusUrls[i]);
    }
};

function createWebSocket(url) {
    try {
        let ws = new WebSocket(url, 'janus-protocol');

        ws.onmessage = (message) => {
            messageProcessor(message);
        };

        ws.onerror = (error) => {
            console.log("error :::", error);
        };

        ws.onopen = () => {
            console.log('WebSocket [' + url + '] has connected.');
            janus_arr.push(url);
            janus_hash[url] = ws;

            _self.createJanusSession(ws)
                .then((res) => {
                    console.log('WebSocket [' + url + '] has connected.');
                    ws['janusSessionId'] = res.janusSessionId;
                    startKeepAlive(ws);
                    createMasterVideoRoomPlugin(ws);
                })
                .catch((err) => {
                    console.log('createJanusSession error::' , err);
                })
        };

        ws.onclose = () => {
            console.log('WebSocket [' + url + '] has closed.');
            for(let i in janus_arr) {
                if(url === janus_arr[i]) janus_arr.splice(i, 1);
            }
            if(janus_hash[url]) delete janus_hash[url];
            ws_reconnect_urls[url] = {dummy: 'dummy'};
            setTimeout(reconnect, 15000);
        };

        //room create, destroy 전용 plugin Id 생성 후 관리.
        function createMasterVideoRoomPlugin(ws) {
            let order = 'attach';
            let trxid = createTrxId();
            let msg = {
                janus      : order,
                opaqueId   : VIDEOROOM_PLUGIN_ID + "-" + trxid,
                session_id : ws.janusSessionId,
                plugin     : VIDEOROOM_PLUGIN_ID
            };
            msg.transaction = trxid;
            msg.apisecret = apisecret;
            transactions[trxid]={};
            transactions[trxid].onsuccess= (res) => {
                ws.masterVideoroomPluginId = res.videoRoomPluginId;
            };
            transactions[trxid].onerror=(e) => {console.log(e)};
            transactions[trxid].order=order;
            transactions[trxid].extra={};
            console.log('[ ### SIGNAL > JANUS ### ] MSG:' + JSON.stringify(msg));
            try{
                ws.send(JSON.stringify(msg));
            } catch(e) {
                console.log(e);
            }
        }

    } catch (error) {
        console.log('Cannot connect WebSocket [' + url + '].');
    }
}

function reconnect() {
    for(let key in ws_reconnect_urls){
        createWebSocket(key);
    }
}

exports.getMediaServer = () => {
    return new Promise(function(resolve, reject) {
        if(janus_arr.length > 0){
            let count = counter++ % janus_arr.length;
            resolve(janus_arr[count]);
        }
        else
            reject();
    });
};

exports.createJanusSession = (ws) => {
    return new Promise((resolve, reject) => {
        let order = 'create';
        let msg = {
            janus : order,
            apisecret: apisecret
        };

        let trxid = createTrxId();
        msg.transaction = trxid;
        transactions[trxid]={};
        transactions[trxid].onsuccess=resolve;
        transactions[trxid].onerror=reject;
        transactions[trxid].order=order;
        console.log('[ ### SIGNAL > JANUS ### ] MSG:' + JSON.stringify(msg));

        ws.send(JSON.stringify(msg));
    });
};

exports.createRoom = (janus_url, publisherCount) => {
    return new Promise((resolve, reject) => {
        let order = 'createVideoRoom';
        let request = {
            janus      : 'message',
            session_id : janus_hash[janus_url].janusSessionId,
            // handle_id  : videoRoomPluginId,
            handle_id  : janus_hash[janus_url].masterVideoroomPluginId,
            body : {
                request    : 'create',
                publishers : publisherCount,
                room       : parseInt(createRoomId()),
                bitrate    : bitrate
            }
        };
        sendMsg(janus_hash[janus_url], order, request, resolve, reject);
    });
};

exports.destroyRoom = (janus_url, roomId) => {
    return new Promise((resolve, reject) => {
        let order = 'destroyVideoRoom';
        let request = {
            janus      : 'message',
            session_id : janus_hash[janus_url].janusSessionId,
            handle_id  : janus_hash[janus_url].masterVideoroomPluginId,
            body : {
                request    : 'destroy',
                room       : roomId
            }
        };
        sendMsg(janus_hash[janus_url], order, request, resolve, reject);

    });
};

// cho. 190924. 다자간 인원 수에 따라 janus room bitrate 변경
exports.editRoom = (janus_url, roomId, _bitrate) => {
    return new Promise((resolve, reject) => {
        let order = 'editVideoRoom';
        let request = {
            janus      : 'message',
            session_id : janus_hash[janus_url].janusSessionId,
            // handle_id  : videoRoomPluginId,
            handle_id  : janus_hash[janus_url].masterVideoroomPluginId,
            body : {
                request    : 'edit',
                room       : roomId,
                new_bitrate: _bitrate
            }
        };
        sendMsg(janus_hash[janus_url], order, request, resolve, reject);
    });
};

exports.createVideoRoomPlugin = (janus_url) => {
    return new Promise((resolve, reject) => {
        let order = 'attach';
        let request = {
            janus      : order,
            opaqueId   : VIDEOROOM_PLUGIN_ID + "-" + createTrxId(),
            session_id : janus_hash[janus_url].janusSessionId,
            plugin     : VIDEOROOM_PLUGIN_ID
        };

        sendMsg(janus_hash[janus_url], order, request, resolve, reject, {});

    });
};

exports.detachVideoRoomPlugin = (janus_url, videoRoomPluginId) => {
    return new Promise((resolve, reject) => {
        let order = 'detach';
        let request = {
            janus      : order,
            opaqueId   : VIDEOROOM_PLUGIN_ID + "-" + createTrxId(),
            session_id : janus_hash[janus_url].janusSessionId,
            handle_id  : videoRoomPluginId,
        };

        sendMsg(janus_hash[janus_url], order, request, resolve, reject, {});
    });
};

exports.joinRoomAsPublisher = (janus_url, videoRoomPluginId, janusRoomId, userId) => {
    return new Promise((resolve, reject) => {
        let order = 'message';
        let request = {
            janus      : order,
            session_id : janus_hash[janus_url].janusSessionId,
            handle_id  : videoRoomPluginId,
            body : {
                request : 'join',
                room    : janusRoomId,
                ptype   : 'publisher',
                display : userId
            }
        };
        sendMsg(janus_hash[janus_url], order, request, resolve, reject, {});
    });
};

exports.joinRoomAndSendSDPOffer = (janus_url, videoRoomPluginId, janusRoomId, userId, sdp) => {
    return new Promise((resolve, reject) => {
        let jsep = sdp;
        jsep.trickle = false;
        let order = 'message';
        let request = {
            janus      : order,
            session_id : janus_hash[janus_url].janusSessionId,
            handle_id  : videoRoomPluginId,
            body : {
                request : 'joinandconfigure',
                room    : janusRoomId,
                ptype   : 'publisher',
                display : userId,
                audio   : false,
                video   : true,
            },
            jsep
        };
        sendMsg(janus_hash[janus_url], order, request, resolve, reject, {});
    });
};

exports.joinRoomAsSubscriber = (janus_url, data) => {
    return new Promise((resolve, reject) => {
        let order = 'message';
        let request = {
            janus      : order,
            session_id : janus_hash[janus_url].janusSessionId,
            handle_id  : data.videoRoomPluginId,
            body : {
                request : 'join',
                room    : data.janusRoomId,
                ptype   : 'subscriber',
                feed       : data.feedId,
                private_id : data.private_id
            }
        };
        sendMsg(janus_hash[janus_url], order, request, resolve, reject, {});
    });
};

exports.sendOffer = (janus_url, videoRoomPluginId, sdpObj, audio) => {
    return new Promise((resolve, reject) => {
        let jsep = sdpObj;
        jsep.trickle = false;

        let order = 'message';
        let request = {
            janus      : order,
            session_id : janus_hash[janus_url].janusSessionId,
            handle_id  : videoRoomPluginId,
            body : {
                request : 'configure',
                audio   : audio,
                video   : true,
                // bitrate : bitrate
            },
            jsep
        };
        sendMsg(janus_hash[janus_url], order, request, resolve, reject, {});
    });
};

exports.sendAnswerAndStartRemoteVideo = (janus_url, data) => {
    return new Promise((resolve, reject) => {
        let jsep = data.sdp;
        jsep.trickle = false;

        let order = 'message';
        let request = {
            janus      : order,
            session_id : janus_hash[janus_url].janusSessionId,
            handle_id  : data.videoRoomPluginId,
            body       : {
                request: 'start',
                room: data.janusRoomId
            },
            jsep
        };
        sendMsg(janus_hash[janus_url], order, request, resolve, reject, {});
    })
};

exports.onIceCandidate = (janus_url, videoRoomPluginId, candidate) => {
    return new Promise((resolve, reject) => {
        let order = 'trickle';
        let request = {
            janus      : order,
            session_id : janus_hash[janus_url].janusSessionId,
            handle_id  : videoRoomPluginId,
            candidate  : candidate
        };
        sendMsg(janus_hash[janus_url], order, request, resolve, reject, {});
    });
};

exports.leaveRoom = async (janus_url, videoRoomPluginId, janusRoomId) => {
    return new Promise((resolve, reject) => {
        let order = 'message';
        let request = {
            janus      : order,
            session_id : janus_hash[janus_url].janusSessionId,
            handle_id  : videoRoomPluginId,
            body       : {
                request: 'leave',
                room: janusRoomId
            }
        };
        sendMsg(janus_hash[janus_url], order, request, resolve, reject, {});
    });
};

exports.processRemoteVideo = async (data) => {
    try {
        let socketIOSessionId = data.socketIOSessionId;

        let videoroom = await _self.createVideoRoomPlugin(data.janus_url);
        let videoRoomPluginId = videoroom.videoRoomPluginId;
        data.videoRoomPluginId = videoRoomPluginId;
        let _data = {
            janus_plugin_id: videoRoomPluginId,
            socketio_session_id: socketIOSessionId,
            ptype: 'subscriber',
            usage: data.usage
        };
        await syncFn.setJanusPluginInfo(redisInfo, _data);

        _self.joinRoomAsSubscriber(data.janus_url, data);

    } catch(err) {
        console.log(err);
    }

};

function sendMsg(janus, order, msg, onSuccess, onError, extra) {
    let trxid = createTrxId();
    msg.transaction = trxid;
    //add apisecret
    msg.apisecret = apisecret;
    transactions[trxid]={};
    transactions[trxid].onsuccess=onSuccess;
    transactions[trxid].onerror=onError;
    transactions[trxid].order=order;
    transactions[trxid].extra=extra;
    // console.log('[ ### SIGNAL > JANUS ### ] MSG:' + JSON.stringify(msg));
    if(msg.janus !== 'keepalive') {
        console.log('[ ### SIGNAL > JANUS ### ] MSG:' + JSON.stringify(msg));
        logger.log('info', `[ ### SIGNAL > JANUS ### ] ${JSON.stringify(msg)}`);
    }
    try{
        janus.send(JSON.stringify(msg));
    } catch(e) {
        console.log(e);
    }
}

function createTrxId () {
    let len=12;
    let charSet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let randomString='';

    for(let i=0;i<len;i++){
        let randomPoz = Math.floor(Math.random() * charSet.length);
        randomString += charSet.substring(randomPoz,randomPoz+1);
    };

    return randomString;
}

function createRoomId () {
    let len=12;
    let charSet = '0123456789';
    let randomString='';

    for(let i=0;i<len;i++){
        let randomPoz = Math.floor(Math.random() * charSet.length);
        randomString += charSet.substring(randomPoz,randomPoz+1);
    };

    return randomString;
}

function startKeepAlive() {
    for (let key in janus_hash) {
        let order = 'keepalive';
        let request = {
            janus : order,
            session_id : janus_hash[key].janusSessionId
        };
        sendMsg(janus_hash[key], order, request, ()=>{setTimeout(startKeepAlive, 30000)}, (err)=>{console.log('keepalive ERROR..', err)}, {});
    }
}

async function messageProcessor(message) {
    // console.log('FROM JANUS. MSG:: ', message.data );
    let messageObj = JSON.parse(message.data);
    if(messageObj.janus !== 'ack') {
        console.log('FROM JANUS. MSG:: ', message.data );
        logger.log('info', `[ ### JANUS > SIGNAL ### ] ${message.data}`);
    }
    let trx = transactions[messageObj.transaction];
    let res;

    if(messageObj.plugindata && messageObj.plugindata.data && messageObj.plugindata.data.error_code) {
        res = {
            error: messageObj.plugindata.data.error,
            error_code: messageObj.plugindata.data.error_code
        };
        trx.onerror(res); //resolve
        delete transactions[messageObj.transaction];
        return false;
    }

    switch(messageObj.janus){
        case 'success':
            console.log(":::: success Event 발생 :::::");
            switch(trx.order){
                case 'create':
                    res = {janusSessionId: messageObj.data.id};
                    console.log("janusSessionId :::", messageObj.data.id);
                    break;
                case 'attach':
                    res = {janusSessionId: messageObj.session_id, videoRoomPluginId: messageObj.data.id};
                    console.log("videoRoom pluginId :::", messageObj.data.id);
                    break;
                case 'remoteAttach':
                    // remoteHandleIds[trx.extra.id] = messageObj.data.id;
                    break;
                case 'createVideoRoom':
                    res = {
                        janusSessionId: messageObj.session_id,
                        videoRoomPluginId: messageObj.sender,
                        janusRoomId: messageObj.plugindata.data.room
                    };
                    break;
                case 'destroyVideoRoom':
                    break;
                case 'editVideoRoom':
                    break;
                default:
                    break;
            }
            trx.onsuccess(res); //resolve
            delete transactions[messageObj.transaction];
            break;

        case 'error':
            console.log("::: error 발생 ::::")
            trx.onerror(messageObj.error);
            delete transactions[messageObj.transaction];
            break;

        case 'event':
            console.log(":::: event 발생 ::::::");
            eventMessageProcessor(messageObj);
            break;

        case 'detach':
        case 'hangup':
            syncFn.hdelJanusPluginInfo(redisInfo, messageObj.sender);
            break;
        case 'webrtcup':
            let plugin_data = await syncFn.getJanusPluginInfo(redisInfo, messageObj.sender);
            if(plugin_data.ufrag) syncFn.removeUfrag(redisInfo, plugin_data.ufrag);
            break;
        case 'media':
            //signalio.to(sessionId).emit('Message', { id : 'media', media : messageObj})
            if(messageObj.receiving === 'false') {
                //TODO leave room?
            }
            break;
        case 'ack':
            switch(trx.order){
                case 'keepalive':
                    if(trx) trx.onsuccess();
                    delete transactions[messageObj.transaction];
                    break;
                case 'message':
                    break;
                default:
                    delete transactions[messageObj.transaction];
                    break;
            }
            break;
        default:
            break;
    }

}

async function eventMessageProcessor(msg) {
    let trx = transactions[msg.transaction];
    let res;
    let janusRoomId = msg.plugindata.data.room;
    let data, data2;
    try {
        switch(msg.plugindata.data.videoroom) {
            case 'joined':
                res = {
                    publisher_id: msg.plugindata.data.id,
                    private_id: msg.plugindata.data.private_id
                };

                data = await syncFn.getJanusPluginInfo(redisInfo, msg.sender);
                data2 = await syncFn.getUserSocketInfo(redisInfo.master, redisInfo.slave, data.socketio_session_id);

                if(data.usage === 'cam') {
                    data2['JANUS_PUBLISHER_FEED_ID'] = msg.plugindata.data.id;
                    data2['JANUS_PRIVATE_ID'] = msg.plugindata.data.private_id;
                    data2['JANUS_PUBLISHER_PLUGIN_ID'] = msg.sender;
                } else { //screen
                    data2['SCREEN_SHARE_JANUS_PUBLISHER_FEED_ID'] = msg.plugindata.data.id;
                    data2['SCREEN_SHARE_JANUS_PRIVATE_ID'] = msg.plugindata.data.private_id;
                    data2['SCREEN_SHARE_JANUS_PUBLISHER_PLUGIN_ID'] = msg.sender;
                }

                let redis_done = await syncFn.setJanusVideoFeedId(redisInfo, {feedId: msg.plugindata.data.id, usage: data.usage});
                redis_done = await syncFn.updateUserSocketInfo(redisInfo, data.socketio_session_id, data2);

                if(trx) trx.onsuccess(res); //resolve
                delete transactions[msg.transaction];

                if(data.usage !== 'cam') {
                    //joinandconfigure로 진입할 때 여기에 sdp가 나온다. 현재 이것을 사용하는건 screenshare sdp offer - maker 뿐이다.
                    if(msg.jsep) {
                        let _sendData = {
                            'eventOp': "SDP",
                            'usage': data.usage,
                            'reqDate': commonFn.getDate(),
                            'userId': data2.ID,
                            'sdp': msg.jsep,
                            'roomId': data2.ROOM_ID,
                            'useMediaSvr': 'Y',
                            isSfu: true,
                            type: 'maker'
                        };

                        sendSdp(data.socketio_session_id, _sendData);
                    }
                    return;
                }

                if(msg.plugindata.data.publishers.length > 0) {
                    let janus_url = await syncFn.getJanusServerByRoomId(redisInfo, data2.ROOM_ID);
                    let publishers = msg.plugindata.data.publishers;
                    publishers.forEach((each) => {
                        //TODO join as subscriber
                        let reqData = {
                            janus_url: janus_url,
                            socketIOSessionId: data.socketio_session_id,
                            socketIORoomId: data2.ROOM_ID,
                            userId: data2.ID,
                            janusRoomId: janusRoomId,
                            feedId: each.id,
                            private_id: data2['JANUS_PRIVATE_ID'],
                            usage: data.usage
                        };
                        setTimeout(() => {_self.processRemoteVideo(reqData)}, 500);
                        // _self.processRemoteVideo(reqData)
                    });
                }
                break;
            case 'event':
                if(msg.plugindata.data.configured === 'ok') {
                    data = await syncFn.getJanusPluginInfo(redisInfo, msg.sender);
                    data2 = await syncFn.getUserSocketInfo(redisInfo.master, redisInfo.slave, data.socketio_session_id);

                    let _sendData = {
                        'eventOp': "SDP",
                        'usage': data.usage,
                        'reqDate': commonFn.getDate(),
                        'userId': data2.ID,
                        'sdp': msg.jsep,
                        'roomId': data2.ROOM_ID,
                        'useMediaSvr': 'Y',
                        isSfu: true
                    };

                    sendSdp(data.socketio_session_id, _sendData);

                } else if (msg.plugindata.data.publishers && msg.plugindata.data.publishers.length > 0) {
                    data = await syncFn.getJanusPluginInfo(redisInfo, msg.sender);
                    data2 = await syncFn.getUserSocketInfo(redisInfo.master, redisInfo.slave, data.socketio_session_id);
                    let janus_url = await syncFn.getJanusServerByRoomId(redisInfo, data2.ROOM_ID);
                    let publishers = msg.plugindata.data.publishers;
                    publishers.forEach((each) => {
                        if(data2['SCREEN_SHARE_JANUS_PUBLISHER_FEED_ID'] === each.id) return true;
                        if(data.usage === 'screen') return true;

                        let reqData = {
                            janus_url: janus_url,
                            socketIOSessionId: data.socketio_session_id,
                            socketIORoomId: data2.ROOM_ID,
                            userId: data2.ID,
                            janusRoomId: janusRoomId,
                            feedId: each.id,
                            private_id: data2['JANUS_PRIVATE_ID'],
                            usage: data.usage
                        };
                        _self.processRemoteVideo(reqData)
                    });

                } else if (msg.plugindata.data.leaving) {
                    if(msg.plugindata.data.leaving === 'ok') syncFn.hdelJanusPluginInfo(redisInfo, msg.sender);
                    if(trx) trx.onsuccess(res); //resolve
                    delete transactions[msg.transaction];
                } else if(msg.plugindata.data.unpublished) {
                    //누가 방에서 나갔다.
                    // syncFn.hdelJanusPluginInfo(redisInfo, msg.sender);
                    if(trx) trx.onsuccess(res); //resolve
                    delete transactions[msg.transaction];
                }
                break;
            case 'attached' :
                data = await syncFn.getJanusPluginInfo(redisInfo, msg.sender);
                data2 = await syncFn.getUserSocketInfo(redisInfo.master, redisInfo.slave, data.socketio_session_id);

                let usage = await syncFn.getJanusVideoFeedId(redisInfo, msg.plugindata.data.id);
                let _data = {
                    socketio_session_id: data.socketio_session_id,
                    janus_plugin_id: msg.sender,
                    ptype:'subscriber',
                    usage: usage
                };

                await syncFn.setJanusPluginInfo(redisInfo, _data);

                let _sendData = {
                    'eventOp': "SDP",
                    'usage': usage,
                    'userId': data2.ID,
                    'sdp': {
                        type: msg.jsep.type,
                        sdp: msg.jsep.sdp,
                    },
                    'roomId': data2.ROOM_ID,
                    'useMediaSvr': 'Y',
                    isSfu: true,
                    displayId: msg.plugindata.data.display,
                    pluginId: msg.sender // TEST. TODO 삭제
                };

                let __data = {
                    roomId: data2.ROOM_ID,
                    sessionId: data.socketio_session_id,
                    sendData: _sendData
                };
                
                await syncFn.saddSDPOffer(redisInfo, __data);
                let ___data = {
                    roomId: data2.ROOM_ID,
                    sessionId: data.socketio_session_id
                };
                let isQueuing = await syncFn.getSessionIsQueuing(redisInfo, ___data);
                if(isQueuing === false) {
                    ___data.isQueuing = true;
                    await syncFn.setSessionIsQueuing(redisInfo, ___data);
                    _self.processSDPOfferQueue(data.socketio_session_id, data2.ROOM_ID);
                }

                break;
        }
    } catch (e) {
        console.log('eventMessageProcessor ERROR. message:: '+ msg + '/// error:: ' + e);
        logger.log('error', `amabook. error msg::  ${JSON.stringify(msg)}  /// error:: ${e}`);
        if(trx) trx.onerror(e); //resolve

    }

}

exports.processSDPOfferQueue = async (sessionId, roomId) => {
    let data = {
        sessionId: sessionId,
        roomId: roomId
    };
    let sendData = await syncFn.spopSDPOffer(redisInfo, data);

    if(sendData) {
        sendData = JSON.parse(sendData);

        let sessionData = await syncFn.getUserSocketInfo(redisInfo.master, redisInfo.slave, sessionId);
        sessionData['QUEUING_JANUS_PLUGIN_ID'] = sendData.pluginId;
        await syncFn.updateUserSocketInfo(redisInfo, sessionId, sessionData);

        sendData.reqDate = commonFn.getDate();

        commonFn.reqNo().then(function (reqResult) {
            sendData.reqNo = reqResult;
            sendSignalSocketMessage(sessionId, sendData);
        }).catch(function (error) {
            console.log(error);
        });
    } else {
        data.isQueuing = false;
        syncFn.setSessionIsQueuing(redisInfo, data);
    }
};

function sendSignalSocketMessage(sessionId, sendData) {
    //TODO 로그작업같은거.
    logger.log('error', `iamabook. sendSignalSocketMessage from fn_janus  \n ${JSON.stringify(sendData) }`);
    commonFn.signalSocket.emit(sessionId, sendData);
}

// attach -> create videoroom(optional) -> join as publisher
/**
 * @param sessionId
 * @param  data = {(*)janus_url,(*)janusRoomId,roomId,userId}
 * @returns {Promise}
 */
exports.processJoinVideoRoom = (sessionId, data) => {
    return new Promise(async (resolve, reject) => {
        try {
            let janus_url = data.janus_url ? data.janus_url : await _self.getMediaServer();
            let _data = {
                janus_url: janus_url,
                roomId: data.roomId
            };
            await syncFn.setJanusServer(redisInfo, _data);

            let videoroom = await _self.createVideoRoomPlugin(janus_url);
            _data = {
                janus_plugin_id: videoroom.videoRoomPluginId,
                socketio_session_id: sessionId,
                ptype: 'publisher',
                usage: 'cam'
            };

            let redis_done = await syncFn.setJanusPluginInfo(redisInfo, _data);
            console.log('setJanusPluginInfo:: ' + redis_done);

            if (!data.janusRoomId) {
                // let publisherCount = 50; //TODO 사용자입력
                let createroom = await _self.createRoom(janus_url, PUBLISHERS);
                
                _data = {
                    roomId: data.roomId,
                    janus_room_id: createroom.janusRoomId,
                };
                await syncFn.setJanusRoomId(redisInfo, _data);
                data.janusRoomId = createroom.janusRoomId;
            }

            let joinroom = await _self.joinRoomAsPublisher(janus_url, videoroom.videoRoomPluginId, data.janusRoomId, data.userId);

            let socket_data_from_redis = await syncFn.getUserSocketInfo(redisInfo.master, redisInfo.slave, sessionId);
            socket_data_from_redis['JANUS_PUBLISHER_PLUGIN_ID'] = videoroom.videoRoomPluginId;
            socket_data_from_redis['JANUS_PUBLISHER_FEED_ID'] = joinroom.publisher_id;
            socket_data_from_redis['JANUS_PRIVATE_ID'] = joinroom.private_id;

            await syncFn.updateUserSocketInfo(redisInfo, sessionId, socket_data_from_redis);

            let res = {
                janus_url: janus_url,
                janusRoomId: data.janusRoomId
            }
            resolve(res);
        } catch (e) {
            reject(e);
        }
    });
};

/**
 *
 * @param janus_url
 * @param sessionId
 * @param  data = {janusRoomId,roomId}
 *
 * unpublish(necessary?) -> leave -> detach
 * @returns {Promise}
 */
exports.processLeaveVideoRoom = (janus_url, sessionId, data) => {
    return new Promise(async (resolve, reject) => {
        try{
            let videoRoomPluginId;
            if(!data.videoRoomPluginId) {
                let user_data = await syncFn.getUserSocketInfo(redisInfo.master, redisInfo.slave, sessionId);
                videoRoomPluginId = user_data.JANUS_PUBLISHER_PLUGIN_ID;
            } else {
                videoRoomPluginId = data.videoRoomPluginId
            }

            await _self.leaveRoom(janus_url, videoRoomPluginId, data.janusRoomId);
            await _self.detachVideoRoomPlugin(janus_url, videoRoomPluginId);
            let sessionDataFromRedis = await syncFn.getUserSocketInfo(redisInfo.master, redisInfo.slave, sessionId);

            await syncFn.deleteJanusVideoFeedId(redisInfo, sessionDataFromRedis['JANUS_PUBLISHER_FEED_ID']);

            if(sessionDataFromRedis['SCREEN_SHARE_JANUS_PUBLISHER_PLUGIN_ID']) {
                await _self.leaveRoom(janus_url, sessionDataFromRedis['SCREEN_SHARE_JANUS_PUBLISHER_PLUGIN_ID'], data.janusRoomId);
                await _self.detachVideoRoomPlugin(janus_url, sessionDataFromRedis['SCREEN_SHARE_JANUS_PUBLISHER_PLUGIN_ID']);
                await syncFn.deleteJanusVideoFeedId(redisInfo, sessionDataFromRedis['SCREEN_SHARE_JANUS_PUBLISHER_FEED_ID']);
            }

            delete sessionDataFromRedis['JANUS_PUBLISHER_FEED_ID'];
            delete sessionDataFromRedis['JANUS_PRIVATE_ID'];
            delete sessionDataFromRedis['JANUS_PUBLISHER_PLUGIN_ID'];
            delete sessionDataFromRedis['QUEUING_JANUS_PLUGIN_ID'];
            delete sessionDataFromRedis['SCREEN_SHARE_JANUS_PUBLISHER_PLUGIN_ID'];
            delete sessionDataFromRedis['SCREEN_SHARE_JANUS_PUBLISHER_FEED_ID'];
            delete sessionDataFromRedis['SCREEN_SHARE_JANUS_PRIVATE_ID'];

            await syncFn.updateUserSocketInfo(redisInfo, sessionId, sessionDataFromRedis);

            resolve();
        } catch(e){
            console.log('processLeaveVideoRoom ERROR. ');
            reject(e);
        }
    });
};

exports.processJoinVideoRoomForScreenShare = (sessionId, data) => {
    return new Promise(async (resolve, reject) => {
        let videoroom = await _self.createVideoRoomPlugin(data.janus_url);
        let _data = {
            janus_plugin_id: videoroom.videoRoomPluginId,
            socketio_session_id: sessionId,
            ptype: 'publisher',
            usage: 'screen'
        };

        await syncFn.setJanusPluginInfo(redisInfo, _data);

        let sdp_to_json = sjj.toSessionJSON(data.sdp.sdp, {
            creators: ['initiator', 'initiator'],
            role: 'initiator',
            direction: 'outgoing'
        });
        let ufrag = sdp_to_json.contents[0].transport.ufrag;
        await syncFn.setSdpUfragToJanusVideoPluginId(redisInfo, {ufrag: ufrag, videoRoomPluginId: videoroom.videoRoomPluginId});

        let joinroom = await _self.joinRoomAndSendSDPOffer(data.janus_url, videoroom.videoRoomPluginId, data.janusRoomId, 'screenshare-'+data.userId, data.sdp);
        // let joinroom = await _self.joinRoomAsPublisher(data.janus_url, videoroom.videoRoomPluginId, data.janusRoomId, 'screenshare-'+data.userId);
        // let offer = await _self.sendOffer(data.janus_url, videoroom.videoRoomPluginId, data.sdp, false );
        resolve(joinroom);
    });
};

exports.clearRedisData = (roomId) => {
    return new Promise(async (resolve, reject) => {
        try{
            syncFn.deleteJanusRoomId(redisInfo, roomId);
            syncFn.deleteJanusServer(redisInfo, roomId);
            syncFn.deleteJanusSessionQueue(redisInfo, roomId);
            resolve();
        } catch(e){
            reject(e);
        }
    });
};

sendSdp = (sessionId,_sendData) => {
    commonFn.reqNo().then(function (reqResult) {
        _sendData.reqNo = reqResult;
        sendSignalSocketMessage(sessionId, _sendData);
        logger.log('info', `[Socket : ${_sendData.eventOp}  Event / 다자간 화상회의] *\n* 현재 처리중 방향 : [Signal -> App (Req)] *\n* eventOp :  ${_sendData.eventOp} *\n 다자간 상황. 미디어서버의 Answer를 보냄. \n ReqNo 생성 완료. App으로 전달할 Data :  ${JSON.stringify(_sendData)}`);
        // setTimeout(function () {
        //     sendSignalSocketMessage(sessionId, _sendData);
        //     logger.log('info', `[Socket : ${_sendData.eventOp}  Event / 다자간 화상회의] *\n* 현재 처리중 방향 : [Signal -> App (Req)] *\n* eventOp :  ${_sendData.eventOp} *\n 다자간 상황. 미디어서버의 Answer를 보냄. \n ReqNo 생성 완료. App으로 전달할 Data :  ${JSON.stringify(_sendData)}`);
        // }, 1500);
    }).catch(function (error) {
        console.log(error);
    });
};