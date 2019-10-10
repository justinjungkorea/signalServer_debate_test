// const kurento  = require('kurento-client');
const logger   = require('../common/logger');
const commonFn = require('./fn.common.service');
const syncFn   = require('./fn.sync.service');

// 180806, verify mex server
const MexsAgent = require('../lib/mexapi/MexAgent');
const {MexRoom, ROOM_STATUS} = require('../lib/mexapi/MexRoom');

let mexRoom = {};
let mexss = {};

var fs = require('fs');
let encoderSdpRequest = null;
fs.readFile('./common/stream.sdp', 'utf8', (err, data) => {
    if(err){
        throw err;
    }

    encoderSdpRequest = data;
});

var candidatesQueue = {};
var clients = {};

var kurentoClient = null;
var rooms = {};

let ws_uri = '';

//180212. iamabook. 미디어서버 분기
const request = require('request');
let mediaServerUrls;
let mediaServerCounter = 0;

var screenMaster = {};
var screenViwer = {};
var screenRooms = {};
var screenCandidatesQueue = {};

exports.addUserToConferenceWaitingLine = function (masterRedis, slaveRedis, room_id, session_id, socketio, joinData , type) {
    let waiting_data = {
        sessionId: session_id,
        joinData: joinData,
        roomId: room_id
    };
    masterRedis.SADD("CONFERENCE:"+room_id+":WAITINGLINE", JSON.stringify(waiting_data), function(){
        console.log('add Waiting Line : ', waiting_data);
		if(type=="N"){
			return false;
		}
		slaveRedis.SCARD("CONFERENCE:"+room_id+":WAITINGLINE", function(err, resp){
            if (resp === 1) { exports.popUserFromConferenceWaitingLine(masterRedis, slaveRedis, socketio, room_id); console.log("다자간체인지5"); }
        })
	});

}

exports.popUserFromConferenceWaitingLine = function (masterRedis, slaveRedis, signalSocketio, room_id){
	masterRedis.SPOP("CONFERENCE:"+room_id+":WAITINGLINE", function(err, resp){
	    const signalSocket = commonFn.signalSocket;
		if(resp){
			let waiting_data = JSON.parse(resp);
			waiting_data.joinData.reqDate = commonFn.getDate();
			console.log(signalSocket);
			signalSocket.emit(waiting_data.sessionId, waiting_data.joinData);
		}
	})

};

exports.deleteUserFromConferenceWaitingLine = function (masterRedis, slaveRedis, room_id, session_id){
    console.log('ivypark deleteUserFromConferenceWaitingLine roomId : ', room_id);
    (function() {
        return new Promise(function(resolved, rejected) {
            for(let i = 0; i <= 1; i ++) {
            	masterRedis.SPOP("CONFERENCE:"+room_id+":WAITINGLINE", function(err, resp){
                    console.log('POP Waiting Line : ', resp);
            		if(resp){
                        let _obj = JSON.parse(resp);
                        if(_obj.sessionId !== session_id) { resolved(resp); }
                        if(err)                           { rejected(err); }
            		}
            	});
            }
        });
    })().then(function(_obj) {
        masterRedis.SADD("CONFERENCE:"+room_id+":WAITINGLINE", _obj, function(){})
    }).catch(function(err) {
        console.log('waitingline session id 삭제 도중 에러 발생 ', err);
    });

};

exports.getKurentoClient = function(_mediaServerUrl, callback) {

    if(_mediaServerUrl || _mediaServerUrl.indexOf('null') === -1) {
        console.log("creating kurento WITH _mediaServerUrl : ", _mediaServerUrl);

        if (!kurentoClient) {
            kurento(_mediaServerUrl, function (error, _kurentoClient) {
                if (error) {
                    console.log('getKurentoClient error : ', error);
                    callback(error);
                }

                _kurentoClient
                    .on('reconnect', function (n, delay) {
                        logger.log('warn', `MediaServer reconnect : ${n}, Delay : ${JSON.stringify(delay)}`);
                        _kurentoClient.close();
                        kurentoClient = null;
                    });

                kurentoClient = _kurentoClient;
                callback(_kurentoClient);
            });
        } else {
            callback(kurentoClient);
        }

    } else {
        ws_uri = 'ws://' + commonFn.getMediaServerUrls();
        console.log("creating kurento WITHOUT _mediaServerUrl");
        //TODO 180219. iamabook. screenshare 함수는 _mediaServerUrl 이 없으므로 여기로 온다. 곧 수정한다
        kurento(ws_uri, function (error, _kurentoClient) {
            if (error) {
                console.log('getKurentoClient error : ', error);
                callback(error);
            }
            callback(_kurentoClient);
        });
    }
};

exports.getMediaPipeline = function(_kurentoClient,callback) {

	_kurentoClient.create('MediaPipeline', function (error, _pipeline) {
		console.log("creating MediaPipeline");
		if (error) {
            console.log('getMediaPipeline error : ', error);
			return callback(error);
		}

		return callback(_pipeline);
	});
};

function getMediaPipelineCallback(_kurentoClient, socket, id, data, _mediaPipeline, callback, composite){
    logger.log('info', `[SDP] getMediaPipelineCallback 진입 :  ${id}`);

    // 180720 ivypark, candidateQueueCheckLoopMaxCount 추가. client가 Candidate를 보내지 않을 때의 무한루프 방어 (3초, 6회)
    let candidateQueueCheckLoopMaxCount = 5;

    (function MediaPipelineLoop() {
        if(!candidatesQueue[id]) {
            logger.log('info', `[SDP] candidatesQueue[id] 값이 없어 다시 진입 :  ${candidatesQueue[id]}`);
            if(!candidateQueueCheckLoopMaxCount) return;

            setTimeout(function() {
                MediaPipelineLoop();
                candidateQueueCheckLoopMaxCount--;
            }, 500);
        } else {
            exports.createWebRtcEndPoint(_mediaPipeline,function(_webrtcEndpoint){	//endpoint
                logger.log('info', `[SDP] createWebRtcEndPoint 성공 : `+ id + ` :  ${candidatesQueue[id]}` );
                if (candidatesQueue[id]) {
                    while(candidatesQueue[id].length) {
                        var candidate = candidatesQueue[id].shift();
                        _webrtcEndpoint.addIceCandidate(candidate);
                    }

                    console.log('---> SDP candidatesQueue 통과');
                    clients[id] = {
                        id: id,
                        _webrtcEndpoint: null,
                        hubPort: null
                    };

                    clients[id].webrtcEndpoint = _webrtcEndpoint;
                    clients[id].webrtcEndpoint.on('OnIceCandidate', function(event) {
                        var candidate = kurento.getComplexType('IceCandidate')(event.candidate);

                        var data_ = {
                            eventOp        : 'Candidate',
                            usage: 'cam',
                            reqNo : '',
                            reqDate : commonFn.getDate(),
                            userId : data.userId,
                            roomId : data.roomId,
                            candidate : event.candidate
                        };
                        commonFn.reqNo().then(function(reqResult){
                            data_.reqNo=reqResult;
                            console.log(data.userId, '---> Candidate 전송 완료');
                            socket.to(id).emit('knowledgetalk', data_);
                            logger.log('info', `[Socket : Candidate Event / 다자간 화상회의] *\n* 현재 처리중 방향 : [Signal -> App] *\n* Candidate 요청자 :  ${data.userId}*\n* App으로 전달할 Data : ${JSON.stringify(data_)}`);
                        }).catch(function(errer) {
                            console.log("error");
                        });
                    });

                    //console.log('[SDP] createWebRtcEndPoint 여기 Data : ', data);
                    //logger.log('info', '[SDP] createWebRtcEndPoint 여기 Data : ', data);
                    if(!data.sdp) return;
                    clients[id].webrtcEndpoint.processOffer(data.sdp.sdp, function(error, sdpAnswer){

                        logger.log('info', `[SDP] processOffer :  ${JSON.stringify(error)}, ${JSON.stringify(sdpAnswer)}`);
                        if (error) {
                            return callback(error);
                        }

                        if(typeof composite == "undefined") {
                            exports.getComposite(_mediaPipeline, function(_composite){
                                getCompositeCallback(_composite, callback);
                            })
                        } else {
                            getCompositeCallback(composite, callback);
                        }

                        function getCompositeCallback(_composite, callback) {
                            _mediaPipeline.addTag("roomId", data.roomId);
                            syncFn.getRedisServer().slave.GET("CONFERENCE:"+data.roomId+":PIPELINE", function(error, resp){
                                if(!resp){
                                    let redis_pipelinedata = {
                                        pipeline_id: _mediaPipeline.id,
                                        composite_id: _composite.id,
                                        mediaServerUrl: data.mediaServerUrl
                                    };

                                    syncFn.getRedisServer().master.SET("CONFERENCE:"+data.roomId+":PIPELINE", JSON.stringify(redis_pipelinedata));
                                }
                            });

                            exports.createHubPort(_composite,function(_hubPort){

                                let startTime = new Date().getTime();

                                if(data.initialRoomLength) {

                                    let filter;
                                    createFilter(_mediaPipeline,'capsfilter caps=video/x-raw,wgcp_participant=' + data.initialRoomLength, 'VIDEO', function(_filter){
                                        filter = _filter;

                                        clients[id].hubPort = _hubPort;

                                        //180308. iamabook.
                                        hsetSessionInfoToRedis(data.roomId, id, _webrtcEndpoint.id, _hubPort.id, _filter.id);

                                        clients[id].webrtcEndpoint.connect(filter);
                                        filter.connect(clients[id].hubPort, function(){});
                                        clients[id].hubPort.connect(clients[id].webrtcEndpoint);
                                    });

                                } else {
                                    //180308. iamabook.
                                    hsetSessionInfoToRedis(data.roomId, id, _webrtcEndpoint.id, _hubPort.id);

                                    clients[id].hubPort = _hubPort;
                                    clients[id].webrtcEndpoint.connect(clients[id].hubPort, function(){});
                                    clients[id].hubPort.connect(clients[id].webrtcEndpoint);
                                }

                                rooms[data.roomId]={
                                    mediaPipeline : _mediaPipeline,
                                    composite : _composite
                                };

                                var callbackData ={
                                    type : "answer",
                                    sdp	: sdpAnswer
                                }

                                let timer_check_flag = false;
                                _webrtcEndpoint.on('MediaStateChanged', function(event){
                                    console.log('???????????????????????????', _webrtcEndpoint);
                                    if(event.newState === 'CONNECTED') {
                                        timer_check_flag = true;
                                        _kurentoClient.getMediaobjectById(event.source, function(err2, rtcendpoint){
                                            rtcendpoint.getMediaPipeline(function(err, pipeline){
                                                pipeline.getTag("roomId", function(err, pipeline_roomId){
                                                    exports.popUserFromConferenceWaitingLine(
                                                        syncFn.getRedisServer().master, syncFn.getRedisServer().slave, socket, pipeline_roomId
                                                    )
                                                })

                                            });
                                        });
                                    }

                                });

                                setTimeout(function() {
                                    if(timer_check_flag === false) {
                                        _mediaPipeline.getTag("roomId", function(err, pipeline_roomId){
                                            exports.popUserFromConferenceWaitingLine(
                                                syncFn.getRedisServer().master, syncFn.getRedisServer().slave, socket, pipeline_roomId
                                            )
                                        })
                                    }
                                }, 5000);

                                return callback(callbackData);
                            });
                        }
                    });

                    clients[id].webrtcEndpoint.gatherCandidates(function(error) {
                        if (error) {
                            return callback(error);
                        }
                    });
                }
            });
        }
    })();
}

exports.createWebRtcEndPoint = function(_pipeline,callback) {
    console.log("iamabook. createWebRtcEndPoint!!");
	_pipeline.create('WebRtcEndpoint', function (error, _webRtcEndpoint) {
		// console.log("endPoint:",_webRtcEndpoint);
		if (error) {
		    console.log('createWebRtcEndPoint error : ', error);
			return callback(error);
		}

		_webRtcEndpoint.setMaxVideoRecvBandwidth(8000);
		// _webRtcEndpoint.setMaxVideoSendBandwidth(10000);

		return callback(_webRtcEndpoint);

	});
}

exports.addClient = function(socket, id, data, callback) {
    let mediaServerUrl = null;

    syncFn.getRedisServer().slave.GET("CONFERENCE:"+data.roomId+":PIPELINE", function (err, resp) {
        if (resp) {
            let pipelinedata = JSON.parse(resp);
            mediaServerUrl = pipelinedata.mediaServerUrl;

            exports.checkMediaServerIsAlive(pipelinedata.mediaServerUrl, function(is_alive) {
               if(is_alive){
                   exports.getKurentoClient(mediaServerUrl, function (_kurentoClient) {
                       _kurentoClient.getMediaobjectById(pipelinedata.pipeline_id, function (err, _pipe) {
                           if (_pipe) { // 
                               logger.log('info', `[SDP] getKurentoClient 있을 경우!!! pipeline 있음. :  ${id}   :  ${JSON.stringify(_pipe)}`);
                               _kurentoClient.getMediaobjectById(pipelinedata.composite_id, function (err, _comp) {
                                   logger.log('info', `[SDP] getKurentoClient 있을 경우!!! composite 있음. :  ${id}   : ${JSON.stringify(_comp)}`);
                                   getMediaPipelineCallback(_kurentoClient, socket, id, data, _pipe, callback, _comp)
                               })
                           }
                       })
                   });
               } else {
                   let res_send_data = {
                       media_server_is_dead: true
                   };
                   callback(res_send_data);
               }
            });

        } else {
            getMediaServerUrl(0, function (_mediaServerUrl) {
                if (!_mediaServerUrl) return;
                data.mediaServerUrl = 'ws://' + _mediaServerUrl;

                exports.getKurentoClient(data.mediaServerUrl, function (_kurentoClient) {
                    logger.log('info', `[SDP] getKurentoClient 생성 성공 : ${id} +  ${JSON.stringify(_kurentoClient)}`);
                    exports.getMediaPipeline(_kurentoClient, function (_mediaPipeline) {
                        logger.log('info', `[SDP] getMediaPipeline 생성 성공 : ' ${id} +  ${JSON.stringify(_mediaPipeline)}`);
                        getMediaPipelineCallback(_kurentoClient, socket, id, data, _mediaPipeline, callback)
                    });
                });

            });
        }
    });

}

exports.onIceCandidate = function(sessionId, _candidate) {
	var candidate = kurento.getComplexType('IceCandidate')(_candidate);

    if (clients[sessionId]) {
        var webRtcEndpoint = clients[sessionId].webrtcEndpoint;
        webRtcEndpoint.addIceCandidate(candidate);
    }
    else {
        if (!candidatesQueue[sessionId]) {
            candidatesQueue[sessionId] = [];
        }
		candidatesQueue[sessionId].push(candidate);
    }
};

//20180205. iamabook. createFilter
function createFilter (_pipeline, _command, _type, callback) {
    let command = _command;
    let type    = _type;

    let options = {
        command    : command,
        filterType : type
    };
    _pipeline.create('GStreamerFilter', options, function(error, _filter){
        if(error){
            callback(error);
        }else{
            callback(_filter);
        }
    });
}

exports.getComposite = function(_pipeline,callback) {
	 _pipeline.create('Composite', function (error, _composite) {
		 console.log("creating Composite");
		 if (error) {
			 return callback(error);
		 }
		 return callback(_composite);
	 });
}

exports.createHubPort = function(_composite , callback) {
	_composite.createHubPort(function (error, _hubPort) {
		console.log("Creating hubPort");
		if (error) {
			return callback(error);
		} else {
			return callback(_hubPort);
		}
	});

}

//180308. iamabook.
exports.stop = function(session_id, room_id, masterRedis, slaveRedis) {
    if(slaveRedis && room_id) {
        slaveRedis.GET("CONFERENCE:"+room_id+":PIPELINE", function(error, resp){
            if(resp){
                let pipeline_data = JSON.parse(resp);
                slaveRedis.HGET("CONFERENCE:"+room_id+":SESSION_INFO", session_id, function(error, resp2){
                    if(resp2) {
                        let session_data = JSON.parse(resp2);

                        exports.checkMediaServerIsAlive(pipeline_data.mediaServerUrl, function(is_alive) {
                            if(is_alive){
                                //TODO ALIVE
                                _continue();
                            } else {
                                return false;
                            }
                        });

                        function _continue() {
                            exports.getKurentoClient(pipeline_data.mediaServerUrl, function (_kurentoClient) {
                                if(session_data.filter_id) {
                                    _kurentoClient.getMediaobjectById(session_data.filter_id, function(err, _filter){

                                        console.log('_filter.release --> ', session_id, '성공');
                                        _filter.release();
                                    });
                                }

                                _kurentoClient.getMediaobjectById(session_data.hubport_id, function(err, _hubport){

                                    console.log('_hubport.release --> ', session_id, '성공');
                                    _hubport.release();
                                });

                                _kurentoClient.getMediaobjectById(session_data.webrtcendpoint_id, function(err, _webrtcEndpoint){

                                    console.log('_webrtcEndpoint.release --> ', session_id, '성공');
                                    _webrtcEndpoint.release();
                                });

                                masterRedis.HDEL("CONFERENCE:"+room_id+":SESSION_INFO", session_id, function (error, resp3) {
                                    slaveRedis.HLEN("CONFERENCE:"+room_id+":SESSION_INFO", function (error, length) {
                                        if (length === 0) {
                                            _kurentoClient.getMediaobjectById(pipeline_data.composite_id , function(err, _composite){
                                                _composite.release();
                                            });

                                            _kurentoClient.getMediaobjectById(pipeline_data.pipeline_id , function(err, _pipeline){
                                                _pipeline.release();
                                            });
                                        }
                                    });
                                });

                            });
                        }

                    }
                });
            }
        });

    }

    delete clients[session_id];
    delete candidatesQueue[session_id];
};

exports.screenShareStop = function(session_id, room_id, masterRedis, slaveRedis) {
    console.log('-----> screenShareStop !!!!!! ', session_id);
    logger.log('-----> screenShareStop !!!!!! ', session_id);

    if (slaveRedis && room_id) {
        slaveRedis.GET("SCREENSHARE:" + room_id + ":PIPELINE", function (error, resp) {
            if (resp) {
                masterRedis.DEL("SCREENSHARE:" + room_id + ":PIPELINE");
                let pipeline_data = JSON.parse(resp);

                exports.checkMediaServerIsAlive(pipeline_data.mediaServerUrl, function (is_alive) {
                    if (is_alive) {
                        //TODO ALIVE
                        _continue();
                    } else {
                        return false;
                    }
                });

                function _continue() {
                    exports.getKurentoClient(pipeline_data.mediaServerUrl, function (_kurentoClient) {
                        _kurentoClient.getMediaobjectById(pipeline_data.pipeline_id, function (err, _pipeline) {
                            if (_pipeline) {
                                _pipeline.release();
                                console.log('_pipeline.release . host --> ', session_id, pipeline_data.pipeline_id, '성공');
                            }
                            _pipeline = null;
                        });
                    });
                }

            }
        });

        let session_info_arr = [];
        spopScreenShareSessionInfoToRedis(masterRedis, room_id, session_info_arr, function(_session_info_arr) {
            logger.log('info', `++ spopScreenShareSessionInfoToRedis ++ ${JSON.stringify(_session_info_arr) }`);
            if (mexRoom[room_id]) {
                mexRoom[room_id].close();
                delete mexRoom[room_id];
                console.log(`is deleted mexRoom ? --> ${mexRoom[room_id]}`);
            }

            for (var i in _session_info_arr) {
                console.log('++ loop ++', i, _session_info_arr[i]);
                let session_data = _session_info_arr[i];

                if (mexss[session_data.session_id]) {
                    delete mexss[session_data.session_id];
                    console.log(`is deleted mexss[id] ? --> ${!!mexss[session_data.session_id]}`);
                }

                delete screenCandidatesQueue[session_data.session_id];

                if (screenMaster[session_id]) {
                    delete screenMaster[session_data.session_id];
                }
                if (screenViwer[session_id]) {
                    delete screenViwer[session_data.session_id];
                }

            }
        });
    }
}

exports.clearCandidatesQueue = function (sessionId) {

	if (candidatesQueue[sessionId] != null) {
		delete candidatesQueue[sessionId];
	}
};

function hwShare(socket, id, data, localRoom, callback) {

    let roomId = data.roomId;
    let type = data.type === 'maker' ? 'recvonly' : 'sendonly';
    if (localRoom) {
        roomId = localRoom;
    }

    console.log('ivypark test -> ', commonFn.getMexServerConfig());

    if (!mexRoom[roomId]) {
        let mexConf = commonFn.getMexServerConfig();
        mexRoom[roomId] = MexsAgent.createMexRoom(mexConf.uri, mexConf.type /* now is 'sfu' only */, roomId);
    }

    mexRoom[roomId].setOnStatus((status) => {
        if(status === ROOM_STATUS.NORMAL) {
            console.log('================= mex Room 생성 성공')
        } else {
            console.log('================= mex Room 생성 실패')
            mexRoom[roomId].close();
            delete mexRoom[roomId];
        }
    });

    mexss[id] = mexRoom[roomId].addRtcSession('sfu', 'screen', type, data.sdp, data.userId, (err, status) => {
        console.log('=================  addRtcSession error : ', err);
        console.log('=================  status ##', status, data.userId);
    });

    mexss[id].setOnLocalDescription((err, sdp) => {
        console.log('send answer sdp to client', err);
        // sdp.sdp = sdp.sdp.replace(sdp.sdp.match(/maxaveragebitrate=(.*); /)[0], sdp.sdp.match(/maxaveragebitrate=(.*); /)[0].replace('; ', ''))

        callback(sdp);
    });

    mexss[id].setOnCandidate((err, candi) => {
        console.log('send cadidate to client', err);

        let message = {
            eventOp: 'Candidate',
            usage: 'screen',
            useMediaSvr: 'Y',
            reqNo : '',
            reqDate : commonFn.getDate(),
            userId : data.userId,
            roomId : data.roomId,
            candidate: candi,
        };

        commonFn.reqNo().then(function(reqResult){
            message.reqNo = reqResult;
            socket.to(id).emit('knowledgetalk', message);
            logger.log('info', `[Media -> Signal -> App] ${data.userId}에게 Candidate 전송 :  ${JSON.stringify(message) }`);
        });
    });

}

function hwShareCandidate(id, candidate) {
    console.log(candidate);
    mexss[id].addIceCandidate(candidate, (err, status) => {
        // if (err) {
        //     throw (err);
        // }

        console.log('####### add candidate successfully', status, id);
    })
}

function hwShareRemoveSession(roomId, id) {
    console.log('ivypark hwShareRemoveSession!', roomId, !!mexRoom[roomId], !!mexss[id]);
    if (mexRoom[roomId] && mexss[id]) {
        mexRoom[roomId].removeSession(mexss[id].getUserHandle());
        delete mexss[id];
        console.log(`is deleted mexss[id] ? --> ${!!mexss[id]}`);
    }
}

// function hwShareUser(socket, id, data, localRoom, callback) {
//
//     mexss[id] = mexRoom.addRtcSession('sfu', 'screen', 'sendonly', data.sdp, data.userId, (err, status) => {
//         console.log('addRtcSession error : ', err);
//         console.log('status ##', status);
//     });
//
//     mexss[id].setOnCandidate((err, candi) => {
//         console.log('send cadidate to client', err);
//
//         let message = {
//             eventOp: 'Candidate',
//             usage: 'screen',
//             useMediaSvr: 'Y',
//             reqNo : '',
//             reqDate : commonFn.getDate(),
//             userId : data.userId,
//             roomId : data.roomId,
//             candidate: candi,
//         };
//
//         commonFn.reqNo().then(function(reqResult){
//             message.reqNo = reqResult;
//             socket.to(id).emit('knowledgetalk', JSON.stringify(message));
//             logger.log('info', `[Media -> Signal -> App] ${data.userId}에게 Candidate 전송 : `, message);
//         });
//     });
//
//     mexss[id].setOnLocalDescription((err, sdp) => {
//         console.log('send answer sdp to client', err);
//         // sdp.sdp = sdp.sdp.replace(sdp.sdp.match(/maxaveragebitrate=(.*); /)[0], sdp.sdp.match(/maxaveragebitrate=(.*); /)[0].replace('; ', ''))
//
//         callback(sdp);
//     });
// }

exports.hwShare = hwShare;
// exports.hwShareUser = hwShareUser;
exports.hwShareCandidate = hwShareCandidate;
exports.hwShareRemoveSession = hwShareRemoveSession;

exports.swShareHost = function(socket, id, data, callback) {

    //exports.screenClearCandidatesQueue(id);
    console.log('[SDP] MAKER 진입, screenCandidatesQueue[id] : ', id, screenCandidatesQueue[id]);

    getMediaServerUrl(0, function (_mediaServerUrl) {
        if (!_mediaServerUrl) return;

        data.mediaServerUrl = 'ws://' + _mediaServerUrl;

        exports.getKurentoClient(data.mediaServerUrl, function(_kurentoClient) {

            exports.getMediaPipeline(_kurentoClient, function (_mediaPipeline) {

                let redis_pipelinedata = {
                    pipeline_id: _mediaPipeline.id,
                    mediaServerUrl: data.mediaServerUrl
                };

                syncFn.getRedisServer().master.SET("SCREENSHARE:" + data.roomId + ":PIPELINE", JSON.stringify(redis_pipelinedata), function (err, reply) {
                    _mediaPipeline.create('RtpEndpoint', function (err, _rtpEndpoint) {
                        if (err) {
                            console.error('error at create rtpEndpoint');
                            pipeline.release();
                            return callback(err);
                        }

                        screenMaster[id] = {
                            id: id
                        };

                        _rtpEndpoint.setMaxVideoRecvBandwidth(0);
                        _rtpEndpoint.setMaxVideoSendBandwidth(0);

                        _rtpEndpoint.processOffer(encoderSdpRequest, function (error, sdpAnswer) {
                            console.log('answer : ', sdpAnswer);

                            if (error) {
                                return callback(error);
                            }

                            var callbackData = {
                                type: "answer",
                                sdp: sdpAnswer
                            }

                            screenRooms[data.roomId] = {
                                rtpEndpoint: _rtpEndpoint,
                                mediaPipeline: _mediaPipeline
                            };

                            let screenShareRoomsInfo = {
                                rtpEndpoint_id: _rtpEndpoint.id,
                                mediaPipeline: _mediaPipeline.id
                            };

                            syncFn.getRedisServer().master.HSET('SCREEN_SHARE_ROOMS_INFO', data.roomId, JSON.stringify(screenShareRoomsInfo), function (err, rep) {
                                console.log('MAKER WebRTCEndPoint ID 저장 성공,', screenShareRoomsInfo);
                                logger.log('info', `MAKER WebRTCEndPoint ID 저장 성공, ${JSON.stringify(screenShareRoomsInfo) }`);
                                if (err) console.log(err);
                                return callback(callbackData);
                            });

                            saddScreenShareSessionInfoToRedis(data.roomId, id, _rtpEndpoint.id, true);

                            _rtpEndpoint.on('MediaFlowInStateChange', function(event){
                                console.log("iamabook. 181818", event, _rtpEndpoint);
                                console.log(`Rtp flow IN: ${event.state}\n`);
                            });
                            _rtpEndpoint.on('MediaFlowOutStateChange', function(event){
                                console.log("iamabook. 282828", event, _rtpEndpoint);
                                console.log(`Rtp flow OUT: ${event.state}\n`);
                            });
                        });
                    });
                });
            });
        });
    });
}


// 180720 ivypark, 원본
exports.screenShare = function(socket, id, data, callback) {

    //exports.screenClearCandidatesQueue(id);
    console.log('[SDP] MAKER 진입, screenCandidatesQueue[id] : ', id, screenCandidatesQueue[id]);

    getMediaServerUrl(0, function (_mediaServerUrl) {
        if (!_mediaServerUrl) return;

        data.mediaServerUrl = 'ws://' + _mediaServerUrl;

        exports.getKurentoClient(data.mediaServerUrl, function(_kurentoClient){

            exports.getMediaPipeline(_kurentoClient,function(_mediaPipeline){

                let redis_pipelinedata = {
                    pipeline_id: _mediaPipeline.id,
                    mediaServerUrl: data.mediaServerUrl
                };

                syncFn.getRedisServer().master.SET("SCREENSHARE:"+data.roomId+":PIPELINE", JSON.stringify(redis_pipelinedata), function(err, reply) {
                    // 18.05.14. ivypark candidateQueueCheckLoopMaxCount 추가. candidateQueue가 6회(3초) 이상 체크되면 더 이상 체크하지 않는다. (공유자)
                    let candidateQueueCheckLoopMaxCount = 5;
                    (function screenShareCreateWebRtcEndPoint() {
                        if(!candidateQueueCheckLoopMaxCount) return;

                        console.log('screenCandidatesQueue[id] ::: ', id, screenCandidatesQueue[id], !!screenCandidatesQueue[id]);
                        if( !screenCandidatesQueue[id] || screenCandidatesQueue[id] === [] ) {
                            console.log('[SDP] screenCandidatesQueue[id] 값이 없어 다시 진입 (maker) : ', screenCandidatesQueue[id]);
                            logger.log('info', `[SDP] screenCandidatesQueue[id] 값이 없어 다시 진입 (maker) :  ${screenCandidatesQueue[id]}`);
                            setTimeout(function() {
                                candidateQueueCheckLoopMaxCount--;
                                screenShareCreateWebRtcEndPoint();
                            }, 500);
                        } else {
                            exports.createWebRtcEndPoint(_mediaPipeline,function(_webrtcEndpoint){
                                if (screenCandidatesQueue[id]) {
                                    while(screenCandidatesQueue[id].length) {
                                        var candidate = screenCandidatesQueue[id].shift();
                                        console.log('maker icecandidate audio : ', candidate);
                                        _webrtcEndpoint.addIceCandidate(candidate);
                                    }

                                    screenMaster[id] = {
                                        id: id
                                    };

                                    console.log('offer : ', data.sdp.sdp);
                                    screenMaster[id].webrtcEndpoint = _webrtcEndpoint;

                                    // let sdp_split = data.sdp.sdp.split('m=audio')[0];
                                    // sdp_split = sdp_split.replace('a=group:BUNDLE video audio', 'a=group:BUNDLE video');
                                    //
                                    // if(!sdp_split.includes('a=rtcp-fb:100 goog-remb')) {
                                    //     console.log('iamabook...... test.');
                                    //     sdp_split = sdp_split.replace('a=rtcp-fb:100 nack\r\na=rtcp-fb:100 nack pli\r\n',
                                    //         'a=rtcp-fb:100 ccm fir\r\na=rtcp-fb:100 nack\r\na=rtcp-fb:100 nack pli\r\na=rtcp-fb:100 goog-remb\r\na=rtcp-fb:100 transport-cc\r\n')
                                    // }

                                    // iamabook. 180720. audio를 수신 할 시 위를 대체하여 작업해야할 내용.
                                    // let sdp_split = data.sdp.sdp.replace('a=rtpmap:111 opus/48000/2\r\n', 'a=rtpmap:111 opus/48000/2\r\na=rtcp-fb:111 transport-cc\r\n')
                                    // console.log('ivypark 181818----------------->', sdp_split);

                                    screenMaster[id].webrtcEndpoint.processOffer(data.sdp.sdp, function(error, sdpAnswer){
                                        console.log('answer : ', sdpAnswer);

                                        if (error) {
                                            return callback(error);
                                        }

                                        var callbackData ={
                                            type: "answer",
                                            sdp	: sdpAnswer
                                        }

                                        screenRooms[data.roomId] = {
                                            webrtcEndpoint: _webrtcEndpoint,
                                            mediaPipeline: _mediaPipeline
                                        };

                                        let screenShareRoomsInfo = {
                                            webrtcEndpoint_id: _webrtcEndpoint.id,
                                            mediaPipeline: _mediaPipeline.id
                                        };

                                        syncFn.getRedisServer().master.HSET('SCREEN_SHARE_ROOMS_INFO', data.roomId, JSON.stringify(screenShareRoomsInfo), function(err, rep) {
                                            console.log('MAKER WebRTCEndPoint ID 저장 성공,', screenShareRoomsInfo);
                                            logger.log('info', `MAKER WebRTCEndPoint ID 저장 성공,  ${JSON.stringify(screenShareRoomsInfo)}`);
                                            if(err) console.log(err);
                                            return callback(callbackData);
                                        });

                                        saddScreenShareSessionInfoToRedis (data.roomId, id, _webrtcEndpoint.id, true )
                                    });

                                    screenMaster[id].webrtcEndpoint.on('OnIceCandidate', function(event) {
                                        var candidate = kurento.getComplexType('IceCandidate')(event.candidate);
                                        var data_ = {
                                            eventOp      : 'Candidate',
                                            usage: 'screen',
                                            useMediaSvr: 'Y',
                                            reqNo : '',
                                            reqDate : commonFn.getDate(),
                                            userId : data.userId,
                                            roomId : data.roomId,
                                            candidate : event.candidate
                                        };
                                        commonFn.reqNo().then(function(reqResult){
                                            data_.reqNo=reqResult;
                                            socket.to(id).emit('knowledgetalk', data_);
                                            logger.log('info', `[Media -> Signal -> App] ${data.userId}에게 Candidate 전송 : ${JSON.stringify(data_) }`);
                                        }).catch(function(errer) {
                                            console.log("error");
                                        });
                                    });

                                    screenMaster[id].webrtcEndpoint.on('MediaStateChanged', function(event){
                                        console.log("################## screenMaster webRTC MediaStateChanged ################: \n", event);
                                    });

                                    screenMaster[id].webrtcEndpoint.gatherCandidates(function(error) {
                                        if (error) {
                                            return callback(error);
                                        }
                                    });
                                }

                            });
                        }
                    })();
                });

            });
        })

    });

}

exports.swShareUser = function(socket, id, data, localRoom, callback){

    // 180702 ivypark, 로컬 화상회의 상태에서, code만 보냈는데 진입하는 경우 (1:1 화상회의 중 로컬 화면공유 진행시)
    if (data.sdp.type === 'answer' || data.code === '200') {
        return;
    }

    let viewerId = data.userId;
    // if (screenRooms[data.roomId] === null) {
    //     mediaPipeline = screenRooms[data.roomId].mediaPipeline
    // }

    let roomId = data.roomId;

    if (!localRoom) {
        logger.log('info', `다자간 화면 공유, LocalScreenShare인 경우에는 에러.`);
        console.log('다자간 상황에서 Local시에는 에러, localScreenShare room 정보가 redis에 없음.');
        console.log('일반 화면공유에서는 신경 쓰지 않아도 됨.');
    } else {
        roomId = localRoom;
    }

    console.log('[SDP] USER 진입, screenCandidatesQueue[id] : ', localRoom, viewerId, screenCandidatesQueue[id]);
    //exports.screenClearCandidatesQueue(id);

    //180221. iamabook. 화면공유 상황에선 무적권 PIPELINE이 존재해야 한다. 없으면 에러를 내려야 한다.
    syncFn.getRedisServer().slave.GET("SCREENSHARE:"+roomId+":PIPELINE", function (err, resp) {
        logger.log('info', `[ ${data.eventOp}  / Signal->App] Send Data recvOnly start :  ${JSON.stringify(viewerId)  }`);
        console.log('...', resp);
        if (resp) {
            let pipelinedata = JSON.parse(resp);
            let _mediaServerUrl = pipelinedata.mediaServerUrl;

            exports.checkMediaServerIsAlive(pipelinedata.mediaServerUrl, function(is_alive) {
                if(is_alive){
                    //TODO ALIVE
                    _continue();
                } else {
                    let res_send_data = {
                        media_server_is_dead: true
                    };
                    callback(res_send_data);
                }
            });

            function _continue() {

                exports.getKurentoClient(_mediaServerUrl, function (_kurentoClient) {
                    //console.log("here");
                    _kurentoClient.getMediaobjectById(pipelinedata.pipeline_id, function (err, _pipe) {

                        logger.log('info', `[ ${data.eventOp} / Signal->App] Send Data Pipeline data 있음. :  ${JSON.stringify(viewerId) }`);
                        if (_pipe) {
                            // 18.05.14. ivypark candidateQueueCheckLoopMaxCount 추가. candidateQueue가 6회(3초) 이상 체크되면 더 이상 체크하지 않는다. (Viewer)
                            let candidateQueueCheckLoopMaxCount = 5;
                            (function screenShareCreateWebRtcEndPoint() {
                                if(!candidateQueueCheckLoopMaxCount) {
                                    logger.log('info', `candidateQueueCheckLoopMaxCount return ---> ${JSON.stringify(viewerId) }`);
                                    return;
                                }

                                console.log('screenCandidatesQueue[id] ::: ', id, screenCandidatesQueue[id], !!screenCandidatesQueue[id]);

                                if( !screenCandidatesQueue[id] || screenCandidatesQueue[id] === [] ) {
                                    console.log('[SDP] screenCandidatesQueue[id] 값이 없어 다시 진입 (viewer, user) : ', viewerId, screenCandidatesQueue[id]);
                                    logger.log('info', `[SDP] screenCandidatesQueue[id] 값이 없어 다시 진입 (viewer, user) : ${JSON.stringify(viewerId) }, ${screenCandidatesQueue[id]}`);
                                    console.log('현재 screenCandidatesQueue[id] 정보 ::: ', screenCandidatesQueue);
                                    setTimeout(function() {
                                        candidateQueueCheckLoopMaxCount--;
                                        screenShareCreateWebRtcEndPoint();
                                    }, 500);
                                } else {

                                    console.log('pipe : ', _pipe);

                                    _pipe.create('WebRtcEndpoint', function (error, viewers_webrtcEndpoint) {
                                        logger.log('info', `[ ${data.eventOp} / Signal->App] Send Data WebRtcEndpoint 생성. :  ${JSON.stringify(viewerId) }`);
                                        console.log('_pipe.create webrtcEndpoint');
                                        if (screenCandidatesQueue[id]) {
                                            while(screenCandidatesQueue[id].length) {
                                                var candidate = screenCandidatesQueue[id].shift();
                                                console.log('user _webrtcEndpoint.addIceCandidate() ......');
                                                console.log('user icecandidate audio : ', candidate);
                                                viewers_webrtcEndpoint.addIceCandidate(candidate);
                                            }
                                            screenViwer[id] = {
                                                webrtcEndpoint: viewers_webrtcEndpoint
                                            };

                                            viewers_webrtcEndpoint.on('ConnectionStateChanged', function(event){
                                                console.log("ConnectionStateChanged !!!!", event);
                                                if (event.newState === 'CONNECTED') {
                                                    delete screenViwer[id];
                                                    delete screenCandidatesQueue[id];
                                                    console.log('delete viewer!!!!!!!!!');
                                                }
                                            });

                                            viewers_webrtcEndpoint.on('MediaStateChanged', function(event){
                                                console.log("################## webRTC MediaStateChanged ################: \n", event);
                                            });

                                            viewers_webrtcEndpoint.on('OnIceCandidate', function(event) {
                                                console.log('screenViwer[id] --> OnIceCandidate', event.candidate);
                                                var candidate = kurento.getComplexType('IceCandidate')(event.candidate);
                                                var data_ = {
                                                    eventOp        : 'Candidate',
                                                    usage: 'screen',
                                                    useMediaSvr: 'Y',
                                                    reqNo : '',
                                                    reqDate : commonFn.getDate(),
                                                    userId : data.userId,
                                                    roomId : data.roomId,
                                                    candidate : event.candidate
                                                };
                                                commonFn.reqNo().then(function(reqResult){
                                                    data_.reqNo=reqResult;
                                                    socket.to(id).emit('knowledgetalk', data_);
                                                    logger.log('info', `[Media -> Signal -> App] ${data.userId}에게 Candidate 전송 : ${JSON.stringify(data_) }`);
                                                }).catch(function(errer) {
                                                    console.log("error");
                                                });
                                            });
                                            //console.log(data.sdp);
                                            console.log('screenViwer[id] --->', screenViwer[id]);

                                            // let _sdp = data.sdp.sdp;
                                            // _sdp = _sdp.replace('a=ice-options:trickle\r\n', '');
                                            screenViwer[id].webrtcEndpoint.processOffer(data.sdp.sdp, function(error, sdpAnswer) {
                                                // console.log('offer <--- ', _sdp);
                                                logger.log('info', `[ ${data.eventOp} / Signal->App] sdp offer 받음 : ${JSON.stringify(viewerId)} , ${JSON.stringify(error) }`);
                                                if (error) {
                                                    return callback(error);
                                                }

                                                saddScreenShareSessionInfoToRedis (data.roomId, id, viewers_webrtcEndpoint.id, false )

                                                syncFn.getRedisServer().slave.HGET('SCREEN_SHARE_ROOMS_INFO', roomId, function(err, _results) {
                                                    console.log('SCREEN_SHARE_ROOMS_INFO User가 webrtcEndpoint id 꺼내는 중 :', _results);
                                                    logger.log('info', `User가 webrtcEndpoint id 꺼내는 중 : ${JSON.stringify(_results)  }`);
                                                    if(err) return new Error(err);
                                                    let result = JSON.parse(_results);
                                                    _kurentoClient.getMediaobjectById(result.rtpEndpoint_id, function(err, host_rtpEndpoint){
                                                        console.log('+++++++++++++++++++++++++ user webrtcEndPoint 비교 1 :::: ', JSON.stringify(screenViwer[id].webrtcEndpoint));
                                                        host_rtpEndpoint.connect(viewers_webrtcEndpoint, function(error) {
                                                            console.log('user의 _webrtcEndpoint connect 성공!!!!', err, error);
                                                            logger.log('info', `[${data.eventOp} ' / Signal->App] Endpoint : ${JSON.stringify(viewerId)}` );
                                                            if (error) {
                                                                console.log('#### error ---> ', error);
                                                                return callback(error);
                                                            }

                                                            var callbackData ={
                                                                type: "answer",
                                                                sdp	: sdpAnswer
                                                            };

                                                            logger.log('info', `[ ${data.eventOp} / Signal->App] answer sdpAnswer 생성 완료 :  ${JSON.stringify(viewerId)}`);
                                                            return callback(callbackData);
                                                        });
                                                    });
                                                });
                                            });

                                            viewers_webrtcEndpoint.gatherCandidates(function(error) {
                                                if (error) {
                                                    //this.stop(room, sessionId);
                                                    return callback(error);
                                                }
                                            });
                                        }
                                    })
                                }
                            })();
                        }
                    })

                });
            }

        } else {
            // TODO 에러 리턴해야한다.
            console.log('redis에 정보 없음.');
        }
    });

}

// 180720 ivypark, 원본
exports.startViewer = function(socket, id, data, localRoom, callback){

    // 180702 ivypark, 로컬 화상회의 상태에서, code만 보냈는데 진입하는 경우 (1:1 화상회의 중 로컬 화면공유 진행시)
    if (data.sdp.type === 'answer' || data.code === '200') {
        return;
    }

    let viewerId = data.userId;
    // if (screenRooms[data.roomId] === null) {
    //     mediaPipeline = screenRooms[data.roomId].mediaPipeline
    // }

    let roomId = data.roomId;

    if (!localRoom) {
        logger.log('info', `다자간 화면 공유, LocalScreenShare인 경우에는 에러.`);
        console.log('다자간 상황에서 Local시에는 에러, localScreenShare room 정보가 redis에 없음.');
        console.log('일반 화면공유에서는 신경 쓰지 않아도 됨.');
    } else {
        roomId = localRoom;
    }

    console.log('[SDP] USER 진입, screenCandidatesQueue[id] : ', localRoom, viewerId, screenCandidatesQueue[id]);
    //exports.screenClearCandidatesQueue(id);

    //180221. iamabook. 화면공유 상황에선 무적권 PIPELINE이 존재해야 한다. 없으면 에러를 내려야 한다.
    syncFn.getRedisServer().slave.GET("SCREENSHARE:"+roomId+":PIPELINE", function (err, resp) {
        logger.log('info', `[ ${data.eventOp} / Signal->App] Send Data recvOnly start :  ${JSON.stringify(viewerId)}`);
        console.log('...', resp);
        if (resp) {
            let pipelinedata = JSON.parse(resp);
            let _mediaServerUrl = pipelinedata.mediaServerUrl;

            exports.checkMediaServerIsAlive(pipelinedata.mediaServerUrl, function(is_alive) {
                if(is_alive){
                    //TODO ALIVE
                    _continue();
                } else {
                    let res_send_data = {
                        media_server_is_dead: true
                    };
                    callback(res_send_data);
                }
            });

            function _continue() {

                exports.getKurentoClient(_mediaServerUrl, function (_kurentoClient) {
                    //console.log("here");
                    _kurentoClient.getMediaobjectById(pipelinedata.pipeline_id, function (err, _pipe) {

                        logger.log('info', `[ ${data.eventOp} / Signal->App] Send Data Pipeline data 있음. : ${JSON.stringify(viewerId)}`);
                        if (_pipe) {
                            // 18.05.14. ivypark candidateQueueCheckLoopMaxCount 추가. candidateQueue가 6회(3초) 이상 체크되면 더 이상 체크하지 않는다. (Viewer)
                            let candidateQueueCheckLoopMaxCount = 5;
                            (function screenShareCreateWebRtcEndPoint() {
                                if(!candidateQueueCheckLoopMaxCount) {
                                    logger.log('info', `candidateQueueCheckLoopMaxCount return ---> ${JSON.stringify(viewerId)}`);
                                    return;
                                }

                                console.log('screenCandidatesQueue[id] ::: ', id, screenCandidatesQueue[id], !!screenCandidatesQueue[id]);

                                if( !screenCandidatesQueue[id] || screenCandidatesQueue[id] === [] ) {
                                    console.log('[SDP] screenCandidatesQueue[id] 값이 없어 다시 진입 (viewer, user) : ', viewerId, screenCandidatesQueue[id]);
                                    logger.log('info', `[SDP] screenCandidatesQueue[id] 값이 없어 다시 진입 (viewer, user) :  ${JSON.stringify(viewerId)}, ${screenCandidatesQueue[id]}`);
                                    console.log('현재 screenCandidatesQueue[id] 정보 ::: ', screenCandidatesQueue);
                                    setTimeout(function() {
                                        candidateQueueCheckLoopMaxCount--;
                                        screenShareCreateWebRtcEndPoint();
                                    }, 500);
                                } else {
                                    _pipe.create('WebRtcEndpoint', function (error, viewers_webrtcEndpoint) {
                                        logger.log('info', `[' ${data.eventOp} / Signal->App] Send Data WebRtcEndpoint 생성. :  ${JSON.stringify(viewerId)}`);
                                        console.log('_pipe.create webrtcEndpoint');
                                        if (screenCandidatesQueue[id]) {
                                            while(screenCandidatesQueue[id].length) {
                                                var candidate = screenCandidatesQueue[id].shift();
                                                console.log('user _webrtcEndpoint.addIceCandidate() ......');
                                                console.log('user icecandidate audio : ', candidate);
                                                viewers_webrtcEndpoint.addIceCandidate(candidate);
                                            }
                                            screenViwer[id] = {
                                                webrtcEndpoint: viewers_webrtcEndpoint
                                            };

                                            viewers_webrtcEndpoint.on('ConnectionStateChanged', function(event){
                                                console.log("ConnectionStateChanged !!!!", event);
                                                if (event.newState === 'CONNECTED') {
                                                    delete screenViwer[id];
                                                    delete screenCandidatesQueue[id];
                                                    console.log('delete viewer!!!!!!!!!');
                                                }
                                            });

                                            viewers_webrtcEndpoint.on('MediaStateChanged', function(event){
                                                console.log("################## webRTC MediaStateChanged ################: \n", event);
                                            });

                                            viewers_webrtcEndpoint.on('OnIceCandidate', function(event) {
                                                console.log('screenViwer[id] --> OnIceCandidate', event.candidate);
                                                var candidate = kurento.getComplexType('IceCandidate')(event.candidate);
                                                var data_ = {
                                                    eventOp        : 'Candidate',
                                                    usage: 'screen',
                                                    useMediaSvr: 'Y',
                                                    reqNo : '',
                                                    reqDate : commonFn.getDate(),
                                                    userId : data.userId,
                                                    roomId : data.roomId,
                                                    candidate : event.candidate
                                                };
                                                commonFn.reqNo().then(function(reqResult){
                                                    data_.reqNo=reqResult;
                                                    socket.to(id).emit('knowledgetalk', data_);
                                                    logger.log('info', `[Media -> Signal -> App] ${data.userId}에게 Candidate 전송 : ${JSON.stringify(data_)}`);
                                                }).catch(function(errer) {
                                                    console.log("error");
                                                });
                                            });
                                            //console.log(data.sdp);
                                            console.log('screenViwer[id] --->', screenViwer[id]);

                                            // let _sdp = data.sdp.sdp;
                                            // _sdp = _sdp.replace('a=ice-options:trickle\r\n', '');
                                            screenViwer[id].webrtcEndpoint.processOffer(data.sdp.sdp, function(error, sdpAnswer) {
                                                // console.log('offer <--- ', _sdp);
                                                logger.log('info', `[ ${data.eventOp} / Signal->App] sdp offer 받음 : ${JSON.stringify(viewerId)}, ${JSON.stringify(error) }`);
                                                if (error) {
                                                    return callback(error);
                                                }

                                                saddScreenShareSessionInfoToRedis (data.roomId, id, viewers_webrtcEndpoint.id, false )

                                                syncFn.getRedisServer().slave.HGET('SCREEN_SHARE_ROOMS_INFO', roomId, function(err, _results) {
                                                    console.log('SCREEN_SHARE_ROOMS_INFO User가 webrtcEndpoint id 꺼내는 중 :', _results);
                                                    logger.log('info', `User가 webrtcEndpoint id 꺼내는 중 : ${_results}`);
                                                    if(err) return new Error(err);
                                                    let result = JSON.parse(_results);
                                                    _kurentoClient.getMediaobjectById(result.webrtcEndpoint_id, function(err, host_webrtcEndpoint){
                                                        console.log('+++++++++++++++++++++++++ user webrtcEndPoint 비교 1 :::: ', JSON.stringify(screenViwer[id].webrtcEndpoint));
                                                        host_webrtcEndpoint.connect(viewers_webrtcEndpoint, function(error) {
                                                            console.log('user의 _webrtcEndpoint connect 성공!!!!', err, error);
                                                            logger.log('info', `[ ${data.eventOp} / Signal->App] Endpoint :  ${JSON.stringify(viewerId)}`);
                                                            if (error) {
                                                                console.log('#### error ---> ', error);
                                                                return callback(error);
                                                            }

                                                            var callbackData ={
                                                                type: "answer",
                                                                sdp	: sdpAnswer
                                                            };

                                                            logger.log('info', `[ ${data.eventOp} / Signal->App] answer sdpAnswer 생성 완료 : ${JSON.stringify(viewerId)}`);
                                                            return callback(callbackData);
                                                        });
                                                    });
                                                });
                                            });

                                            viewers_webrtcEndpoint.gatherCandidates(function(error) {
                                                if (error) {
                                                    //this.stop(room, sessionId);
                                                    return callback(error);
                                                }
                                            });
                                        }
                                    })
                                }
                            })();
                        }
                    })

                });
            }

        } else {
            // TODO 에러 리턴해야한다.
            console.log('redis에 정보 없음.');
        }
    });

}

exports.screenClearCandidatesQueue = function (sessionId) {
	//var room = getRoomInfo(sessionId);
	//console.log("clearCandidatesQueue = ", room);

	if (screenCandidatesQueue[sessionId] != null) {
		delete screenCandidatesQueue[sessionId];
	}
};

exports.screenOnIceCandidate = function(sessionId, _candidate) {

    var candidate = kurento.getComplexType('IceCandidate')(_candidate);
    //console.info('Queueing candidate');
    //
    // if(candidate.sdpMid === 'audio') {
    //     //iamabook. 180720. 화면공유 시 audio 취급하지 않을 때에만 적용한다
    //     return false;
    // }
    if (screenMaster[sessionId]) {
        console.log('---------------- screenMaster ----------------- : ', screenMaster[sessionId]);
        var webrtcEndpoint = screenMaster[sessionId].webrtcEndpoint;
        webrtcEndpoint.addIceCandidate(candidate);
    } else {
        console.info('Queueing candidate');
        if (!screenCandidatesQueue[sessionId]) {
            screenCandidatesQueue[sessionId] = [];
        }

        screenCandidatesQueue[sessionId].push(candidate);
    }

    if (screenViwer[sessionId]) {
        console.log('screenMaster[sessionId] 있는 경우. webrtcEndpoint.addIceCandidate(candidate);');
        var webrtcEndpoint2 = screenViwer[sessionId].webrtcEndpoint;
        console.log(webrtcEndpoint2);
        webrtcEndpoint2.addIceCandidate(candidate);
    } else {
        console.info('Queueing candidate');
        if (!screenCandidatesQueue[sessionId]) {
            screenCandidatesQueue[sessionId] = [];
        }

        screenCandidatesQueue[sessionId].push(candidate);
    }
};

function getMediaServerUrl (retryCounter, callback) {
    if (!mediaServerUrls) {
        mediaServerUrls = commonFn.getMediaServerUrls();
    }

    logger.log('info', `-----------------> MediaServer URL :: ${mediaServerUrls}`);

    if(retryCounter >= mediaServerUrls.length) {
        callback(null);
    }

    let m_url = mediaServerUrls[mediaServerCounter++ % mediaServerUrls.length];
    console.log("M_URL IS:: " + m_url);

    request.get('http://'+ m_url, function (error, response, body) {
        if (typeof response !== 'undefined') {
            console.log(response.statusCode);

            if(response.statusCode === 426) {
                callback(m_url);
            } else {
                retryCounter++;
                getMediaServerUrl(retryCounter, callback);
            }

        } else {
            retryCounter++;
            getMediaServerUrl(retryCounter, callback);
        }
    });

}

exports.checkMediaServerStatus = function (retryCounter, callback) {
    let resp = false;

    mediaServerUrls = commonFn.getMediaServerUrls();
    if(retryCounter >= mediaServerUrls.length) {
        callback(resp);
        return false;
    }

    let m_url = mediaServerUrls[retryCounter % mediaServerUrls.length];

    request.get('http://'+ m_url, function (error, response, body) {
        if (typeof response !== 'undefined') {
            if(response.statusCode === 426) {
                resp = true;
                callback(resp);
            } else {
                retryCounter++;
                exports.checkMediaServerStatus(retryCounter, callback);
            }

        } else {
            retryCounter++;
            exports.checkMediaServerStatus(retryCounter, callback);
        }


    });
};

exports.checkMediaServerIsAlive = function (m_url, callback) {
    let url_wo_ws = m_url.replace('ws://', '');

    request.get('http://'+ url_wo_ws, function (error, response, body) {
        if (typeof response !== 'undefined') {
            if(response.statusCode === 426) {
                callback(true);
            } else {
                callback(false);
            }
        } else {
            callback(false);
        }
    });
};

//180308. iamabook.
function hsetSessionInfoToRedis (room_id, session_id, webrtcendpoint_id, hubport_id, filter_id ) {
    let session_info_data = {
        webrtcendpoint_id : webrtcendpoint_id,
        hubport_id : hubport_id
    };
    if(filter_id) session_info_data.filter_id = filter_id;

    syncFn.getRedisServer().master.HSET("CONFERENCE:"+room_id+":SESSION_INFO", session_id, JSON.stringify(session_info_data));
}

//180713. iamabook.
function saddScreenShareSessionInfoToRedis (room_id, session_id, rtpendpoint_id, is_screen_share_host ) {
    let session_info_data = {
        session_id : session_id,
        rtpendpoint_id : rtpendpoint_id,
        is_screen_share_host : is_screen_share_host
    };

    syncFn.getRedisServer().master.SADD("SCREENSHARE:"+room_id+":SESSION_INFO", JSON.stringify(session_info_data));
}

function spopScreenShareSessionInfoToRedis (masterRedis, room_id, session_info_arr, callback) {
    masterRedis.SPOP("SCREENSHARE:"+room_id+":SESSION_INFO", function(err, resp){
        if(resp){
            let session_info = JSON.parse(resp);
            session_info_arr.push(session_info);
            spopScreenShareSessionInfoToRedis(masterRedis, room_id, session_info_arr, callback);
        } else {
            return callback(session_info_arr);
        }
    })
}
