const commonFn = require('./fn.common.service');
const syncFn = require('./fn.sync.service');
const logger = require('../common/logger');
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
        //janus end.`

        let data = _data;

        if (data.eventOp !== 'SDP' && data.eventOp !== 'Candidate') {
            console.log('pid : ' + pid + ' /// [App -> Signal] Data : ', data);
        }

        logger.log('info', `[Socket : ' ${data.eventOp} ' Event / PID : ' ${JSON.stringify(pid)}  '] *\n* 현재 처리중 방향 : [App -> Signal] *\n* eventOp : ' ${data.eventOp} '*\n* ${data.userId} : ' ${data.userId} || ${sessionId} '*\n* App으로 부터 온 Data : * \n' ${JSON.stringify(data) }`);

        let eventOp = data.eventOp || '';
        let signalOp = data.signalOp || '';

        if (signalOp) {
            switch (signalOp) {

                case 'Chat':
                    let chatData = {
                        'signalOp': 'Chat',
                        'userId': data.userId,
                        'message': data.message,
                    };

                    syncFn.getRoomId4(masterRedis, slaveRedis, data.userId).then((roomId) => {
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
    
                        signalSocket.emit(sessionId, {
                            'eventOp': data.eventOp,
                            'reqNo': data.reqNo,
                            'code': '200',
                            'message': 'OK',
                            'resDate': commonFn.getDate(),
                            'config': info.servers
                        }, data);
    
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

                        syncFn.getUserInfo(masterRedis, slaveRedis, data.userId).then(async (userInfo) => {
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

                            logger.log('info', `[Socket : '  ${data.eventOp}  ' Event / 다자간 화상회의 / Call] *\n 최초 Call - 요청자 : ', ${data.userId}`);

                            commonFn.getRoomId().then(async (roomObj) => {

                                roomId = roomObj;
                                
                                //redis에 방 정보 저장
                                syncFn.setRoom(masterRedis, slaveRedis, roomId, data.serviceType, data.userId, data.userName, sessionId, data.reqDeviceType, data.targetId, data.targetId.length, null );
                                socket.join(roomId);

                                inviteData.roomId = roomId;
                                data.roomId = roomId;

                                let cHistory = await coreConnector.start(
                                    sessionId,
                                    'post',
                                    'rooms',
                                    {
                                        userId: data.userId,
                                        targetId: data.targetId,
                                        roomId
                                    }
                                );

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

                                    let count = acceptUser.length - 1;
                                    (function enterRoom() {
                                        let send_targetId = acceptUser[count];
                                        syncFn.getUserSocketId(masterRedis, slaveRedis, send_targetId).then((socketObj)=>{
                                            commonFn.reqNo().then((reqResult)=>{
                                                inviteData.reqNo = reqResult;
                                                syncFn.setMultiType(masterRedis, slaveRedis, userInfo.ROOM_ID).then((result)=>{
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
                                                            
                                                        }
                                                        //janus end.
                                                    } else {
                                                        setTimeout(() => {
                                                            signalSocket.emit(socketObj, inviteData, data);
                                                            logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의 / Invite] *\n* 현재 처리중 방향 : [Signal -> App (Req)] *\n* 수신자 : ' ${JSON.stringify(send_targetId)}' *\n Invite 메시지 :  ${JSON.stringify(inviteData)}`);
                                                        }, 3000);
                                                    }
                                            
                                                    // 180803 ivypark, enterRoom Invite에 추가. invite 대상이 초대 팝업이 뜨면 방장이 나갔을 때 사라져야 함. 요청 : kt
                                                    console.log('invite enterRoom -> ', send_targetId);
                                                    syncFn.enterRoom(masterRedis, slaveRedis, roomId, send_targetId, inviteData.userName, socketObj, '', 'accept').then((userList)=>{
                                                        if (count-- > 0) {
                                                            enterRoom();
                                                        }
                                                    }).catch((err) => {
                                                            console.log(`ivypark ::::::::::::: `, err);
                                                            logger.log('warn', '사용자가 방에 정상적으로 참가되지 않았음.');
                                                    });
                                                }).catch(() => {
                                                        console.log('RoomsInfo에 Multitype setting 중 error ', '');
                                                        logger.log('warn', 'RoomsInfo에 Multitype setting 중 error');
                                                });
                                            }).catch(() => {
                                                console.log('ReqNo 다자간 화상회의 Invite error');
                                            });
                                        }).catch((err) => {
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
                                    }

                                    signalSocket.emit(sessionId, sendData, data);
                                    logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의 / Call] *\n* 현재 처리중 방향 : [Signal -> App (Resp)] *\n* 요청자 : ' ${data.userId} ' *\n* eventOp : ' ${data.eventOp} ' *\n App으로 전달할 Data : ', ${JSON.stringify(sendData)}`);

                                }
                            });
                           
                        }).catch((err) => {
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
                        syncFn.getRoomId3(masterRedis, slaveRedis, sessionId).then((roomId) => {
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

                        syncFn.getRoom(slaveRedis, data.roomId).then(async (roomResult) => {
                            console.log("룸아이디 존재할경우", data.status);
                           
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

                            presenceData.userCount = _userList.length;
                            signalSocket.broadcast(socket, data.roomId, presenceData);
                            logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의 / Presence / 성공] *\n* 현재 처리중 방향 : [Signal -> App (Pass)] *\n App으로 전달할 Data : ', ${JSON.stringify(presenceData)}`);

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
                        });

                        break;
                    }
                case 'SDP':
                    {
                        if (data.usage === 'cam') {
                            console.log('SDP ---> cam');
                            syncFn.getRoom(slaveRedis, data.roomId).then(async (roomResult) => {
                                if (roomResult.MULTITYPE && roomResult.MULTITYPE === 'N') {
                                    if (data.sdp) {
                                        if (!data.userId) {
                                            console.log('userId false, --> Guest');
                                            data.userId = 'Guest';
                                        }
    
                                        data.useMediaSvr = 'N';
                                        commonFn.reqNo().then( (reqResult) => {
                                            syncFn.msgManager.save(masterRedis, slaveRedis, data, reqResult, sessionId, pid).then(function () {
                                                data.reqNo = reqResult;
                                                signalSocket.broadcast(socket, data.roomId, data);
                                                logger.log('info', `[Socket : '${data.eventOp} ' Event / 다자간 화상회의] *\n* 현재 처리중 방향 : [Signal -> App (Req)] *\n* eventOp : ' ${data.eventOp} ' *\n 1:1 P2P 상황. ' + ${data.userId}+ '가 보낸 SDP를 상대에게 전달중. \n ReqNo 생성 완료. App으로 전달할 Data : ', ${JSON.stringify(data)}`);
                                            });
                                        }).catch(() => {
                                            console.log('error');
                                        });
                                    } else {
                                        syncFn.msgManager.load(masterRedis, slaveRedis, data, sessionId, pid).then( (respObj) => {
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
                                }
                            }).catch((err) => {
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
                        }
    
                        break;
                    }
                case 'Candidate':
                    {
                        setTimeout(() => {
                            if (data.usage === 'cam') {
                                syncFn.getRoom(slaveRedis, data.roomId).then(async (roomResult) => {
                                    if (data.code === '200' && roomResult.MULTITYPE === 'Y') {
                                        return false;
                                    }
    
                                    if (roomResult.MULTITYPE && roomResult.MULTITYPE === 'N') {
                                        if (data.candidate) {
                                            if (!data.userId) {
                                                data.userId = 'Guest';
                                            }
                                            data.useMediaSvr = "N";
                                            commonFn.reqNo().then((reqResult) => {
                                                syncFn.msgManager.save(masterRedis, slaveRedis, data, reqResult, sessionId, pid).then(() => {
                                                    data.reqNo = reqResult;
                                                    signalSocket.broadcast(socket, data.roomId, data);
                                                    logger.log('info', `[Socket : '${data.eventOp} ' Event / 다자간 화상회의] *\n* 현재 처리중 방향 : [Signal -> App (Req)] *\n* Candidate 전달요청자 : ' ${data.userId} ' *\n* eventOp : ' ${data.eventOp} ' *\n 1:1 P2P 상황. ' ${data.userId} '가 보낸 Candidate를 상대에게 전달중. \n ReqNo 생성 완료. App으로 전달할 Data : ', ${JSON.stringify(data)}`);
                                                });
                                            }).catch(() => {
                                                console.log('error');
                                            });
                                        } else {
                                            console.log('# candidate 200 answer ---> ', data.reqNo);
                                            logger.log('info', `# candidate 200 answer ---> ${data.reqNo}`);
                                            syncFn.msgManager.load(masterRedis, slaveRedis, data, sessionId, pid).then( (respObj) => {
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
                                syncFn.getRoom(slaveRedis, data.roomId).then(async (roomResult) => {
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
                                            commonFn.reqNo().then( (reqResult) => {
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
                                            }).catch(() => {
                                                console.log('error');
                                            });
                                        } else {
                                            syncFn.msgManager.load(masterRedis, slaveRedis, data, sessionId, pid)
                                                .then( (respObj) => {
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
                        syncFn.getUserListIncludeGuest(masterRedis, slaveRedis, data.roomId)
                            .then( (userArray) => {
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
                                },(error) => {
                                    console.log("방이 없는데 ExitRoom을 날림. 방장이 나간 경우 이렇게 될 수도 있음. : ", error);
                                    logger.log('warn', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의 / Redis] *\n* 방이 없는데 ExitRoom을 날림. 방장이 나간 경우 이렇게 될 수도 있음. `);
                                }
                            ).then(async (msg) => {
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
    
                                let multiType;
    
                                socket.leave(data.roomId);
    
                                if (isGuest) {
                                    syncFn.initGuestUserInfo(masterRedis, slaveRedis, data.userId, sessionId).then(async () => {
                                        if (isDeleteUser) {
                                            signalSocket.emit(sessionId, exitData, data);
    
                                            // 180727 ivypark, userCount 추가.
                                            exitPresenceData.userCount = usersArray.length - 1;
                                            signalSocket.broadcast(socket, data.roomId, exitPresenceData);
                                            logger.log('info', `${JSON.stringify(exitData)}, ${JSON.stringify(exitPresenceData) }`);
                                        } else {
                                            if (isConferenceEnded) {
    
                                                exitPresenceData.action = 'end';
                                                await coreConnector.start(
                                                    sessionId,
                                                    'put',
                                                    `rooms/${data.roomId}/exit`,
                                                    {}
                                                );
                                        
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
                                        }
    
                                        signalSocket.emit(sessionId, exitData, data);
                                        logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의] *\n* 현재 처리중 방향 : [Signal -> App (Resp)] *\n* 요청자 : ' ${data.userId} ' *\n* eventOp : '${data.eventOp} ' *\n Room에 2명 존재하였음. \n App으로 전달 데이터 : ',${JSON.stringify(exitData)}`);
                                    }
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
