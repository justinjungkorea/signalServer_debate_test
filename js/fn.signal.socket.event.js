const commonFn = require('./fn.common.service');
const syncFn = require('./fn.sync.service');
const logger = require('../common/logger');
const fn_Kurento = require('./fn.kurento.service');
const schedulerEvent = require('./fn.scheduler.service');
const PushFn = require('./fn.push.service');
const coreConnector = commonFn.coreConnector;
const signalSocket = commonFn.signalSocket;
const fn_janus = require('./fn.janus.service');
const request = require('request');

const {Scheduler} = require('./fn.timeout.service');

//janus
const sjj = require('sdp-jingle-json');
//janus end.

let scheduleObj = null;
let isSchJobPlayOnce = true;
// logger.initLog('./log/signal.server');

const signalServerEvent = async function (socket, signalSocketio, /*coreSocketio,*/ masterRedis, slaveRedis, sessionId, pid) {

    let redisInfo = {
        master: masterRedis,
        slave: slaveRedis
    };

    if (isSchJobPlayOnce) {
        isSchJobPlayOnce = false;
        logger.log('info', `Process Id : ' ${pid}`);
        await commonFn.setServerInfo(signalSocketio);
        //schedulerEvent.readyCall.start(signalSocketio, coreSocketio, masterRedis, slaveRedis, pid);
        // schedulerEvent.timeout.start(signalSocketio, coreSocketio, masterRedis, slaveRedis, pid);

        //janus.
        fn_janus.init(signalSocketio, redisInfo);
        //janus end.
    }

    socket.on("disconnect", function () {
        console.log("disconnection!!!!", sessionId);
        console.log('is DISconnection, Process Id : ', pid);

        /**
         * 해당 소켓이 share resoure를 가지고 있는지 체크하고 가지고 있다면 모두 해지.
         */
        commonFn.hasSession(masterRedis, slaveRedis, sessionId, function (err, msg, data) {

            if (err) {
                console.error(err)
            }

            if (msg === 'There is no data in redis') {
                logger.log('info', `[Disconnect Event: Session realese] There is no data in redis  :  ${sessionId}`);
                console.log('info', '[Disconnect Event: Session realese] There is no data in redis  : ', sessionId);
                return;
            }

            if (msg === 'This user dose not have a room') {
                logger.log('info', `[Disconnect Event: Session realese] This user dose not have a room  :  ${sessionId}`);
                console.log('info', '[Disconnect Event: Session realese] This user dose not have a room  : ', sessionId);
                return;
            }

            if (msg === 'The user who use consultant app do not have to use this api') {
                logger.log('info', `[Disconnect Event: Session realese] The user who use consultant app do not have to use this api  :  ${sessionId}`);
                console.log('info', '[Disconnect Event: Session realese] The user who use consultant app do not have to use this api  : ', sessionId);
                return;
            }

            if (msg === 'This user does not have a share resource') {
                logger.log('info', `[Disconnect Event: Session realese] This user does not have a share resource  : ${sessionId}`);
                console.log('info', '[Disconnect Event: Session realese] This user does not have a share resource  : ', sessionId);
                return;
            }

            if (msg === 'Unknown result') {
                logger.log('info', `[Disconnect Event: Session realese] Unknown result  :  ${sessionId}`);
                console.log('info', '[Disconnect Event: Session realese] Unknown result  : ', sessionId);
                return;
            }

            if (msg === 'This user have a share resource') {
                logger.log('info', `[Disconnect Event: Session realese] Unknown result  :  ${sessionId}`);
                console.log('info', '[Disconnect Event: Session realese] Unknown result  : ', sessionId);
                commonFn.reqNo().then(function (_reqNo) {

                    let resetData = {
                        signalOp: 'Reset',
                        reqNo: _reqNo,
                        reqDate: commonFn.getDate(),
                    }

                    let whiteboardEndData = {
                        eventOp: 'WhiteBoardEndSvr',
                        roomId: data.roomId,
                        reqNo: _reqNo,
                        reqDate: commonFn.getDate(),
                    }

                    signalSocket.broadcast(socket, data.roomId, resetData);
                    signalSocket.broadcast(socket, data.roomId, whiteboardEndData);

                });

                return;
            }

        });
        ///////////////////SET하는거 하면 됨!

        logger.log('info', `[Socket : Disconnect Event] User Disconnection, Session Id is : ${sessionId}`);
        commonFn.logOut(socket, signalSocketio, /*coreSocketio,*/ masterRedis, slaveRedis, sessionId)
    });

    socket.on("knowledgetalk", async function (_data) {
        //janus. maybe it'll be common function.
        let sessionDataFromRedis = await syncFn.getUserSocketInfo(redisInfo.master, redisInfo.slave, sessionId);
        //janus end.

        let data = _data;

        if (data.eventOp !== 'SDP' && data.eventOp !== 'Candidate') {
            console.log('pid : ' + pid + ' /// [App -> Signal] Data : ', data);
        }

        logger.log('info', `[Socket : ' ${data.eventOp} ' Event / PID : ' ${JSON.stringify(pid)}  '] *\n* 현재 처리중 방향 : [App -> Signal] *\n* eventOp : ' ${data.eventOp} '*\n* ${data.userId} : ' ${data.userId} || ${sessionId} '*\n* App으로 부터 온 Data : * \n' ${JSON.stringify(data) }`);

        let eventOp = data.eventOp || '';
        let signalOp = data.signalOp || '';

        if (signalOp) {

            let sessionRoomId = await syncFn.getRoomId3(masterRedis, slaveRedis, sessionId);

            switch (signalOp) {

                case 'Chat':
                    let chatData = {
                        'signalOp': 'Chat',
                        'userId': data.userId,
                        'message': data.message,
                    };

                    syncFn.getRoomId4(masterRedis, slaveRedis, data.userId).then(function(roomId) {
                        signalSocket.broadcast(socket, roomId, chatData);
                        logger.log('info', `[Signal -> broadcast]  ${JSON.stringify(chatData)}`);
                    });
                    break;

                default:
                    break;
            }

        } else {
            //eventOp parameter check
            await (() => {
                return new Promise(async (resolve, reject) => {
                    if (data.eventOp === 'SDP' || data.eventOp === 'Candidate') {
                        if ((data.eventOp === 'SDP' && !data.sdp) || (data.eventOp === 'Candidate' && !data.candidate)) {
                            let resp = {
                                eventOp: data.eventOp,
                                reqNo: data.reqNo,
                                code: '481',
                                message: 'need to check parameter.'
                            };

                            data.code ? resolve() : signalSocket.emit(sessionId, resp, data);
                            return;
                        }
                    }

                    if (data.eventOp) {
                        // 190315 ivypark, eventOp 필수 parameter 체크
                        let _prm = await commonFn.paramChecker(data);
                        if (_prm) {
                            signalSocket.emit(sessionId, Object.assign(_prm, {
                                eventOp: data.eventOp,
                                reqNo: data.reqNo,
                                resDate: commonFn.getDate()
                            }), data);

                            return false;
                        }
                        resolve();
                    }
                })
            })();

            switch (eventOp) {
                case 'ServerInfo':
                    {
                        let info = await coreConnector.start(
                            sessionId,
                            'get',
                            `info/servers`,
                            {}
                        );
    
                        // coreConnector.emit(sessionId, data, function(results) {
                        signalSocket.emit(sessionId, {
                            'eventOp': data.eventOp,
                            'reqNo': data.reqNo,
                            'code': '200',
                            'message': 'OK',
                            'resDate': commonFn.getDate(),
                            'config': info.servers
                        }, data);
                        // });
    
                        break;
                    }
                case 'Call' :
                    {
                        let serverInfo = commonFn.serverInfo.getTurn();
                        let inviteData = {
                            'eventOp': 'Invite',
                            'reqNo': '',
                            'serviceType': 'video',
                            'userId': data.userId,
                            'reqDate': data.reqDate,
                            serverInfo,
                            //janus.
                            'isSfu': commonFn.isSfu()
                            //janus end.
                        };

                        if (data.targetId.indexOf(data.userId) > -1) {
                            data.targetId.splice(data.targetId.indexOf(data.userId), 1);
                        }

                        // coreConnector.emit(sessionId, {
                        //     eventOp: 'GetUserInfo',
                        //     reqDate: commonFn.getDate(),
                        //     userId: data.userId
                        // }, function (inf) {
                        //     if (typeof inf.result === 'object') {
                        //         inviteData.serviceType = (inf.result.device_type === 'pc') ? 'share' : 'video';
                        //     }
                        // });

                        syncFn.getUserInfo(masterRedis, slaveRedis, data.userId).then(async function (userInfo) {
                            console.log(userInfo);
                            let isFirstCall = !!userInfo.ROOM_ID;

                            let roomId = '';

                            //Array 인지 확인
                            if (!Array.isArray(data.targetId)) {
                                signalSocket.emit(sessionId, {
                                    eventOp: data.eventOp,
                                    reqNo: data.reqNo,
                                    code: '481',
                                    message: `type of 'targetId' field must be an ARRAY`
                                }, data);
                                return false;
                            }

                            if (!isFirstCall) {
                                logger.log('info', `[Socket : '  ${data.eventOp}  ' Event / 다자간 화상회의 / Call] *\n 최초 Call - 요청자 : ', ${data.userId}`);

                                commonFn.getRoomId().then(async function (roomObj) {

                                    let joinData = {
                                        'eventOp': 'UserState_Roomjoin',
                                        'userId': data.userId
                                    };

                                    roomId = roomObj;
                                    commonFn.getUserNumber(data.userId, function(userNumber) {
                                        syncFn.setRoom(masterRedis, slaveRedis, roomId, data.serviceType, data.userId, data.userName, sessionId, data.reqDeviceType, data.targetId, data.targetId.length, userNumber );
                                        socket.join(roomId);
                                    });

                                    inviteData.roomId = roomId;
                                    data.roomId = roomId;

                                    let userId = data.userId;

                                    // 190517 ivypark, core rest 변경건 수정.
                                    // 통화 발신자의 상태 변경 (busy)
                                    await coreConnector.start(
                                        sessionId,
                                        'put',
                                        `users/${data.userId}/status`,
                                        {}
                                    );

                                    // 190517 ivypark, core rest 변경건 수정.
                                    // history 초기 세팅
                                    let cHistory = await coreConnector.start(
                                        sessionId,
                                        'post',
                                        `rooms`,
                                        {
                                            userId: data.userId,
                                            targetId: data.targetId,
                                            roomId
                                        }
                                    );

                                    // 190517 ivypark, core rest 변경건 수정.
                                    // 현재 target들의 상태 확인
                                    let readyData = await coreConnector.start(
                                        sessionId,
                                        'post',
                                        `users/status`,
                                        {
                                            targetId: data.targetId
                                        }
                                    );

                                    console.log(`ivypark ::: `, readyData);
                                    console.log("상태결과:", readyData.result);
                                    let stateCheck = readyData.result;
                                    let acceptUser = [];
                                    let fullUser = [];
                                    let offlineUser = [];
                                    if (stateCheck) {
                                        for (let i = 0; i < stateCheck.length; i++) {
                                            if (stateCheck[i].user_state === 'ready') {
                                                acceptUser.push(stateCheck[i].id);
                                            }
                                            if (stateCheck[i].user_state === 'busy') {
                                                fullUser.push(stateCheck[i].id);
                                            }
                                            if (stateCheck[i].user_state === 'logout') {
                                                offlineUser.push(stateCheck[i].id);
                                            }
                                        }
                                    }
                                    logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의 / Call] *\n Online인 User : ', ${JSON.stringify(acceptUser)}`);
                                    logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의 / Call] *\n 회의중인 User : ', ${JSON.stringify(fullUser)}`);
                                    logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의 / Call] *\n Offline인 User : ', ${JSON.stringify(offlineUser)} `);

                                    let callDate = commonFn.getDate();
                                    let sendData = {
                                        'eventOp': 'Call',
                                        'reqNo': data.reqNo,
                                        'code': '200',
                                        'message': 'OK',
                                        'useMediaSvr': 'Y',
                                        'resDate': callDate,
                                        'roomId': roomId,
                                        'status': 'accept',
                                        //iamabook. 190201
                                        start_time: cHistory.result.start_time,
                                        serverInfo
                                    };

                                    if (acceptUser.length >= 1) {
                                        //janus.
                                        if (commonFn.isSfu() === true) {
                                            try {
                                                let mediaConstarint = commonFn.getMediaConstraint();
                                                //iamabook. 180207. initialRoomLength(data.targetId.length) 를 적용한 레이아웃 추가
                                                let n_columns = Math.ceil(Math.sqrt(data.targetId.length + 1)) - 1;
                                                if (n_columns < 1) n_columns = 1;

                                                let videoWidth = (Math.ceil(mediaConstarint.video.width / n_columns));
                                                let videoHeight = (Math.ceil((videoWidth * 9) / 16));
                                                let videoFramerate = mediaConstarint.video.framerate;

                                                if (data.targetId.length === 1) {
                                                    sendData.useMediaSvr = "N";
                                                    sendData.videoWidth = 1920;
                                                    sendData.videoHeight = 1080;
                                                    sendData.videoFramerate = videoFramerate;
                                                } else {
                                                    sendData.videoWidth = videoWidth;
                                                    sendData.videoHeight = videoHeight;
                                                    sendData.videoFramerate = videoFramerate;

                                                    sendData.isSfu = commonFn.isSfu();

                                                    let _data = {
                                                        roomId: roomId,
                                                        userId: sessionDataFromRedis.ID
                                                    };

                                                    await fn_janus.processJoinVideoRoom(sessionId, _data);
                                                }

                                                signalSocket.emit(sessionId, sendData, data);
                                            } catch (err) {
                                                console.log(err);
                                                //TODO ERROR CATCH

                                                sendData.code = '570';
                                                if(err) {
                                                    sendData.message = err.error;
                                                } else {
                                                    sendData.message = 'MediaServer Error.';
                                                }
                                                signalSocket.emit(sessionId, sendData, data);

                                                //TODO caller exitroom?
                                                return false;
                                            }
                                            logger.log('info', `[Socket : ' ${data.eventOp}  Event / 다자간 화상회의 / Call] *\n* 현재 처리중 방향 : [Signal -> App (Resp)] *\n* 요청자 : ' ${data.userId} ' *\n* eventOp : ' ${data.eventOp}  *\n App으로 전달할 Data : ', ${JSON.stringify(sendData) }`);
                                        }
                                        //janus end.

                                        // 190517 ivypark, core rest 변경건 수정.
                                        // 현재 target들의 상태 변경 (busy)
                                        acceptUser.forEach(elem => {
                                            coreConnector.start(
                                                sessionId,
                                                'put',
                                                `users/${elem}/status`,
                                                {
                                                    status: 'busy'
                                                }
                                            );
                                        });

                                        let count = acceptUser.length - 1;
                                        (function enterRoom() {
                                            let send_targetId = acceptUser[count];
                                            syncFn.getUserSocketId(masterRedis, slaveRedis, send_targetId).then(function (socketObj) {
                                                // if (err || !userName) {
                                                //     inviteData.userName = userId;
                                                // } else {
                                                //     inviteData.userName = userName;
                                                // }

                                                commonFn.reqNo().then(function (reqResult) {
                                                    inviteData.reqNo = reqResult;
                                                    syncFn.setMultiType(masterRedis, slaveRedis, userInfo.ROOM_ID).then(function (result) {
                                                        if (result === 'no data in redis') {		//처음초대했을때 ... 1:1 인지 다자간인지 체크
                                                            if (data.targetId.length === 1) {
                                                                inviteData.useMediaSvr = 'N';
                                                            } else {
                                                                inviteData.useMediaSvr = 'Y';
                                                            }
                                                        } else { 	// 처음초대가 아닌경우 .. 지속적인 다자간인지 1:1 인지 체크
                                                            if (result.MULTITYPE === 'Y') {
                                                                inviteData.useMediaSvr = 'Y';
                                                            } else {
                                                                if (data.targetId.length === 1) {
                                                                    inviteData.useMediaSvr = 'N';
                                                                } else {
                                                                    inviteData.useMediaSvr = 'Y';
                                                                }
                                                            }
                                                        }

                                                        if (inviteData.useMediaSvr === 'Y') {
                                                            //janus.
                                                            if (commonFn.isSfu() === true) {
                                                                signalSocketio.to(socketObj).emit('knowledgetalk', inviteData);
                                                                logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의 / Invite] *\n* 현재 처리중 방향 : [Signal -> App (Req)] *\n* 수신자 : ' ${JSON.stringify(send_targetId)} ' *\n Invite 메시지 : ' ${JSON.stringify(inviteData)}`);
                                                            } else {
                                                                setTimeout(function () {
                                                                    fn_Kurento.checkMediaServerStatus(0, function (mediaServerStatus) {
                                                                        if (mediaServerStatus === false) {
                                                                            console.log("MEDIASERVER IS DEAD!!");
                                                                        } else {
                                                                            signalSocket.emit(socketObj, inviteData, data);
                                                                            logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의 / Invite] *\n* 현재 처리중 방향 : [Signal -> App (Req)] *\n* 수신자 : '${JSON.stringify(send_targetId)}' *\n Invite 메시지 : ' ${JSON.stringify(inviteData)}`);
                                                                        }
                                                                    });
                                                                }, 3000);
                                                            }
                                                            //janus end.
                                                        } else {
                                                            setTimeout(function () {
                                                                signalSocket.emit(socketObj, inviteData, data);
                                                                logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의 / Invite] *\n* 현재 처리중 방향 : [Signal -> App (Req)] *\n* 수신자 : ' ${JSON.stringify(send_targetId)}' *\n Invite 메시지 :  ${JSON.stringify(inviteData)}`);
                                                            }, 3000);
                                                        }

                                                        // 180803 ivypark, enterRoom Invite에 추가. invite 대상이 초대 팝업이 뜨면 방장이 나갔을 때 사라져야 함. 요청 : kt
                                                        console.log('invite enterRoom -> ', send_targetId);
                                                        syncFn.enterRoom(masterRedis, slaveRedis, roomId, send_targetId, inviteData.userName, socketObj, '', 'accept').then(function (userList) {
                                                            if (count-- > 0) {
                                                                enterRoom();
                                                            }
                                                        })
                                                            .catch((err) => {
                                                                console.log(`ivypark ::::::::::::: `, err);
                                                                logger.log('warn', '사용자가 방에 정상적으로 참가되지 않았음.');
                                                            })
                                                        ;
                                                    })
                                                        .catch(() => {
                                                            // signalSocket.emit(sessionId, {
                                                            //     eventOp: data.eventOp,
                                                            //     resDate: commonFn.getDate(),
                                                            //     code: err.code,
                                                            //     message: err.message
                                                            // });
                                                            console.log('RoomsInfo에 Multitype setting 중 error ', '');
                                                            logger.log('warn', 'RoomsInfo에 Multitype setting 중 error');
                                                        });
                                                }).catch(function () {
                                                    console.log('ReqNo 다자간 화상회의 Invite error');
                                                });
                                            })
                                                .catch((err) => {
                                                    signalSocket.emit(sessionId, {
                                                        eventOp: data.eventOp,
                                                        resDate: commonFn.getDate(),
                                                        code: err.code,
                                                        message: err.message
                                                    }, data);
                                                    console.log('Sync Server Socket 정보가 없음. ', '로그인 되지 않은 상대에게 Call 전송');
                                                    logger.log('warn', 'Sync Server에 User 정보가 없음.', '로그인 되지 않은 상대에게 Call 전송');
                                                    return false;
                                                });
                                        })();
                                    } else {
                                        //Call 리스폰스 reject
                                        console.log("인원미존재");
                                        let callDate = commonFn.getDate();
                                        let sendData = {
                                            'eventOp': 'Call',
                                            'reqNo': data.reqNo,
                                            'code': '200',
                                            'message': 'OK',
                                            'useMediaSvr': 'Y',
                                            'resDate': callDate,
                                            'roomId': roomId,
                                            'status': ''
                                        };

                                        if (fullUser.length >= 1) {
                                            sendData.code = '424';
                                            sendData.message = 'Call : full';
                                            sendData.status = 'full';
                                        } else {
                                            sendData.code = '422';
                                            sendData.message = 'Call : offline';
                                            sendData.status = 'offline';
                                        }

                                        let mediaConstarint = commonFn.getMediaConstraint();

                                        //iamabook. 180207. initialRoomLength(data.targetId.length) 를 적용한 레이아웃 추가
                                        let n_columns = Math.ceil(Math.sqrt(data.targetId.length + 1)) - 1;
                                        if (n_columns < 1) n_columns = 1;

                                        let videoWidth = (Math.ceil(mediaConstarint.video.width / n_columns));
                                        let videoHeight = (Math.ceil((videoWidth * 9) / 16));
                                        let videoFramerate = mediaConstarint.video.framerate;

                                        sendData.videoWidth = videoWidth;
                                        sendData.videoHeight = videoHeight;
                                        sendData.videoFramerate = videoFramerate;

                                        if (data.targetId.length === 1) {
                                            let joinData = {
                                                'eventOp': 'MultiViewChange',
                                                'reqNo': data.reqNo,
                                            };

                                            sendData.videoWidth = 1920;
                                            sendData.videoHeight = 1080;

                                            joinData.videoWidth = videoWidth;
                                            joinData.videoHeight = videoHeight;
                                            joinData.videoFramerate = videoFramerate;

                                            sendData.useMediaSvr = "N";
                                            fn_Kurento.addUserToConferenceWaitingLine(masterRedis, slaveRedis, roomId, sessionId, signalSocketio, joinData, sendData.useMediaSvr);
                                        }

                                        signalSocket.emit(sessionId, sendData, data);
                                        logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의 / Call] *\n* 현재 처리중 방향 : [Signal -> App (Resp)] *\n* 요청자 : ' ${data.userId} ' *\n* eventOp : ' ${data.eventOp} ' *\n App으로 전달할 Data : ', ${JSON.stringify(sendData)}`);

                                    }
                                });
                            } else {
                                //초대인 경우
                                console.log('현재 회의중 - 초대.');
                                inviteData.roomId = userInfo.ROOM_ID;
                                let stateCheck;
                                let userId = data.userId;
                                if (userInfo.ROOM_ID !== data.roomId) {
                                    //방장의 방정보와 서버쪽 방정보와 맞지않음
                                    logger.log('Error', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의 / Call, Error] *\n 방장의 방 정보와 서버의 방 정보가 맞지 않음. `);
                                    console.log("방정보가 맞지않습니다.");
                                } else {
                                    let rooms_info_b4_setMultiType = await syncFn.getRoom(redisInfo.slave, sessionDataFromRedis.ROOM_ID);

                                    if (typeof(data.targetId) === 'object') {
                                        //DB에 초대가능여부 판단
                                        logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의 / Call] *\n 통화중 User 초대 - 요청자 : ', ${data.userId}`);

                                        let stateData = {
                                            'eventOp': 'State_Check',
                                            'targetId': data.targetId,
                                        };

                                        // 190517 ivypark, core rest 변경건 수정.
                                        // 현재 target들의 상태 확인
                                        let readyData = await coreConnector.start(
                                            sessionId,
                                            'post',
                                            `users/status`,
                                            {
                                                targetId: data.targetId
                                            }
                                        );

                                        logger.log('info', `Target Id 상태 체크 ${JSON.stringify(readyData) }` );
                                        stateCheck = readyData.result;
                                        let acceptUser = [];
                                        let fullUser = [];
                                        let offlineUser = [];
                                        if (stateCheck) {
                                            for (let i = 0; i < stateCheck.length; i++) {
                                                if (stateCheck[i].user_state === "ready") {
                                                    acceptUser.push(stateCheck[i].id);
                                                }
                                                if (stateCheck[i].user_state === "busy") {
                                                    fullUser.push(stateCheck[i].id);
                                                }
                                                if (stateCheck[i].user_state === "logout") {
                                                    offlineUser.push(stateCheck[i].id);
                                                }
                                            }
                                        }

                                        logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의 / Call] *\n Online인 User : ', ${JSON.stringify(acceptUser)} || '없음'`);
                                        logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의 / Call] *\n 회의중인 User : ', ${JSON.stringify(fullUser)} || '없음'`);
                                        logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의 / Call] *\n Offline인 User : ', ${JSON.stringify(offlineUser )}|| '없음'`);

                                        if (acceptUser.length >= 1) {
                                            for (let i = 0; i < acceptUser.length; i++) {
                                                let res = await(() => {
                                                    return new Promise((resolve, reject) => {                                                
                                                    let send_targetId = acceptUser[i];

                                                    // 190517 ivypark, core rest 변경건 수정.
                                                    // 현재 target들의 상태 변경 (busy)
                                                    coreConnector.start(
                                                        sessionId,
                                                        'put',
                                                        `users/${send_targetId}/status`,
                                                        {
                                                            status: 'busy'
                                                        }
                                                    );
                                                    syncFn.getUserSocketId(masterRedis, slaveRedis, send_targetId).then(
                                                        function (socketObj) {
                                                            commonFn.reqNo().then(function (reqResult) {
                                                                inviteData.reqNo = reqResult;
                                                                syncFn.setMultiType(masterRedis, slaveRedis, userInfo.ROOM_ID).then(async function (result) {
                                                                    if (result.MULTITYPE === 'Y') {
                                                                        inviteData.useMediaSvr = 'Y';
                                                                    } else {
                                                                        if (acceptUser.length === 1) {
                                                                            inviteData.useMediaSvr = 'N';
                                                                        } else {
                                                                            inviteData.useMediaSvr = 'Y';
                                                                        }
                                                                    }

                                                                    // 190710 ivypark, enterRoom이 Join 보다 늦게 일어나는 현상에 대한 수정 (솔루션 본부 야누스 테스트 중 발견)
                                                                    // 180803 ivypark, enterRoom Invite에 추가. invite 대상이 초대 팝업이 뜨면 방장이 나갔을 때 사라져야 함. 요청 : kt
                                                                    console.log('invite enterRoom -> ', send_targetId,roomId);
                                                                    await syncFn.enterRoom(masterRedis, slaveRedis, data.roomId, send_targetId, inviteData.userName, socketObj, '', 'accept').then(function (userList) {});

                                                                    if (inviteData.useMediaSvr === 'Y') {
                                                                        //janus.
                                                                        if(commonFn.isSfu() === true) {
                                                                            // let count = 0;
                                                                            let mediaConstarint = commonFn.getMediaConstraint();
                                                                            //iamabook. 180207. initialRoomLength(data.targetId.length) 를 적용한 레이아웃 추가
                                                                            let n_columns = Math.ceil(Math.sqrt(data.targetId.length + 1 + 2)) - 1; //기존인원 2를 추가한 사이즈 적용
                                                                            if (n_columns < 1) n_columns = 1;

                                                                            let videoWidth = (Math.ceil(mediaConstarint.video.width / n_columns));
                                                                            let videoHeight = (Math.ceil((videoWidth * 9) / 16));
                                                                            let videoFramerate = mediaConstarint.video.framerate;

                                                                            if(rooms_info_b4_setMultiType.MULTITYPE === 'N') {
                                                                                try{
                                                                                    let janus_url = await fn_janus.getMediaServer();
                                                                                    await syncFn.setJanusServer(redisInfo, {roomId: sessionDataFromRedis.ROOM_ID, janus_url: janus_url});
                                                                                    let createroom = await fn_janus.createRoom(janus_url, 50);
                                                                                    let __data = {roomId: sessionDataFromRedis.ROOM_ID, janus_room_id: createroom.janusRoomId};
                                                                                    await syncFn.setJanusRoomId(redisInfo, __data);

                                                                                    for(let each_id in result.USERS) {
                                                                                        if (result.USERS[each_id].JOINED === 'join') {
                                                                                            let user_id_data = await syncFn.getUserInfo(redisInfo.master, redisInfo.slave, each_id);
                                                                                            let _data = {
                                                                                                roomId: user_id_data.ROOM_ID,
                                                                                                userId: each_id,
                                                                                                janus_url: janus_url,
                                                                                                janusRoomId: createroom.janusRoomId
                                                                                            };

                                                                                            let joinroom = await fn_janus.processJoinVideoRoom(user_id_data.SOCKET_ID, _data);

                                                                                            let multiviewChangeData = {
                                                                                                'eventOp': 'MultiViewChange',
                                                                                                'reqNo': data.reqNo,
                                                                                                'isSfu': commonFn.isSfu()
                                                                                            };
                                                                                            multiviewChangeData.videoWidth = videoWidth;
                                                                                            multiviewChangeData.videoHeight = videoHeight;
                                                                                            multiviewChangeData.videoFramerate = videoFramerate;

                                                                                            signalSocket.emit(user_id_data.SOCKET_ID, multiviewChangeData, data);
                                                                                        }
                                                                                    }

                                                                                } catch (e) {
                                                                                    console.log(e);
                                                                                    let errdata = {
                                                                                            'eventOp' : data.eventOp,
                                                                                            'reqData' : data.reqData,
                                                                                            'reqNo' : data.reqNo,
                                                                                            'userId' : data.userId,
                                                                                            'serviceType' : data.serviceType,
                                                                                            'roomId' : data.roomId,
                                                                                            'code' : '570',
                                                                                            'message': 'MediaServer Error'
                                                                                    }

                                                                                    await syncFn.changeMultiType(masterRedis, slaveRedis, data.roomId);
                                                                                    console.log("error JOIN WITH JANUS ERROR ", errdata);

                                                                                    signalSocket.emit(socketObj, errdata);
                                                                                    return false;
                                                                                }
                                                                            }
                                                                            signalSocket.emit(socketObj, inviteData, data);
                                                                        } else {
                                                                            fn_Kurento.checkMediaServerStatus(0, function (mediaServerStatus) {
                                                                                if (mediaServerStatus === false) {
                                                                                    console.log("MEDIASERVER IS DEAD!!");
                                                                                } else {
                                                                                    signalSocket.emit(socketObj, inviteData, data);
                                                                                    logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의 / Invite] *\n* 현재 처리중 방향 : [Signal -> App (Req)] *\n* 수신자 : ' + ${JSON.stringify(send_targetId)} + ' *\n Invite 메시지 : ', ${JSON.stringify(inviteData)}`);
                                                                                }
                                                                            });
                                                                        }
                                                                    } else {
                                                                        signalSocket.emit(socketObj, inviteData, data);
                                                                        logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의 / Invite] *\n* 현재 처리중 방향 : [Signal -> App (Req)] *\n* 수신자 : ' + ${JSON.stringify(send_targetId)} + ' *\n Invite 메시지 : ', ${JSON.stringify(inviteData)}`);
                                                                    }
                                                                    resolve(false);
                                                                })
                                                                .catch(() => {
                                                                    // signalSocket.emit(sessionId, {
                                                                    //     eventOp: data.eventOp,
                                                                    //     resDate: commonFn.getDate(),
                                                                    //     code: err.code,
                                                                    //     message: err.message
                                                                    // });
                                                                    console.log('RoomsInfo에 Multitype setting 중 error ', '');
                                                                    logger.log('warn', 'RoomsInfo에 Multitype setting 중 error');
                                                                });
                                                            });
                                                        })
                                                        .catch(() => {  
                                                            // signalSocket.emit(sessionId, {
                                                            //     eventOp: data.eventOp,
                                                            //     resDate: commonFn.getDate(),
                                                            //     code: err.code,
                                                            //     message: err.message
                                                            // });
                                                            console.log('Sync Server Socket 정보가 없음. ', '로그인 되지 않은 상대에게 Call 전송');
                                                            logger.log('warn', 'Sync Server에 User 정보가 없음.', '로그인 되지 않은 상대에게 Call 전송');
                                                        });
                                                    }) 
                                                })();
                                            }
                                            //Call 리스폰스 accet
                                            let callDate = commonFn.getDate();
                                            let sendData = {
                                                'eventOp': 'Call',
                                                'reqNo': data.reqNo,
                                                'code': '200',
                                                'message': 'OK',
                                                'useMediaSvr': (data.targetId.length === 1) ? 'N' : 'Y',
                                                'resDate': callDate,
                                                'roomId': userInfo.ROOM_ID,
                                                'status': 'invite'
                                            };

                                            let mediaConstarint = commonFn.getMediaConstraint();
                                            let videoWidth = mediaConstarint.video.width;
                                            let videoHeight = mediaConstarint.video.height;
                                            let videoFramerate = mediaConstarint.video.framerate;
                                            //videoWidth	=	'1280',
                                            //videoHeight	=	'720',
                                            //videoFramerate	= '8'

                                            sendData.videoWidth = videoWidth;
                                            sendData.videoHeight = videoHeight;
                                            sendData.videoFramerate = videoFramerate;
                                            syncFn.setMultiType(masterRedis, slaveRedis, userInfo.ROOM_ID).then(function (result) {
                                                console.log('>>>>>>>>>> setMultiType ::::::::: ', result);

                                                if (result.MULTITYPE === 'Y') {

                                                    // 180709 ivypark, useMediaSvr Y 인 경우에만 미디어 서버 상태 체크하도록 수정
                                                    //180219. iamabook. multi에서 call 수신시 미더어섭 상태 체크.
                                                    let isSendCallResp = false;
                                                    fn_Kurento.checkMediaServerStatus(0, function (mediaServerStatus) {
                                                        if (mediaServerStatus === false) {
                                                            let sendData = {
                                                                'eventOp': 'Call',
                                                                'reqNo': data.reqNo,
                                                                'code': '570',
                                                                'message': 'Media Server Error.',
                                                                //iamabook. 190207. 미디어서버 오프라인일 때 ExitRoom 처리 위한 roomid 추가
                                                                'roomId' : userInfo.ROOM_ID,
                                                                'resDate': commonFn.getDate()
                                                            };

                                                            if (!isSendCallResp) {
                                                                console.log("MEDIASERVER IS DEAD!!");
                                                                isSendCallResp = true;
                                                                signalSocket.emit(sessionId, sendData, data);
                                                                logger.log('error', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의 / Call] *\n* 현재 처리중 방향 : [Signal -> Media Server] *\n MEDIASERVER IS DEAD!!`);
                                                                logger.log('info', `[Signal -> App] Call [notExist]', ${commonFn.setJSON(sendData)}`);
                                                            }
                                                        } else {
                                                            fn_Kurento.popUserFromConferenceWaitingLine(masterRedis, slaveRedis, signalSocketio, userInfo.ROOM_ID);
                                                            sendData.useMediaSvr = result.MULTITYPE;
                                                            signalSocket.emit(sessionId, sendData, data);
                                                            logger.log('info', `[Socket : '  ${data.eventOp} ' Event / 다자간 화상회의 / Call] *\n* 현재 처리중 방향 : [Signal -> App (Resp)] *\n* 요청자 : ' ${data.userId}' *\n* eventOp : ' ${data.eventOp} ' *\n App으로 전달할 Data : ', ${JSON.stringify(sendData)}`);
                                                        }
                                                    });

                                                } else {
                                                    sendData.videoWidth = 1920;
                                                    sendData.videoHeight = 1080;
                                                    sendData.useMediaSvr = result.MULTITYPE;
                                                    signalSocket.emit(sessionId, sendData, data);
                                                    logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의 / Call] *\n* 현재 처리중 방향 : [Signal -> App (Resp)] *\n* 요청자 : ' ${data.userId} ' *\n* eventOp : ' ${data.eventOp} ' *\n App으로 전달할 Data : ', ${JSON.stringify(sendData)}`);
                                                }

                                            }).catch(function () {
                                                console.log('멀티타입변경에러');
                                            });
                                        } else {
                                            //Call 리스폰스 reject
                                            console.log("인원미존재");

                                            let callDate = commonFn.getDate();
                                            let sendData = {
                                                'eventOp': 'Call',
                                                'reqNo': data.reqNo,
                                                'code': '200',
                                                'message': 'OK',
                                                'useMediaSvr': 'Y',
                                                'resDate': callDate,
                                                'roomId': userInfo.ROOM_ID,
                                                'status': '',
                                            };
                                            console.log(fullUser);
                                            if (fullUser.length >= 1) {
                                                sendData.code = '424';
                                                sendData.message = 'Call : full';
                                                sendData.status = 'invite';
                                            } else {
                                                sendData.code = '422';
                                                sendData.message = 'Call : offline';
                                                sendData.status = 'invite';
                                            }

                                            let mediaConstarint = commonFn.getMediaConstraint();
                                            let videoWidth = mediaConstarint.video.width;
                                            let videoHeight = mediaConstarint.video.height;
                                            let videoFramerate = mediaConstarint.video.framerate;

                                            sendData.videoWidth = videoWidth;
                                            sendData.videoHeight = videoHeight;
                                            sendData.videoFramerate = videoFramerate;

                                            // Room 내의 초대자 인원 파악
                                            // 초대자 중에 한번 더 초대한 사람이 있는 지 확인
                                            // 없다면 그대로 진행
                                            // 있을때, data.targetId가 1명이면 return;
                                            // 있을때, data.targetId가 2명 이상이면 해당 인원 지우고 그대로 진행

                                            // 180723 ivypark, instead over.....

                                            syncFn.getMultiType(masterRedis, slaveRedis, userInfo.ROOM_ID).then(function (result) {
                                                console.log('gMT --> ', result);
                                                if (result === 'N') {
                                                    sendData.useMediaSvr = 'N';
                                                    sendData.videoWidth = 1920;
                                                    sendData.videoHeight = 1080;
                                                }

                                                signalSocket.emit(sessionId, sendData, data);
                                                logger.log('info', `[Socket : '${data.eventOp} ' Event / 다자간 화상회의 / Call] *\n* 현재 처리중 방향 : [Signal -> App (Resp)] *\n* 요청자 : ' ${data.userId}  ' *\n* eventOp : '${data.eventOp}  ' *\n App으로 전달할 Data : ', ${JSON.stringify(sendData)}`);
                                            })
                                            .catch(() => {
                                                // signalSocket.emit(sessionId, {
                                                //     eventOp: data.eventOp,
                                                //     resDate: commonFn.getDate(),
                                                //     code: err.code,
                                                //     message: err.message
                                                // });
                                                console.log('RoomsInfo에 Multitype setting 중 error ', '');
                                                logger.log('warn', 'RoomsInfo에 Multitype setting 중 error');
                                            });
                                        }
                                    }
                                }
                            }
                        })
                            .catch((err) => {
                                signalSocket.emit(sessionId, {
                                    eventOp: data.eventOp,
                                    resDate: commonFn.getDate(),
                                    code: err.code,
                                    message: err.message
                                }, data);
                                console.log('Sync Server에 User 정보가 없음.', '로그인 하지 않은 상태에서 Call');
                                logger.log('warn', 'Sync Server에 User 정보가 없음. 로그인 하지 않은 상태에서 Call');
                            });

                        break;
                    }
                case 'Invite':
                    break;

                case 'Join':
                    {
                        let resDate = commonFn.getDate();

                        let presenceData = {
                            'signalOp': 'Presence',
                            'userId': data.userId,
                            'userName': data.userName || '',
                            'action': 'join'
                        };

                        let clearPresenceData = {
                            'signalOp': 'Presence',
                            'userId': data.userId,
                            'userName': data.userName || '',
                            'action': 'exit'
                        };

                        let joinData = {
                            'eventOp': 'Join',
                            'reqNo': data.reqNo,
                            'code': '200',
                            'message': 'OK',
                            'useMediaSvr': 'Y',
                            'resDate': resDate,
                            'roomId': data.roomId
                        };

                        //kayoon 20190701 이중 Join 될시 예외처리. 
                        syncFn.getRoomId3(masterRedis, slaveRedis, sessionId).then(function (roomId) {
                            if(roomId){
                                let joinData = {
                                    'eventOp': 'Join',
                                    'reqNo' : '',
                                    'reqDate': commonFn.getDate(),
                                    'message': 'already room ',
                                    'code': '426' 
                                };
                                signalSocket.emit(sid, joinData, data);
                                return false;  
                            }                       
                        })              

                        syncFn.getRoom(slaveRedis, data.roomId).then(async function (roomResult) {
                            console.log("룸아이디 존재할경우", data.status);
                            // 18.03.13 ivypark // join // @param data.status ++ // join status check, memberlist managing
                            // 180803 ivypark, enterRoom Invite로 옮김.
                            // return syncFn.enterRoom(masterRedis, slaveRedis, data.roomId, data.userId, data.userName, sessionId, data.reqDeviceType, data.status).then(function (userList) {

                            if (data.status === 'accept') {
                                //방안에 입장.
                                console.log(roomResult);
                                let admin = roomResult.ADMIN;
                                let _userList = roomResult.USERS;

                                socket.join(data.roomId);
                                await syncFn.setJoinFlag(masterRedis, slaveRedis, data.roomId, data.userId, 'join');

                                joinData.memberList = _userList;
                                joinData.admin = admin;

                                let mediaConstraint = commonFn.getMediaConstraint();
                                let initialWidth = mediaConstraint.video.width;

                                let n_columns = Math.ceil(Math.sqrt(_userList.length)) - 1;
                                if (n_columns < 1) n_columns = 1;

                                //iamabook. 180207. initialRoomLength 를 적용한 레이아웃 추가
                                if (roomResult.initialRoomLength) {
                                    if (_userList.length < roomResult.initialRoomLength) {
                                        n_columns = Math.ceil(Math.sqrt(roomResult.initialRoomLength)) - 1;
                                        if (n_columns < 1) n_columns = 1;
                                    }
                                }

                                let videoWidth = (Math.ceil(initialWidth / n_columns));
                                let videoHeight = (Math.ceil((videoWidth * 9) / 16));

                                joinData.videoWidth = videoWidth;
                                joinData.videoHeight = videoHeight;
                                joinData.videoFramerate = mediaConstraint.video.framerate;

                                // 180727 ivypark, userCount 추가.
                                presenceData.userCount = _userList.length;
                                signalSocket.broadcast(socket, data.roomId, presenceData);
                                logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의 / Presence / 성공] *\n* 현재 처리중 방향 : [Signal -> App (Pass)] *\n App으로 전달할 Data : ', ${JSON.stringify(presenceData)}`);

                                let stateData = {
                                    'eventOp': 'UserState_Roomjoin',
                                    'userId': data.userId,
                                };

                                //iamabook. 190207. join 시 ConferenceHistory에 참여자 id 추가
                                // coreConnector.emit(sessionId, { 'eventOp': 'UpdateConferenceHistory', 'roomId': data.roomId, 'userId': data.userId, 'status': 'join' }, data => {
                                //     logger.log('info', `UpdateConferenceHistory callback  ${JSON.stringify(data)}`);
                                // });

                                let results = await coreConnector.start(
                                    sessionId,
                                    'put',
                                    `rooms/${data.roomId}/join`,
                                    {
                                        userId: data.userId
                                    }
                                );

                                console.log(`ivypark, `, results);
                                //janus.
                                if (roomResult.MULTITYPE && roomResult.MULTITYPE === 'N') {
                                    joinData.videoWidth = 1920;
                                    joinData.videoHeight = 1080;
                                    joinData.useMediaSvr = roomResult.MULTITYPE;
                                    signalSocket.emit(sessionId, joinData, data);
                                    logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의 / 성공] *\n* 현재 처리중 방향 : [Signal -> App (Resp)] *\n* 요청자 : ' ${data.userId}' *\n* eventOp : ' ${data.eventOp} ' *\n App으로 전달할 Data : ', ${JSON.stringify(joinData)}`);
                                } else {
                                    if (data.isSfu === true) {
                                        try {
                                            let _data = {
                                                janus_url: await syncFn.getJanusServerByRoomId(redisInfo, data.roomId),
                                                janusRoomId: await syncFn.getJanusRoomId(redisInfo, data.roomId),
                                                roomId: sessionDataFromRedis.ROOM_ID,
                                                userId: sessionDataFromRedis.ID
                                            };
                                            await fn_janus.processJoinVideoRoom(sessionId, _data);

                                            // cho. 190924. 다자간 인원 수에 따라 janus room bitrate 변경
                                            if (_userList.length > 2 && _userList.length < 4) {
                                                await fn_janus.editRoom(_data.janus_url, _data.janusRoomId, 144000);
                                            } else if (_userList.length > 3 && _userList.length < 9) {
                                                await fn_janus.editRoom(_data.janus_url, _data.janusRoomId, 64000);
                                            } else {
                                                await fn_janus.editRoom(_data.janus_url, _data.janusRoomId, 36000);
                                            }

                                            joinData.isSfu = true;
                                            signalSocket.emit(sessionId, joinData, data);

                                        } catch (err) {
                                            console.log("JOIN WITH JANUS ERROR", err);

                                        }
                                        syncFn.isScreenSharePossible(redisInfo, data.roomId, data.userId, function (isPossible) {
                                            setTimeout(function () {
                                                console.log('+++++++++ 18 what the .....................? ', isPossible, roomResult.MULTITYPE, roomResult.SERVICE_TYPE);
                                                if (roomResult.MULTITYPE === 'Y' && roomResult.SERVICE_TYPE !== 'Y') {
                                                    if (typeof isPossible === 'boolean' && !isPossible) {
                                                        let screenShareMultiSvr = {
                                                            'eventOp': 'ScreenShareMultiSvr',
                                                            'userId': roomResult.SCREEN.USERID,
                                                            'roomId': data.roomId,
                                                            'reqDate': commonFn.getDate()
                                                        };

                                                        commonFn.reqNo().then(function (reqNo) {
                                                            screenShareMultiSvr.reqNo = reqNo;
                                                            signalSocket.emit(sessionId, screenShareMultiSvr, data);
                                                        });
                                                    }
                                                }

                                                if (isPossible === 'file') {
                                                    syncFn.getFileShare(redisInfo, data.roomId, function (result) {
                                                        logger.log('info', ` '참여자에게 FileShare StartMessage 보냄.', <TO> ${data.roomId} | <파일List> ${result.fileInfoList}`);
                                                        let shareStartData = {
                                                            'eventOp': 'FileShareStartSvr',
                                                            'reqNo': commonFn.getReqNo(data.reqNo),
                                                            'roomId': data.roomId,
                                                            'userId': result.userId,
                                                            'fileInfoList': result.fileInfoList,
                                                            'reqDate': commonFn.getDate()
                                                        };

                                                        signalSocket.emit(sessionId, shareStartData, data);

                                                        logger.log('info', `'참여자에게 파일공유, URL 전송' <TO> ${data.roomId} | <파일URL> ${result.fileUrl}`);
                                                        let shareData = {
                                                            'eventOp': 'FileShareSvr',
                                                            'reqNo': commonFn.getReqNo(data.reqNo),
                                                            'roomId': data.roomId,
                                                            'fileUrl': result.fileUrl,
                                                            'reqDate': commonFn.getDate(),
                                                            'userId': result.userId
                                                        };
                                                        signalSocket.emit(sessionId, shareData, data);
                                                    });
                                                }
                                            }, 2000);
                                        });
                                    } else {
                                        //180129. iamabook. redis에 대기인원 입력처리
                                        //TODO. 180130. iamabook. 방 생성시 입력한 인원수에 맞추는 작업 필요.
                                        let constraintData = {
                                            'signalOp': 'ChangeVideoConstraint',
                                            width: videoWidth,
                                            height: videoHeight
                                        };

                                        if (roomResult.MULTITYPE === 'N') {
                                            constraintData.width = 1920;
                                            constraintData.height = 1080;

                                            let multiJoinData = {
                                                'eventOp': 'MultiViewChange',
                                                'reqNo': data.reqNo,
                                            };
                                            multiJoinData.videoWidth = videoWidth;
                                            multiJoinData.videoHeight = videoHeight;
                                            multiJoinData.videoFramerate = mediaConstraint.video.framerate;
                                            fn_Kurento.addUserToConferenceWaitingLine(masterRedis, slaveRedis, data.roomId, sessionId, signalSocketio, multiJoinData, roomResult.MULTITYPE);
                                        } else {
                                            fn_Kurento.addUserToConferenceWaitingLine(masterRedis, slaveRedis, data.roomId, sessionId, signalSocketio, joinData, roomResult.MULTITYPE);
                                        }

                                        signalSocket.broadcast(socket, data.roomId, constraintData);
                                        logger.log('info', `[Socket : '${data.eventOp} ' Event / 다자간 화상회의 / ChangeVideoConstraint / 성공] *\n* 현재 처리중 방향 : [Signal -> App (broadcast, Pass)] *\n ' + ${data.roomId} + ' *\n* App으로 전달할 Data : ', ${JSON.stringify(constraintData)}`);

                                        if (roomResult.MULTITYPE && roomResult.MULTITYPE === 'N') {
                                            joinData.videoWidth = 1920;
                                            joinData.videoHeight = 1080;
                                            joinData.useMediaSvr = roomResult.MULTITYPE;
                                            signalSocket.emit(sessionId, joinData, data);

                                            logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의 / 성공] *\n* 현재 처리중 방향 : [Signal -> App (Resp)] *\n* 요청자 : ' ${data.userId}' *\n* eventOp : ' ${data.eventOp} ' *\n App으로 전달할 Data : ', ${JSON.stringify(joinData)}`);
                                        }
                                        // coreConnector.emit(sessionId, {
                                        //     eventOp: 'RecordCheck',
                                        //     roomId: data.roomId
                                        // }, result => {
                                        //
                                        // })

                                    }
                                }
                                let roomInfo = await coreConnector.start(
                                    sessionId,
                                    'get',
                                    `rooms/${data.roomId}`,
                                    {}
                                );

                                if (roomInfo.code === '200' && roomInfo.rooms[0].is_recording === 'start') {
                                    signalSocket.emit(sessionId, {
                                        'signalOp': 'Presence',
                                        'action': 'record',
                                        'userId': joinData.admin.id
                                    }, data);
                                }
                            } else {
                                console.log('join reject');
                                await coreConnector.start(
                                    sessionId,
                                    'put',
                                    `users/${data.userId}/status`,
                                    {
                                        status: 'ready'
                                    }
                                );
                                // coreConnector.emit(sessionId, {
                                //     eventOp: 'UserState_ExitRoom',
                                //     userId: data.userId
                                // }, function (_rData) {
                                //     console.log(_rData);
                                console.log(data.userId + ' 의 상태 변경 완료. (busy -> ready)');
                                logger.log('info', `${data.userId}  의 상태 변경 완료. (busy -> ready)`);

                                // TODO: 190518 user name 필요 시 추가
                                // let userName;
                                // commonFn.getUserName(/*coreSocketio,*/ data.userId, function (err, userName) {
                                let _userList = roomResult.USERS;
                                clearPresenceData.userCount = _userList.length - 1;
                                // if (err || !userName) {
                                //     clearPresenceData.userName = exitPresenceData.userId;
                                // } else {
                                //     clearPresenceData.userName = userName
                                // }

                                clearPresenceData.action = 'reject';
                                signalSocket.broadcast(socket, data.roomId, clearPresenceData);
                                // });

                                syncFn.getUserListIncludeGuest(masterRedis, slaveRedis, data.roomId).then(function (userArray) {
                                    let userId = '';
                                    console.log('Join reject op, userArray ---> ', userArray);
                                    if (userArray.some(el => el.indexOf('<#>') > -1)) {
                                        userId = data.userId + '<#>' + sessionId;
                                        isGuest = true;
                                    } else {
                                        userId = data.userId;
                                    }

                                    syncFn.deleteUser(masterRedis, slaveRedis, data.roomId, userId).then(function () {
                                        syncFn.setUsersRoomId(masterRedis, slaveRedis, userId, sessionId);
                                    });
                                })

                                joinData.code = '223';
                                joinData.message = 'reject';
                                signalSocket.emit(sessionId, joinData, data);
                                // });
                            }
                        },

                        function () {
                            console.log("룸아이디가 존재하지 않을 경우.");

                            coreConnector.start(
                                sessionId,
                                'put',
                                `users/${data.userId}/status`,
                                {
                                    status: 'ready'
                                }
                            );

                            // coreConnector.emit(sessionId, {
                            //     eventOp: 'UserState_ExitRoom',
                            //     userId: data.userId
                            // }, function () {
                            console.log(data.userId + ' 의 상태 변경 완료. (busy -> ready)');
                            logger.log('info', `${data.userId} 의 상태 변경 완료. (busy -> ready)`);

                            syncFn.getUserListIncludeGuest(masterRedis, slaveRedis, data.roomId).then(function(userArray) {
                                let userId = '';
                                console.log('Join reject op, userArray ---> ', userArray);
                                if (userArray.some( el => el.indexOf('<#>') > -1 )) {
                                    userId = data.userId + '<#>' + sessionId;
                                    isGuest = true;
                                } else {
                                    userId = data.userId;
                                }

                                syncFn.deleteUser(masterRedis, slaveRedis, data.roomId, userId).then(function() {
                                    syncFn.setUsersRoomId(masterRedis, slaveRedis, userId, sessionId);
                                });
                            });

                            joinData = {
                                'eventOp': 'Join',
                                'reqNo': data.reqNo,
                                'code': '426',
                                'message': 'room is not exist.',
                                'resDate': resDate,
                                'status': 'notExist'
                            };
                            signalSocket.emit(sessionId, joinData, data);
                        });
                        // });

                        break;
                    }
                case 'SDP':
                    {
                        if (data.usage === 'cam') {
                            // console.log('SDP 현재 데이터 : ', data);
                            console.log('SDP ---> cam');
                            syncFn.getRoom(slaveRedis, data.roomId).then(async function (roomResult) {
                                if (roomResult.MULTITYPE && roomResult.MULTITYPE === 'N') {
                                    if (data.sdp) {
                                        if (!data.userId) {
                                            console.log('userId false, --> Guest');
                                            data.userId = 'Guest';
                                        }
    
                                        data.useMediaSvr = 'N';
                                        commonFn.reqNo().then(function (reqResult) {
                                            syncFn.msgManager.save(masterRedis, slaveRedis, data, reqResult, sessionId, pid).then(function () {
                                                data.reqNo = reqResult;
                                                signalSocket.broadcast(socket, data.roomId, data);
                                                logger.log('info', `[Socket : '${data.eventOp} ' Event / 다자간 화상회의] *\n* 현재 처리중 방향 : [Signal -> App (Req)] *\n* eventOp : ' ${data.eventOp} ' *\n 1:1 P2P 상황. ' + ${data.userId}+ '가 보낸 SDP를 상대에게 전달중. \n ReqNo 생성 완료. App으로 전달할 Data : ', ${JSON.stringify(data)}`);
                                            });
                                        }).catch(function () {
                                            console.log('error');
                                        });
                                    } else {
                                        syncFn.msgManager.load(masterRedis, slaveRedis, data, sessionId, pid).then(function (respObj) {
                                            data.reqNo = respObj.reqNo;
                                            data.userId = respObj.userId;
                                            data.message = 'OK';
                                            signalSocket.broadcast(socket, data.roomId, data);
                                            logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의] *\n* 현재 처리중 방향 : [Signal -> App (Resp)] *\n* eventOp : ' ${data.eventOp} ' *\n SDP 요청에 대한 response \n App으로 전달할 Data : ', ${JSON.stringify(data)}`);
                                        });
                                    }
                                } else {
                                    if (data.code === '200') {
                                        return false;
                                    }
    
                                    //janus.
                                    if(data.isSfu === true) {
                                        let sdpData = {
                                            'eventOp': data.eventOp,
                                            'reqNo': data.reqNo,
                                            'code': "200",
                                            'resDate': commonFn.getDate(),
                                            'roomId': data.roomId,
                                            'message': 'OK'
                                        };
                                        signalSocketio.to(sessionId).emit('knowledgetalk', sdpData);
    
                                        try {
                                            let sdp_to_json = sjj.toSessionJSON(data.sdp.sdp, {
                                                creators: ['initiator', 'initiator'],
                                                role: 'initiator',
                                                direction: 'outgoing'
                                            })
    
                                            let ufrag = sdp_to_json.contents[0].transport.ufrag;
                                            let janus_url = await syncFn.getJanusServerByRoomId(redisInfo, data.roomId);
    
                                            if(data.sdp.type === 'offer') {
                                                let socket_data_from_redis = await syncFn.getUserSocketInfo(masterRedis, slaveRedis, sessionId);
                                                let videoRoomPluginId = socket_data_from_redis['JANUS_PUBLISHER_PLUGIN_ID'];
    
                                                await syncFn.setSdpUfragToJanusVideoPluginId(redisInfo, {ufrag: ufrag, videoRoomPluginId: videoRoomPluginId})
                                                let _data = {
                                                    socketio_session_id: sessionId,
                                                    ufrag: ufrag,
                                                    janus_plugin_id: videoRoomPluginId,
                                                    usage: data.usage
                                                }
                                                await syncFn.setJanusPluginInfo(redisInfo, _data);
    
                                                await fn_janus.sendOffer(janus_url, videoRoomPluginId, data.sdp, true);
                                            } else { // SDP ANSWER
                                                let videoRoomPluginId = sessionDataFromRedis['QUEUING_JANUS_PLUGIN_ID'];
                                                data.pluginIdFromRedis = videoRoomPluginId;
                                                logger.log('error', `error checker by iamabook  ${JSON.stringify(data)}`);
    
                                                fn_janus.processSDPOfferQueue(sessionId, sessionDataFromRedis.ROOM_ID);
    
                                                await syncFn.setSdpUfragToJanusVideoPluginId(redisInfo, {ufrag: ufrag, videoRoomPluginId: videoRoomPluginId});
                                                let janusRoomId = await syncFn.getJanusRoomId(redisInfo, data.roomId);
    
                                                let _data = {
                                                    sdp: data.sdp,
                                                    janusRoomId: janusRoomId,
                                                    videoRoomPluginId: videoRoomPluginId
                                                };
                                                // setTimeout(() => {
                                                //     fn_janus.sendAnswerAndStartRemoteVideo(janus_url, _data)
                                                // }, 1500);
                                                await fn_janus.sendAnswerAndStartRemoteVideo(janus_url, _data);
                                            }
    
                                        } catch (err) {
                                            console.log("SDP ERROR OCCURRED.", err);
                                        }
                                        return false;
                                    }
                                    //janus end.
    
                                    console.log('SDP -- Multitype Y ');
                                    data.initialRoomLength = roomResult.initialRoomLength;
    
                                    // fn_Kurento.addClient(signalSocketio, sessionId, data, function (sendData) {
                                    //     if(sendData.media_server_is_dead === true) {
                                    //         //TODO MEDIA_SERVER_IS_DEAD
                                    //     }
    
                                    //     if (data.sdp) {
                                    //         if (!data.userId) {
                                    //             console.log('userId false, --> Guest');
                                    //             data.userId = 'Guest';
                                    //         }
    
                                    //         let sdpData = {
                                    //             'eventOp': data.eventOp,
                                    //             'reqNo': data.reqNo,
                                    //             'code': "200",
                                    //             'resDate': commonFn.getDate(),
                                    //             'roomId': data.roomId,
                                    //             'message' : ''
                                    //         };
    
                                    //         signalSocket.emit(sessionId, sdpData, data);
                                    //         logger.log('info', `[Socket : '${data.eventOp} ' Event / 다자간 화상회의] *\n* 현재 처리중 방향 : [Signal -> App (Resp)] *\n* eventOp : '${data.eventOp} ' *\n SDP 요청에 대한 response \n App으로 전달할 Data : ', ${JSON.stringify(sdpData)}`);
    
                                    //         let _sendData = {
                                    //             'eventOp': "SDP",
                                    //             'usage': 'cam',
                                    //             'reqDate': commonFn.getDate(),
                                    //             'userId': data.userId,
                                    //             'sdp': sendData,
                                    //             'roomId': data.roomId,
                                    //             'useMediaSvr': 'Y'
                                    //         };
    
                                    //         commonFn.reqNo().then(function (reqResult) {
                                    //             _sendData.reqNo = reqResult;
                                    //             signalSocket.emit(sessionId, _sendData, data);
                                    //             logger.log('info', `[Socket : '${data.eventOp}' Event / 다자간 화상회의] *\n* 현재 처리중 방향 : [Signal -> App (Req)] *\n* eventOp : ' ${data.eventOp} ' *\n 다자간 상황. 미디어서버의 Answer를 보냄. \n ReqNo 생성 완료. App으로 전달할 Data : ', ${JSON.stringify(_sendData)}`);
                                    //         }).catch(function () {
                                    //             console.log('error');
                                    //         });
                                    //     }
                                    // });
                                }
                            })
                                .catch((err) => {
                                    // 190314 ivypark, sync function add catch block
                                    signalSocket.emit(sessionId, {
                                        eventOp: data.eventOp,
                                        resDate: commonFn.getDate(),
                                        code: err.code,
                                        message: err.message
                                    }, data);
                                    console.log('Room ID가 잘못 된 경우. 유효하지 않은 room ID인 경우 ', '내용이 없음');
                                    logger.log('warn', 'Room ID가 잘못 된 경우. 유효하지 않은 room ID인 경우,  내용이 없음');
                                });
                        } else if (data.usage === 'screen') {
                            // 181016 ivypark, 1:1 화면 공유 RTP로 동작하도록 변경 처리
                            /*
                                체크 되어야 할 내용
                                1. H/W 가속 -> mex Server 경유 -> host (fn_Kurento.hwShare), user (fn_Kurento.hwShare)
                                -> Candidate 교환 필요.
                                (1:1은 일반적인 P2P SDP 교환 진행하도록 분기)
    
                                2. RTP 공유 -> kurento Server 사용 -> host (fn_Kurento.swShareHost), user (fn_Kurento.swShareUser)
                                -> Candidate 교환 불필요.
                                (1:1도 kurento Server로 relay 진행)
    
                                3. FFMPEG 공유 -> kurento Server 사용 -> host (fn_Kurento.screenShare), user (fn_Kurento.startViewer)
                                -> Candidate 교환 필요.
                                (1:1은 일반적인 P2P SDP 교환 진행하도록 분기)
                            */
    
                            console.log(data);
    
                            let isHWAccelation = data.isHWAccelation || (typeof data.isHWAccelation === 'undefined' && data.type === 'maker');
                            let isRTPShare = data.isRTPShare;
    
                            if (typeof data.isRTPShare === 'undefined' && data.type === 'maker') {
                                isRTPShare = true;
                            }
    
                            const __fn = {
                                sendSdpAnswerForClient: function (answer, userType) {
                                    let sdpAnswerData = {
                                        'eventOp': 'SDP',
                                        'usage': 'screen',
                                        'reqNo': data.reqNo,
                                        'userId': data.userId,
                                        'reqDate': commonFn.getDate(),
                                        'sdp': null, // required
                                        'useMediaSvr': 'Y',
                                        'roomId': data.roomId,
                                        'type': '' // required
                                    };
    
                                    if ((!answer.sdp && !answer.type) || answer.Error || answer.sdp.Error) {
                                        sdpAnswerData.code = '541';
                                    }
    
                                    sdpAnswerData.sdp = answer;
                                    sdpAnswerData.type = userType;
    
                                    signalSocket.emit(sessionId, sdpAnswerData, data);
                                    logger.log('info', `[Media -> Signal -> App] SDP 요청에 대한 Answer \n data : ' ${JSON.stringify(sdpAnswerData)}`);
                                },
    
                                sendMultiSvrForUsers: function (isP2p, roomId) {
                                    setTimeout(function() {
                                        let senderData = {
                                            'eventOp': 'ScreenShareMultiSvr',
                                            'userId': data.userId,
                                            'roomId': data.roomId,
                                            'reqDate': commonFn.getDate(),
                                            'type': ''
                                        };
    
                                        commonFn.reqNo().then(function (reqResult) {
                                            senderData.reqNo = reqResult;
                                            syncFn.getUserSocketInfo(masterRedis, slaveRedis, sessionId).then(function(obj) {
                                                let localShareRoomId;
                                                if (obj && obj.LOCAL_SHARE_ROOM ) localShareRoomId = obj.LOCAL_SHARE_ROOM;
                                                if ( data.roomId === localShareRoomId ) {
                                                    console.log('화상회의 중에 로컬 화면 공유를 한 경우.');
                                                    syncFn.getLocalShareRoom(redisInfo, data.roomId, function(result) {
                                                        if (!result) {
                                                            // 190314 ivypark, sync function add catch block
                                                            signalSocket.emit(sessionId, {
                                                                eventOp: data.eventOp,
                                                                resDate: commonFn.getDate(),
                                                                code: '571',
                                                                message: 'Internal Server Error'
                                                            }, data);
                                                            console.log('Local Share Room 정보가 없음. ');
                                                            logger.log('warn', 'Local Share Room 정보가 없음. ');
                                                            return false;
                                                        }
                                                        let makerSessionId = result.MAKER;
                                                        let _arr = Object.keys(result.USER);
    
                                                        for (let sid of _arr) {
                                                            if (sid !== makerSessionId) {
                                                                syncFn.getRoomId3(masterRedis, slaveRedis, sid).then(function (rid) {
                                                                    syncFn.setShareSettings(masterRedis, slaveRedis, (rid || data.roomId), isHWAccelation, isRTPShare);
                                                                    console.log('complete Share Setting');
                                                                    senderData.roomId = (rid || data.roomId);
                                                                    senderData.type = 'local';
    
                                                                    socket.broadcast.to((rid || data.roomId)).emit('knowledgetalk', senderData);
                                                                    logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의 / ' ${data.eventOp} '] *\n* 현재 처리중 방향 : [Signal -> App (broadcast)] *\n* 전달요청자 : ' + ${data.userId} + ' \n ReqNo 생성 완료. App으로 전달 데이터 : ', ${JSON.stringify(senderData)}`);
                                                                })
                                                                    .catch(() => {
                                                                        // 190314 ivypark, sync function add catch block
                                                                        // signalSocket.emit(sessionId, {
                                                                        //     eventOp: data.eventOp,
                                                                        //     resDate: commonFn.getDate(),
                                                                        //     code: err.code,
                                                                        //     message: err.message
                                                                        // });
                                                                        console.log('Room Id를 찾을 수 없음 ');
                                                                        logger.log('warn', 'Room Id를 찾을 수 없음 sync에 user 정보가 등록되어 있지 않을 때, SDP 200은 클라이언트에게 나간 상태' );
                                                                    });
                                                            }
                                                        }
                                                    });
                                                } else {
                                                    console.log('화상회의 중에 일반 화면 공유를 한 경우.');
                                                    syncFn.setShareSettings(masterRedis, slaveRedis, data.roomId, isHWAccelation, isRTPShare);
                                                    senderData.type = 'common';
                                                    signalSocket.broadcast(socket, data.roomId, senderData);
                                                }
                                            });
    
                                        }).catch(function () {
                                            console.log('error');
                                        });
                                    }, 2000);
                                },
    
                                getLocalScreenShareRoom: function (roomId, callback) {
                                    syncFn.getRoom(slaveRedis, roomId).then(function(roomObj) {
                                        let localRoom = '';
                                        let userArr = roomObj.USERS.length !== 0 ? roomObj.USERS : roomObj.USER;
                                        if (roomObj.USERS.length === 0) {
                                            userArr = Object.keys(userArr);
                                            for (let __sid of userArr) {
                                                syncFn.getUserSocketInfo(masterRedis, slaveRedis, __sid)
                                                    .then(function(socketInfo) {
                                                        try {
                                                            console.log(socketInfo);
                                                            if (socketInfo.LOCAL_SHARE_ROOM) {
                                                                localRoom = socketInfo.LOCAL_SHARE_ROOM;
                                                            }
                                                        } catch (e) {
                                                            logger.log('warn', 'there is no data in redis');
                                                        }
    
                                                        if (userArr.indexOf(__sid) + 1 === userArr.length) {
                                                            if (!localRoom) {
                                                                console.log('LocalScreenShare 중이 아님. LocalScreenShare 중이라면 문제 있음.');
                                                            }
    
                                                            callback(localRoom);
                                                        }
                                                    })
                                            }
                                        } else {
                                            for (let __uid of userArr) {
                                                // 로컬 회의 수락한 녀석을 찾아보자.
                                                syncFn.getUserSocketId(masterRedis, slaveRedis, __uid).then(function(sid) {
                                                    return syncFn.getUserSocketInfo(masterRedis, slaveRedis, sid);
                                                }).catch(e => {
                                                    console.log('######## ', e);
                                                }).then(function(socketInfo) {
                                                    try {
                                                        console.log(socketInfo);
                                                        if (socketInfo.LOCAL_SHARE_ROOM) {
                                                            localRoom = socketInfo.LOCAL_SHARE_ROOM;
                                                        }
                                                    } catch (e) {
                                                        logger.log('warn', 'there is no data in redis');
                                                    }
    
                                                    if (userArr.indexOf(__uid) + 1 === userArr.length) {
                                                        if (!localRoom) {
                                                            console.log('LocalScreenShare 중이 아님. LocalScreenShare 중이라면 문제 있음.');
                                                        }
    
                                                        callback(localRoom);
                                                    }
                                                });
                                            }
                                        }
                                    });
                                }
                            };
    
                            // TODO : data.useMediaSvr 값이 없을 경우
                            let isMexServer = commonFn.getMediaServerSelector();
                            syncFn.getRoom(slaveRedis, data.roomId).then(async function (roomResult) {
    
                                let multiType = data.useMediaSvr ? data.useMediaSvr : roomResult.MULTITYPE;
                                if (data.code === '200' && multiType === 'Y') {
                                    return false;
                                }
    
                                if (typeof data.isHWAccelation === 'undefined' && data.type === 'user') {
                                    isHWAccelation = roomResult.isHWAcceleration;
                                }
    
                                if (multiType && multiType === 'N') {
    
                                    if (data.sdp) {
    
                                        if (data.sdp.type === 'answer') {
                                            isRTPShare = typeof roomResult.isRTPShare !== 'undefined' ? roomResult.isRTPShare : true;
                                        }
    
                                        if (!data.userId) {
                                            console.log('userId false, --> Guest');
                                            data.userId = 'Guest';
                                        }
    
                                        let isHost = (data.sdp.type === 'offer');
    
                                        if (isRTPShare) {
                                            switch (true) {
                                                // SW 공유, RTP, 공유자
                                                case isRTPShare && isHost:
                                                    console.log('SW 공유, RTP, 공유자', isHWAccelation, isRTPShare, isHost);
                                                    fn_Kurento.swShareHost(signalSocketio, sessionId, data, function (sendData) {
                                                        console.log(data.roomId);
                                                        syncFn.setShareSettings(masterRedis, slaveRedis, data.roomId, isHWAccelation, isRTPShare);
                                                        __fn.sendSdpAnswerForClient(sendData, 'maker');
                                                        __fn.sendMultiSvrForUsers();
                                                    });
                                                    break;
    
                                                // SW 공유, RTP, 공유 받는 User
                                                case isRTPShare && !isHost:
                                                    console.log('SW 공유, RTP, 공유 받는 User', isHWAccelation, isRTPShare, isHost);
                                                    __fn.getLocalScreenShareRoom(data.roomId, function(localRoom) {
                                                        fn_Kurento.swShareUser(signalSocketio, sessionId, data, localRoom, function (sendData) {
                                                            __fn.sendSdpAnswerForClient(sendData, 'user');
                                                        });
                                                    });
                                                    break;
                                            }
                                        } else {
                                            data.useMediaSvr = 'N';
                                            commonFn.reqNo().then(function (reqResult) {
                                                syncFn.msgManager.save(masterRedis, slaveRedis, data, reqResult, sessionId, pid).then(function () {
                                                    data.reqNo = reqResult;
                                                    logger.log('info', `roomResult ${JSON.stringify(roomResult)}`);
                                                    syncFn.setShareSettings(masterRedis, slaveRedis, data.roomId, isHWAccelation, isRTPShare);
                                                    if (!roomResult) {
                                                        syncFn.getUserSocketId(masterRedis, slaveRedis, data.userId).then(function (sid) {
                                                            signalSocket.emit(sid, data);
                                                        });
                                                    } else {
                                                        signalSocket.broadcast(socket, data.roomId, data);
                                                    }
                                                    logger.log('info', `[Socket : ' ${data.eventOp}' Event / 다자간 화상회의] *\n* 현재 처리중 방향 : [Signal -> App (Req)] *\n* eventOp : '${data.eventOp} ' *\n 1:1 P2P 상황. ' ${data.userId} '가 보낸 SDP를 상대에게 전달중. \n ReqNo 생성 완료. App으로 전달할 Data : ', ${JSON.stringify(data)}`);
                                                });
                                            }).catch(function () {
                                                console.log('error');
                                            });
                                        }
                                    } else {
                                        syncFn.msgManager.load(masterRedis, slaveRedis, data, sessionId, pid).then(function (respObj) {
                                            data.reqNo = respObj.reqNo;
                                            signalSocket.emit(sessionId, data);
                                            logger.log('info', `[Socket : '  ${data.eventOp} ' Event / 다자간 화상회의] *\n* 현재 처리중 방향 : [Signal -> App (Resp)] *\n* eventOp : ' ${data.eventOp} ' *\n SDP 요청에 대한 response \n App으로 전달할 Data : ', ${JSON.stringify(data)}`);
                                        });
                                    }
                                } else {
    
                                    // 180802 ivypark, 1627 다자간 화면공유 SDP
    
                                    if (data.code) {
                                        return false;
                                    }
    
                                    if (data.type === 'user') {
                                        isRTPShare = typeof roomResult.isRTPShare !== 'undefined' ? roomResult.isRTPShare : true;
                                    }
    
                                    if (!data.userId) {
                                        data.userId = 'Guest';
                                    }
    
                                    let sdpOkResp = {
                                        'eventOp': data.eventOp,
                                        'reqNo': data.reqNo,
                                        'code': "200",
                                        'message': 'OK',
                                        'resDate': commonFn.getDate(),
                                        'roomId': data.roomId,
                                        'usage': 'screen'
                                    };
    
                                    signalSocket.emit(sessionId, sdpOkResp, data);
                                    logger.log('info', `[Signal -> App (Resp)] SDP 요청에 대한 200 OK \n data : ' ${JSON.stringify(sdpOkResp)}`);
    
                                    let isHost = (data.type === 'maker');
                                    console.log('========================== > isHWAccelation :: ', isHWAccelation, isRTPShare, isHost);
    
                                    //janus.
                                    if(commonFn.isSfu() === true) {
                                        try {
                                            if(data.sdp.type === 'offer') {
                                                let janus_url = await syncFn.getJanusServerByRoomId(redisInfo, sessionDataFromRedis.ROOM_ID);
                                                let janusRoomId = await syncFn.getJanusRoomId(redisInfo, sessionDataFromRedis.ROOM_ID);
    
                                                let _data = {
                                                    janus_url: janus_url,
                                                    janusRoomId: janusRoomId,
                                                    sdp: data.sdp,
                                                    userId: sessionDataFromRedis.ID
                                                };
    
                                                let res = await fn_janus.processJoinVideoRoomForScreenShare(sessionId, _data);
                                            } else {
                                                let sdp_to_json = sjj.toSessionJSON(data.sdp.sdp, {
                                                    creators: ['initiator', 'initiator'],
                                                    role: 'initiator',
                                                    direction: 'outgoing'
                                                })
    
                                                let ufrag = sdp_to_json.contents[0].transport.ufrag;
                                                let janus_url = await syncFn.getJanusServerByRoomId(redisInfo, data.roomId);
    
                                                let videoRoomPluginId = sessionDataFromRedis['QUEUING_JANUS_PLUGIN_ID'];
    
                                                fn_janus.processSDPOfferQueue(sessionId, sessionDataFromRedis.ROOM_ID);
    
                                                await syncFn.setSdpUfragToJanusVideoPluginId(redisInfo, {ufrag: ufrag, videoRoomPluginId: videoRoomPluginId});
                                                let janusRoomId = await syncFn.getJanusRoomId(redisInfo, data.roomId);
    
                                                let _data = {
                                                    sdp: data.sdp,
                                                    janusRoomId: janusRoomId,
                                                    videoRoomPluginId: videoRoomPluginId
                                                }
    
                                                await fn_janus.sendAnswerAndStartRemoteVideo(janus_url, _data);
    
                                            }
                                        } catch (e) {
                                            logger.log('error', `sfu screenshare ERROR..${e}`);
                                        }
                                        return false;
                                    }
                                    //janus end.
    
    
                                    switch (true) {
                                        // HW 가속, mex Server, 공유자
                                        case isHWAccelation && isMexServer && isHost:
                                            console.log('HW 가속, mex Server, 공유자', isHWAccelation, isRTPShare, isHost);
                                            syncFn.setShareSettings(masterRedis, slaveRedis, data.roomId, isHWAccelation);
                                            fn_Kurento.hwShare(signalSocketio, sessionId, data, '', function (sendData) {
                                                __fn.sendSdpAnswerForClient(sendData, 'maker');
                                                __fn.sendMultiSvrForUsers();
                                            });
                                            break;
    
                                        // HW 가속, mex Server, 공유 받는 User
                                        case isHWAccelation && isMexServer && !isHost:
                                            console.log('HW 가속, mex Server, 공유 받는 User', isHWAccelation, isRTPShare, isHost);
                                            __fn.getLocalScreenShareRoom(data.roomId, function(localRoom) {
                                                fn_Kurento.hwShare(signalSocketio, sessionId, data, localRoom, function (sendData) {
                                                    __fn.sendSdpAnswerForClient(sendData, 'user');
                                                });
                                            });
                                            break;
    
                                        // SW 공유, FFMPEG or Screen Capture, 공유자
                                        case !isHWAccelation && !isRTPShare && isHost:
                                            console.log('SW 공유, FFMPEG or Screen Capture, 공유자', isHWAccelation, isRTPShare, isHost);
                                            syncFn.setShareSettings(masterRedis, slaveRedis, data.roomId, isHWAccelation);
                                            fn_Kurento.screenShare(signalSocketio, sessionId, data, function (sendData) {
                                                __fn.sendSdpAnswerForClient(sendData, 'maker');
                                                __fn.sendMultiSvrForUsers();
                                            });
                                            break;
    
                                        // SW 공유, FFMPEG or Screen Capture, 공유 받는 User
                                        case !isHWAccelation && !isRTPShare && !isHost:
                                            console.log('SW 공유, FFMPEG or Screen Capture, 공유 받는 User', isHWAccelation, isRTPShare, isHost);
                                            __fn.getLocalScreenShareRoom(data.roomId, function(localRoom) {
                                                fn_Kurento.startViewer(signalSocketio, sessionId, data, localRoom, function (sendData) {
                                                    __fn.sendSdpAnswerForClient(sendData, 'user');
                                                });
                                            });
                                            break;
    
                                        // SW 공유, RTP, 공유자
                                        case !isHWAccelation && isRTPShare && isHost:
                                            // TODO: 180802 rtp session 적용
                                            console.log('SW 공유, RTP, 공유자', isHWAccelation, isRTPShare, isHost);
                                            syncFn.setShareSettings(masterRedis, slaveRedis, data.roomId, isHWAccelation);
                                            fn_Kurento.swShareHost(signalSocketio, sessionId, data, function (sendData) {
                                                __fn.sendSdpAnswerForClient(sendData, 'maker');
                                                __fn.sendMultiSvrForUsers();
                                            });
                                            break;
    
                                        // SW 공유, RTP, 공유 받는 User
                                        case !isHWAccelation && isRTPShare && !isHost:
                                            // TODO: 180802 rtp session 적용
                                            console.log('SW 공유, RTP, 공유 받는 User', isHWAccelation, isRTPShare, isHost);
                                            __fn.getLocalScreenShareRoom(data.roomId, function(localRoom) {
                                                console.log(localRoom);
                                                fn_Kurento.swShareUser(signalSocketio, sessionId, data, localRoom, function (sendData) {
                                                    __fn.sendSdpAnswerForClient(sendData, 'user');
                                                });
                                            });
                                            break;
    
                                    }
                                }
                            })
                                .catch((err) => {
                                    // 190314 ivypark, sync function add catch block
                                    signalSocket.emit(sessionId, {
                                        eventOp: data.eventOp,
                                        resDate: commonFn.getDate(),
                                        code: err.code,
                                        message: err.message
                                    }, data);
                                    console.log('Room ID가 잘못 된 경우. 유효하지 않은 room ID인 경우 ', '내용이 없음');
                                    logger.log('warn', 'Room ID가 잘못 된 경우. 유효하지 않은 room ID인 경우 내용이 없음');
                                });
                        }
    
                        break;
                    }
                case 'Candidate':
                    {
                        setTimeout(function() {
                            if (data.usage === 'cam') {
                                syncFn.getRoom(slaveRedis, data.roomId).then(async function (roomResult) {
                                    if (data.code === '200' && roomResult.MULTITYPE === 'Y') {
                                        return false;
                                    }
    
                                    if (roomResult.MULTITYPE && roomResult.MULTITYPE === 'N') {
                                        if (data.candidate) {
                                            if (!data.userId) {
                                                data.userId = 'Guest';
                                            }
                                            data.useMediaSvr = "N";
                                            commonFn.reqNo().then(function (reqResult) {
                                                syncFn.msgManager.save(masterRedis, slaveRedis, data, reqResult, sessionId, pid).then(function () {
                                                    data.reqNo = reqResult;
                                                    signalSocket.broadcast(socket, data.roomId, data);
                                                    logger.log('info', `[Socket : '${data.eventOp} ' Event / 다자간 화상회의] *\n* 현재 처리중 방향 : [Signal -> App (Req)] *\n* Candidate 전달요청자 : ' ${data.userId} ' *\n* eventOp : ' ${data.eventOp} ' *\n 1:1 P2P 상황. ' ${data.userId} '가 보낸 Candidate를 상대에게 전달중. \n ReqNo 생성 완료. App으로 전달할 Data : ', ${JSON.stringify(data)}`);
                                                });
                                            }).catch(function () {
                                                console.log('error');
                                            });
                                        } else {
                                            console.log('# candidate 200 answer ---> ', data.reqNo);
                                            logger.log('info', `# candidate 200 answer ---> ${data.reqNo}`);
                                            syncFn.msgManager.load(masterRedis, slaveRedis, data, sessionId, pid).then(function (respObj) {
                                                data.reqNo = respObj.reqNo;
                                                data.userId = respObj.userId;
                                                signalSocket.broadcast(sessionId, data);
                                                logger.log('info', `[Socket : '${data.eventOp}' Event / 다자간 화상회의] *\n* 현재 처리중 방향 : [Signal -> App (Req)] *\n* Candidate 전달요청자 : '${data.userId} ' *\n* eventOp : ' ${data.eventOp} ' *\n Candidate 200 Response, App으로 전달할 Data : ', ${JSON.stringify(data)}`);
                                            });
                                        }
                                    } else {
                                        if (data.candidate) {
                                            let cadidateData = {
                                                'eventOp': 'Candidate',
                                                'reqNo': data.reqNo,
                                                'code': "200",
                                                'message': 'OK',
                                                'usage': 'cam',
                                                'useMediaSvr': 'Y',
                                                'resDate': commonFn.getDate(),
                                                'roomId': data.roomId
                                            };
    
                                            signalSocket.emit(sessionId, cadidateData, data);
                                            logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의] *\n* 현재 처리중 방향 : [Signal -> App (Req)] *\n* Candidate 전달요청자 :  '${data.userId} ' *\n* eventOp : ' ${data.eventOp} ' *\n Candidate 요청이 오면 여기서 바로 response가 나감. (socket.event 1671) \n App으로 전달할 Data : ', ${JSON.stringify(cadidateData)}`);
    
                                            //janus.
                                            if(data.isSfu === true) {
                                                try {
                                                    setTimeout(async () => {
                                                        let ufragIdx = data.candidate.candidate.indexOf("ufrag");
                                                        let ufrag = data.candidate.candidate.substr(ufragIdx + 6, 4);
                                                        let videoRoomPluginId = await syncFn.getJanusPluginIdFromUfrag(redisInfo, ufrag);
                                                        if(videoRoomPluginId) {
                                                            let janus_url = await syncFn.getJanusServerByRoomId(redisInfo, data.roomId);
                                                            fn_janus.onIceCandidate(janus_url, videoRoomPluginId, data.candidate);
                                                        } else {
                                                            // webrtcup 으로 candidate가 맺어지면 더이상 보낼 필요가 없기 떄문에 redis에서 제거해도 무방하다.
                                                            console.log('ufrag does not exists.');
                                                        }
                                                        return false;
                                                    }, 1500);
                                                } catch (err) {
                                                    console.log('PROCESS ICECANDIDATE ERROR.', err);
                                                    return false;
                                                }
                                            } else {
                                                fn_Kurento.onIceCandidate(sessionId, data.candidate);
                                            }
                                            //janus end.
                                        }
                                    }
                                })
                                    .catch((err) => {
                                        // 190314 ivypark, sync function add catch block
                                        signalSocket.emit(sessionId, {
                                            eventOp: data.eventOp,
                                            resDate: commonFn.getDate(),
                                            code: err.code,
                                            message: err.message
                                        }, data);
                                        console.log('Room ID가 잘못 된 경우. 유효하지 않은 room ID인 경우 ', '내용이 없음');
                                        logger.log('warn', 'Room ID가 잘못 된 경우. 유효하지 않은 room ID인 경우 내용이 없음');
                                    });
                            } else if (data.usage === 'screen') {
                                let isMexServer = commonFn.getMediaServerSelector();
                                syncFn.getRoom(slaveRedis, data.roomId).then(async function (roomResult) {
                                    let isHWAccelation = data.isHWAccelation || (typeof data.isHWAccelation === 'undefined' && data.type === 'maker');
                                    if (typeof data.isHWAccelation === 'undefined' && data.type === 'user') {
                                        isHWAccelation = roomResult.isHWAcceleration;
                                    }
    
                                    console.log('isHWAccelation :: ', data.isHWAccelation, isMexServer);
    
                                    let multiType = data.useMediaSvr ? data.useMediaSvr : roomResult.MULTITYPE;
                                    if (data.code === '200' && multiType === 'Y') {
                                        return false;
                                    }
    
                                    if (multiType && multiType === 'N') {
                                        if (data.candidate) {
                                            if (!data.userId) {
                                                data.userId = 'Guest';
                                            }
    
                                            //1:1 SDP 교환
                                            data.useMediaSvr = 'N';
                                            commonFn.reqNo().then(function (reqResult) {
                                                syncFn.msgManager.save(masterRedis, slaveRedis, data, reqResult, sessionId, pid).then(function () {
                                                    data.reqNo = reqResult;
                                                    if (!roomResult) {
                                                        syncFn.getUserSocketId(masterRedis, slaveRedis, data.userId).then(function (sid) {
                                                            signalSocket.emit(sid, data);
                                                        });
                                                    } else {
                                                        signalSocket.broadcast(socket, data.roomId, data);
                                                    }
                                                    logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의] *\n* 현재 처리중 방향 : [Signal -> App (Req)] *\n* eventOp : ' ${data.eventOp} ' *\n 1:1 P2P 상황. ' ${data.userId} '가 보낸 SDP를 상대에게 전달중. \n ReqNo 생성 완료. App으로 전달할 Data : ', ${JSON.stringify(data)}`);
                                                });
                                            }).catch(function () {
                                                console.log('error');
                                            });
                                        } else {
                                            syncFn.msgManager.load(masterRedis, slaveRedis, data, sessionId, pid)
                                                .then(function (respObj) {
                                                    console.log('not 527 !!');
                                                    data.reqNo = respObj.reqNo;
                                                    signalSocket.emit(sessionId, data);
                                                    logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의] *\n* 현재 처리중 방향 : [Signal -> App (Resp)] *\n* eventOp : ' ${data.eventOp} ' *\n SDP 요청에 대한 response \n App으로 전달할 Data : ', ${JSON.stringify(data)}`);
                                                });
                                        }
                                    } else {
                                        if (data.candidate) {
                                            let cadidateData = {
                                                'eventOp': 'Candidate',
                                                'usage': 'screen',
                                                'reqNo': data.reqNo,
                                                'code': "200",
                                                'message': 'OK',
                                                'resDate': commonFn.getDate(),
                                                'roomId': data.roomId
                                            };
    
                                            signalSocket.emit(sessionId, cadidateData, data);
    
                                            //janus.
                                            if(data.isSfu === true) {
                                                try {
                                                    // let ufrag = data.candidate.usernameFragment;
                                                    let ufragIdx = data.candidate.candidate.indexOf("ufrag");
                                                    let ufrag = data.candidate.candidate.substr(ufragIdx + 6, 4);
                                                    let videoRoomPluginId = await syncFn.getJanusPluginIdFromUfrag(redisInfo, ufrag);
    
                                                    let janus_url = await syncFn.getJanusServerByRoomId(redisInfo, data.roomId);
                                                    fn_janus.onIceCandidate(janus_url, videoRoomPluginId, data.candidate);
                                                    // setTimeout(async () => {
                                                    //     let ufrag = data.candidate.usernameFragment;
                                                    //     let videoRoomPluginId = await syncFn.getJanusPluginIdFromUfrag(redisInfo, ufrag);
                                                    //
                                                    //     let janus_url = await syncFn.getJanusServerByRoomId(redisInfo, data.roomId);
                                                    //     fn_janus.onIceCandidate(janus_url, videoRoomPluginId, data.candidate);
                                                    // }, 1500);
                                                    return false;
                                                } catch (err) {
                                                    console.log('PROCESS ICECANDIDATE ERROR.', err);
                                                    return false;
                                                }
                                            }
                                            //janus end.
    
                                            if (isHWAccelation && isMexServer) {
                                                fn_Kurento.hwShareCandidate(sessionId, data.candidate);
                                            } else {
                                                fn_Kurento.screenOnIceCandidate(sessionId, data.candidate);
                                            }
                                        }
                                    }
                                })
                                    .catch((err) => {
                                        // 190314 ivypark, sync function add catch block
                                        signalSocket.emit(sessionId, {
                                            eventOp: data.eventOp,
                                            resDate: commonFn.getDate(),
                                            code: err.code,
                                            message: err.message
                                        }, data);
                                        console.log('Room ID가 잘못 된 경우. 유효하지 않은 room ID인 경우 ', '내용이 없음');
                                        logger.log('warn', 'Room ID가 잘못 된 경우. 유효하지 않은 room ID인 경우 , 내용이 없음');
                                    });
                            }
                        }, 200);
    
                        break;
                    }
                case 'ExitRoom':
                    {
                        let usersArray;
    
                        let exitDate = commonFn.getDate();
                        let exitData = {
                            'eventOp': 'ExitRoom',
                            'reqNo': data.reqNo,
                            'code': '200',
                            'message': 'OK',
                            'resDate': exitDate
                        };
    
                        let exitPresenceData = {
                            'signalOp': 'Presence',
                            'userId': data.userId,
                            'userName': data.userName || '',
                            'action': 'exit'
                        };
    
                        if (!data.roomId) {
                            exitData.code = '481';
                            exitData.message = 'Message Error. not enough \'roomId\' field or values.';
                        }
                        //회의후방이사라지면true
                        let isConferenceEnded = false; // 방에 아무도 없거나, 방장이 종료하여 회의 종료 되었는지 여부
                        //exitRoom을 요청을 보낸 사람이 게스트인 경우의 변수
                        let isGuest = false;
                        //방이 살았는지 죽었는지 확인하는 변수
                        let isDeleteUser = false;
                        fn_Kurento.deleteUserFromConferenceWaitingLine(masterRedis, slaveRedis, data.roomId, sessionId);
                        syncFn.getUserListIncludeGuest(masterRedis, slaveRedis, data.roomId)
                            .then(
                                function (userArray) {
                                    console.log("userArray : ", userArray);
    
                                    logger.log('info', `EXIT ROOM Multi, userArray : ${userArray}` );
    
                                    usersArray = userArray;
    
                                    syncFn.getRoomAdmin(slaveRedis, data.roomId).then(async function(admin) {
                                        // 180625 ivypark, 방장이 나가면 방에 있던 모든 사람들의 정보를 모두 지움.
                                        if (userArray.length <= 1 || data.userId === admin.id || userArray === 'notExist') {
                                            isConferenceEnded = true;
    
                                            console.log('----- DELETE ROOM -----');
                                            // 190122 ivypark, 조현명 주임 요청으로 방이 사라지면 end date 업데이트 하도록 수정
                                            await coreConnector.start(
                                                sessionId,
                                                'put',
                                                `rooms/${data.roomId}/exit`,
                                                {}
                                            );
                                            // coreConnector.emit(sessionId, {'eventOp': 'UpdateConferenceHistory', 'roomId': data.roomId, 'status' : 'end'}, data => {
                                            //     logger.log('info', `UpdateConferenceHistory callback ${JSON.stringify(data)}` );
                                            // });
                                            return syncFn.deleteRoom(masterRedis, slaveRedis, data.roomId);
                                        } else {
                                            isDeleteUser = true;
                                            logger.log('info', `[Socket : '  ${data.eventOp} ' Event / 다자간 화상회의] *\n* room에 2명 이상이 있었음. : ', ${userArray}`);
                                            console.log('+++++ DELETE USER +++++');
                                            let userId = '';
                                            console.log('ExitRoom op, userArray ---> ', userArray);
                                            if (userArray.some( el => el.indexOf('<#>') > -1 )) {
                                                userId = data.userId + '<#>' + sessionId;
                                                isGuest = true;
                                            } else {
                                                userId = data.userId;
                                            }
                                            return syncFn.deleteUser(masterRedis, slaveRedis, data.roomId, userId);
                                        }
                                    });
                                },
    
                                function (error) {
                                    console.log("방이 없는데 ExitRoom을 날림. 방장이 나간 경우 이렇게 될 수도 있음. : ", error);
                                    logger.log('warn', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의 / Redis] *\n* 방이 없는데 ExitRoom을 날림. 방장이 나간 경우 이렇게 될 수도 있음. `);
                                }
                            ).then(async function (msg) {
                                console.log('msg why undefined.....?', msg);
                                logger.log('info', `exitRoom, usersArray :: ${usersArray}`);
    
                                let exitDate = commonFn.getDate();
                                let exitData = {
                                    'eventOp': 'ExitRoom',
                                    'reqNo': data.reqNo,
                                    'code': '200',
                                    'message': 'OK',
                                    'resDate': exitDate
                                };
                                let exitPresenceData = {
                                    'signalOp': 'Presence',
                                    'userId': data.userId,
                                    'userName': data.userName || '',
                                    'action': 'exit'
                                };
    
                                // let exitStateData = {
                                //     'eventOp': 'UserState_ExitRoom',
                                //     'userId': data.userId
                                // };
    
                                let multiType;
    
                                function getRoomId(cb) {
                                    syncFn.getRoom(slaveRedis, data.roomId).then(function(roomObj) {
                                        multiType = roomObj.MULTITYPE;
                                        let realRoomId = '';
                                        let userArr = roomObj.USERS;
                                        for (let idx in userArr) {
                                            // 로컬 회의 수락한 녀석을 찾아보자.
                                            syncFn.getUserSocketId(masterRedis, slaveRedis, userArr[idx]).then(function(sid) {
                                                return syncFn.getUserSocketInfo(masterRedis, slaveRedis, sid);
                                            }).then(function(socketInfo) {
                                                if (socketInfo.LOCAL_SHARE_ROOM) {
                                                    realRoomId = socketInfo.LOCAL_SHARE_ROOM;
                                                    cb(realRoomId);
                                                }
    
                                                if (idx >= userArr.length && !realRoomId) {
                                                    cb(data.roomId);
                                                }
                                            });
                                        }
                                        if(data.userId === roomObj.SCREEN.USERID){
                                            syncFn.resetScreenShareFlag(redisInfo, data.userId, data.roomId, function (err){   
                                                logger.log('info', `SessionReserve 관련 resetScreenShareFlag Error :  ${err} `);
                                            });  
                                            if('file' === roomObj.SCREEN.FLAG){
                                                let fileDate = {
                                                    'eventOp': 'FileShareEndSvr',
                                                    'reqNo': commonFn.getReqNo(data.reqNo),
                                                    'userId': data.userId,
                                                    'reqDate': data.reqDate,
                                                    'roomId': data.roomId
                                                }                      
                                                signalSocket.broadcast(socket, data.roomId, fileDate);
                                            }else if('true' === roomObj.SCREEN.FLAG){
                                                    let screenData = {
                                                        'eventOp': 'ScreenShareConferenceEndSvr',
                                                        'reqNo': data.reqNo,
                                                        'roomId': data.roomId,
                                                        'resDate': commonFn.getDate(),
                                                        'code': '200',
                                                        'message': 'OK'
                                                    }
                                                    signalSocket.broadcast(socket, data.roomId, screenData);
                                                }                                           
                                            }                                            
                                        })               
                                        .catch(() => {
                                            // 190314 ivypark, sync function add catch block
                                            // signalSocket.emit(sessionId, {
                                            //     eventOp: data.eventOp,
                                            //     resDate: commonFn.getDate(),
                                            //     code: err.code,
                                            //     message: err.message
                                            // });
                                            console.log('Room ID가 잘못 된 경우. 유효하지 않은 room ID인 경우 ', '내용이 없음');
                                            logger.log('warn', 'Room ID가 잘못 된 경우. 유효하지 않은 room ID인 경우 , 내용이 없음');
                                        });
                                }
    
                                getRoomId(function(roomId) {
                                    fn_Kurento.hwShareRemoveSession(roomId, sessionId);
                                });
                                fn_Kurento.stop(sessionId, data.roomId, masterRedis, slaveRedis);
                                socket.leave(data.roomId);
    
                                if (isGuest) {
                                    syncFn.initGuestUserInfo(masterRedis, slaveRedis, data.userId, sessionId).then(async function() {
                                        if (isDeleteUser) {
                                            signalSocket.emit(sessionId, exitData, data);
    
                                            // 180727 ivypark, userCount 추가.
                                            exitPresenceData.userCount = usersArray.length - 1;
                                            signalSocket.broadcast(socket, data.roomId, exitPresenceData);
                                            logger.log('info', `${JSON.stringify(exitData)}, ${JSON.stringify(exitPresenceData) }`);
                                        } else {
                                            if (isConferenceEnded) {
                                                // TODO : 180702 ivypark, guest id 처리 방법 고민...
                                                // syncFn.getUserSocketId(masterRedis, slaveRedis, usersArray[i]).then()
                                                // 190312. legacy.
                                                // fn_Kurento.stop(sessionId, data.roomId, masterRedis, slaveRedis);
                                                // fn_Kurento.screenShareStop(sid, data.roomId, masterRedis, slaveRedis);
    
                                                exitPresenceData.action = 'end';
                                                await coreConnector.start(
                                                    sessionId,
                                                    'put',
                                                    `rooms/${data.roomId}/exit`,
                                                    {}
                                                );
                                                // coreConnector.emit(sessionId, {'eventOp': 'UpdateConferenceHistory', 'roomId': data.roomId, 'status' : 'end'}, data => {
                                                //     logger.log('info', `UpdateConferenceHistory callback ${JSON.stringify(data)}`);
                                                // });
                                                // syncFn.getUserListIncludeGuest(masterRedis, slaveRedis, data.roomId).then(function(userList) {
                                                //     for (let i = 0; i < userList; i++) {
                                                //
                                                //     }
                                                // })
                                                //
                                                commonFn.transaction(exitData, data, sessionId);
                                                signalSocket.broadcast(socket, data.roomId, exitPresenceData);
                                            }
    
                                            if (usersArray.length >= 1) {
                                                usersArray.forEach(async (elem) => {
                                                    await coreConnector.start(
                                                        sessionId,
                                                        'put',
                                                        `users/${elem}/status`,
                                                        {}
                                                    );
                                                });
    
                                                if (usersArray !== 'notExist') {
                                                    for (let person in usersArray) {
                                                        syncFn.getUserSocketId(masterRedis, slaveRedis, usersArray[person])
                                                            .then(function(sid) {
                                                                return syncFn.setUsersRoomId(masterRedis, slaveRedis, usersArray[person], sid)
                                                            })
                                                            .then(function () {
                                                            })
                                                            .catch(function () {
                                                                console.log('error');
                                                            });
                                                    }
                                                }
                                            }
    
                                            signalSocket.emit(sessionId, exitData, data);
                                            logger.log('info', `[Socket : '${data.eventOp}' Event / 다자간 화상회의] *\n* 현재 처리중 방향 : [Signal -> App (Resp)] *\n* 요청자 : ' ${data.userId} ' *\n* eventOp : ' ${data.eventOp}  ' *\n Room에 1명만 존재하였음. \n App으로 전달 데이터 : ', ${JSON.stringify(exitData)}`);
                                        }
                                    });
                                } else {
                                    syncFn.setUsersRoomId(masterRedis, slaveRedis, data.userId, sessionId);
    
                                    await coreConnector.start(
                                        sessionId,
                                        'put',
                                        `users/${data.userId}/status`,
                                        {
                                            status: 'ready'
                                        }
                                    );
    
                                    // coreConnector.emit(sessionId, exitStateData, async function () {
    
                                    if (isDeleteUser) {
                                        signalSocket.emit(sessionId, exitData, data);
                                        logger.log('info', `[Socket : '${data.eventOp}' Event / 다자간 화상회의] *\n* 현재 처리중 방향 : [Signal -> App (Resp)] *\n* 요청자 : ' ${data.userId} ' *\n* eventOp : '  ${data.eventOp}  ' *\n Room에 2명 존재하였음. \n App으로 전달 데이터 : ', ${JSON.stringify(exitData)}`);
                                        //janus.
                                        if(multiType === 'Y') {
                                            let janus_url = await syncFn.getJanusServerByRoomId(redisInfo, sessionDataFromRedis.ROOM_ID);
                                            let _data = {
                                                janusRoomId: await syncFn.getJanusRoomId(redisInfo, sessionDataFromRedis.ROOM_ID),
                                                roomId: sessionDataFromRedis.ROOM_ID,
                                                videoRoomPluginId: sessionDataFromRedis.JANUS_PUBLISHER_PLUGIN_ID
                                            };
                                            console.log("_data" , _data);
                                            console.log("exitPresenceData", exitPresenceData);
                                            await fn_janus.processLeaveVideoRoom(janus_url, sessionId, _data);
                                        }
                                        //janus end.
                                        // commonFn.getUserName(/*coreSocketio,*/data.userId, function (err, userName) {
                                        //     console.log(err, userName);
                                        //     if (err || !userName) {
                                        //         exitPresenceData.userName = exitPresenceData.userId;
                                        //     } else {
                                        //         exitPresenceData.userName = userName;
                                        //     }
    
                                            console.log('deleteUser - broadcast 전송.');
                                            // 180727 ivypark, userCount 추가.
                                            exitPresenceData.userCount = usersArray.length - 1;
                                            signalSocket.broadcast(socket, data.roomId, exitPresenceData);
                                            logger.log('info', `[Socket : ' ${data.eventOp}' Event / 다자간 화상회의] *\n* 현재 처리중 방향 : [Signal -> App (broadcast)] *\n* ' + ${data.userId} + ' 님이 방을 나갔습니다. \n App으로 전달 데이터 : ', ${JSON.stringify(exitPresenceData)}`);
                                        // });
    
                                    } else {
                                        if (isConferenceEnded) {
                                            //janus.
                                            let janus_url;
                                            let janusRoomId;
                                            if(commonFn.isSfu() === true){
                                                try{
                                                    janusRoomId = await syncFn.getJanusRoomId(redisInfo, sessionDataFromRedis.ROOM_ID);
                                                    janus_url = await syncFn.getJanusServerByRoomId(redisInfo, sessionDataFromRedis.ROOM_ID);
                                                    // await fn_janus.destroyRoom(server_idx, await syncFn.getJanusRoomId(redisInfo, sessionDataFromRedis.ROOM_ID), sessionDataFromRedis.JANUS_PUBLISHER_PLUGIN_ID);
                                                } catch(e) {
                                                    console.log('isConferenceEnded ERROR.1', e);
                                                }
                                            }
    
                                            //janus end.
                                            for (let usersArrayId of usersArray) {
                                                await syncFn.getUserSocketId(masterRedis, slaveRedis, usersArrayId).then(async function(sid) {
                                                    console.log('fn_Kurento.stop 실행 ----> ', usersArrayId, sid);
                                                    //janus.
                                                    if(multiType === 'Y') {
                                                        try{
                                                            let _data = {
                                                                roomId: sessionDataFromRedis.ROOM_ID,
                                                                janusRoomId: janusRoomId
                                                            };
                                                            await fn_janus.processLeaveVideoRoom(janus_url, sid, _data);
                                                        } catch (e) {
                                                            console.log('isConferenceEnded ERROR.2', e);
                                                        }
                                                    } else {
                                                        fn_Kurento.stop(sid, data.roomId, masterRedis, slaveRedis);
                                                    }
                                                    //janus end.
                                                    exitPresenceData.action = 'end';
                                                    if (data.userId !== usersArrayId) {
                                                        signalSocket.emit(sid, exitPresenceData, data);
    
                                                        commonFn.transaction(Object.assign({
                                                            userId: usersArrayId,
                                                            roomId: data.roomId
                                                        }, exitData), data, sessionId);
                                                        console.log('presense end userid : ', usersArrayId);
                                                    }
    
                                                    await coreConnector.start(
                                                        sessionId,
                                                        'put',
                                                        `rooms/${data.roomId}/exit`,
                                                        {}
                                                    );
    
                                                    // coreConnector.emit(sessionId, {'eventOp': 'UpdateConferenceHistory', 'roomId': data.roomId, 'status' : 'end'}, data => {
                                                    //     logger.log('info', `UpdateConferenceHistory callback ${JSON.stringify(data)}` );
                                                    // });
                                                    fn_Kurento.screenShareStop(sid, data.roomId, masterRedis, slaveRedis);
                                                });
                                            }
    
                                            if(multiType === 'Y'){
                                                try{
                                                    await fn_janus.destroyRoom(janus_url, await syncFn.getJanusRoomId(redisInfo, sessionDataFromRedis.ROOM_ID));
                                                    await fn_janus.clearRedisData(sessionDataFromRedis.ROOM_ID);
                                                } catch (e) {
                                                    console.log('isConferenceEnded ERROR.3.', e);
                                                }
                                            }
                                            // syncFn.getUserList(masterRedis, slaveRedis, data.roomId).then(function(userArr) {
                                            //     console.log('exitRoom userList : ', userArr);
                                            //     for (let i = 0; i < userArr; i++) {
                                            //         syncFn.getUserSocketId(masterRedis, slaveRedis, userArr[i]).then(function(sid) {
                                            //             signalSocket.emit(sid, exitPresenceData);
                                            //         })
                                            //     }
                                            // });
    
                                            // signalSocket.broadcast(socket, data.roomId, exitPresenceData);
                                        } else {
                                            if(multiType === 'Y') {
                                                try {
                                                    let janus_url = await syncFn.getJanusServerByRoomId(redisInfo, sessionDataFromRedis.ROOM_ID);
                                                    let janusRoomId = await syncFn.getJanusRoomId(redisInfo, sessionDataFromRedis.ROOM_ID);
                                                    let _data = {
                                                        roomId: sessionDataFromRedis.ROOM_ID,
                                                        janusRoomId: janusRoomId
                                                    };
                                                    await fn_janus.processLeaveVideoRoom(janus_url, sessionId, _data);
                                                    await fn_janus.destroyRoom(janus_url, janusRoomId);
                                                    await fn_janus.clearRedisData(sessionDataFromRedis.ROOM_ID);
                                                } catch (e) {
                                                    console.log('isConferenceEnded ERROR.4.', e);
                                                }
                                            }
                                        }
    
                                        if (usersArray.length >= 1) {
                                            usersArray.forEach(async elem => {
                                                await coreConnector.start(
                                                    sessionId,
                                                    'put',
                                                    `users/${elem}/status`,
                                                    {
                                                        status: 'ready'
                                                    }
                                                );
                                            });
    
    
                                            // coreConnector.emit(sessionId, {
                                            //     'eventOp': 'MemberStatus',
                                            //     'userId': usersArray,
                                            //     'status': 'ready'
                                            // }, function () {
                                            console.log('-----> 현재 usersArray : ', usersArray);
                                            if (usersArray !== 'notExist') {
                                                for (let person in usersArray) {
                                                    console.log('setUsersRoomId 실행 ---> ', usersArray[person], person, usersArray);
                                                    syncFn.getUserSocketId(masterRedis, slaveRedis, usersArray[person])
                                                        .then(function(sid) {
                                                            return syncFn.setUsersRoomId(masterRedis, slaveRedis, usersArray[person], sid);
                                                        })
                                                        .then(function () {
                                                        })
                                                        .catch(function () {
                                                            console.log('error');
                                                        });
                                                }
                                            }
                                            // });
                                        }
    
                                        signalSocket.emit(sessionId, exitData, data);
                                        logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의] *\n* 현재 처리중 방향 : [Signal -> App (Resp)] *\n* 요청자 : ' ${data.userId} ' *\n* eventOp : '${data.eventOp} ' *\n Room에 2명 존재하였음. \n App으로 전달 데이터 : ',${JSON.stringify(exitData)}`);
                                    }
                                    // });
                                }
                            }).catch(function (err) {
                                signalSocket.emit(sessionId, {
                                    eventOp: data.eventOp,
                                    resDate: commonFn.getDate(),
                                    code: '561',
                                    message: 'Internal Server Error'
                                }, data);
                                logger.log('warn', `[Socket : ' ${data.eventOp} '  Event / 다자간 화상회의] *\n* 요청자 : ' ${data.userId} ' *\n* eventOp : ' ${data.eventOp} ' *\n EXIT ROOM ERROR. `);
                            });
    
                        break;
                    }
                default :

                break;
            }
        }
    });

};

module.exports = signalServerEvent;
