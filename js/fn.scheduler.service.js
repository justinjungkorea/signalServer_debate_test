const commonFn = require('./fn.common.service');
const syncFn   = require('./fn.sync.service');
const logger   = require('../common/logger');
const scheduler = require('node-schedule');

let masterRedis = null;
let slaveRedis = null;
let signalSocketio = null;
let coreSocketio = null;
let count = 0;

var rcJob;
var toJob;
var schedulerEvent = {
    start : function() {
        //this.readyCall.start();
        // let schIntv = setInterval(function(){
        //     if(schedulerEvent.readyCall.check()) {
        //         this.readyCall.start();
        //         clearInterval(schIntv);
        //     }
        // }, 3000);
    },

    timeout : {
        code : function(_opName) {
            switch(_opName) {
                case 'SDP' :
                case 'ScreenShare' :
                    return '526';
                    break;
                case 'Candidate' :
                    return '527';
                    break;
                case 'GuestJoin':
                    return '528';
            }
        },

        init : function() {
            // 이중화 이후 고민
        },

        start : function(signalSocketio, /*coreSocketio,*/ masterRedis, slaveRedis, _pid) {
            const cfg = commonFn.getSchedulerConfig();
            console.log('timeout scheduler event start');
            logger.log('info','[Timeout Scheduler Service] message timeout scheduler event start');

            scheduler.scheduleJob({ /* start: startTime, end: endTime, */ rule: '*/5 * * * * *' }, function() {
                try {
    				slaveRedis.HGETALL('MESSAGE_INFO', function(error, objString){
    					if(!objString) {
    						//console.log('[Timeout Scheduler Service] ::: 처리할 메시지 없음 :');
                            //logger.log('info', '[Timeout Scheduler Service] ::: 처리할 메시지 없음 :::');
    						return;
    					}

                        let resultStatus;
                        let pid;
                        for(var msgKey in objString){
                            resultStatus = setObject(objString[msgKey]).RESULT_STATUS;
                            pid = setObject(objString[msgKey]).PID;
                            if(pid === _pid) {
                                if(resultStatus === 'N') {
                                    // console.log('N . key is? ', msgKey);
                                    logger.log('info', `[Timeout Scheduler Service] RESULT_STATUS : N, Key is? ${msgKey}`);

                                    (function(msgKey) {
                                        slaveRedis.HGET('MESSAGE_INFO', msgKey, function(error, msgString){
                                            let msgData = JSON.parse(msgString);
                                            let waitingTime = (function() {
                                                switch(msgData.REQ_OP_NAME) {
                                                    case 'SDP'          :
                                                    case 'Candidate'    :
                                                    case 'ScreenShare'  :
                                                        return cfg.msgTimeout.waitingTime;
                                                        break;
                                                    case 'GuestJoin' :
                                                        return 30;
                                                }
                                            })();

                                            logger.log('info', `[Timeout Scheduler Service] waiting (sec) : '${JSON.stringify(waitingTime)} `);
                                            let nowDate = new Date().toFormat('YYYYMMDDHH24MISS');
                                            let waitDate = String(Number(msgData.REQ_TIME) + waitingTime);

                                            if( nowDate > waitDate ) {
                                                // wait 시간이 지난 경우
                                                logger.log('info',`[Timeout Scheduler Service] timeout date expired… now::' ${nowDate} ', wait::' ${waitDate} ', key:: ' ${msgKey}`);
                                                
                                                let userId = msgData.REQ_USER_ID;
                                                msgData.RESULT_STATUS = 'Y';
                                                masterRedis.HSET('MESSAGE_INFO', msgKey, setString(msgData));

                                                syncFn.getUserSocketId(masterRedis, masterRedis, userId).then(
                                                    function(socketObj){
                            							let rejectData = {
                            								'eventOp'		: msgData.REQ_OP_NAME,
                            								'reqNo'			: msgData.REQ_NO,
                                                            'resDate'       : commonFn.getDate(),
                            								'roomId'		: msgData.ROOM_ID,
                            								'code'		    : schedulerEvent.timeout.code(msgData.REQ_OP_NAME)
                            							};

                            							let destination;
                                                        if (msgData.REQ_OP_NAME === 'GuestJoin') {
                                                            let roomId = msgData.ROOM_ID;
                                                            let userId = msgData.REQ_USER_ID + '<#>' + msgData.SESSION_ID;
                                                            syncFn.deleteUser(masterRedis, slaveRedis, roomId, userId);

                                                            rejectData.roomId = undefined;
                                                            destination = msgData.SESSION_ID;
                                                        } else {
                                                            destination = socketObj;
                                                        }

                                                        signalSocket.emit(destination, rejectData);
                                                        logger.log('info', `[Timeout Scheduler Service  ${msgData.REQ_OP_NAME} ] *\n* 현재 처리중 방향 : [Signal (scheduler) -> App] *\n* eventOp : ' + msgData.REQ_OP_NAME + ' *\n* 보낼 데이터 : ' ${JSON.stringify(rejectData)}`);

                                                    }
                                                );
                                            } else {
                                                // 시간이 남아 있는 경우
                                                // 추후 구현 필요한가?
                                            }
                                        });
                                    })(msgKey);
                                }
                            }
        				}
    				});
    			} catch(err) {
    				console.log('Timeout Scheduler. Catch ERROR ::: 잘못된 TableKey 호출 ::: tableKey : ', err);
                    logger.log('warn', '[Timeout Scheduler Service] Catch ERROR ::: 잘못된 TableKey 호출의 경우를 의심 :::');
    			}
            });
        }
    },

    readyCall : {
        waitUserCnt : 0,
        check : function() {
            if(!signalSocketio || !coreSocketio || !masterRedis || !slaveRedis) {
                console.log('data setting is not yet : ', signalSocketio, coreSocketio, masterRedis, slaveRedis, schedulerEvent.readyCall.masterRedis);
                count += 1;
                console.log(count);
                return false;
            } else {
                console.log('data setting complete');
                count += 100;
                console.log(count);
                return true;
            }
        },
        setInfo : function(_signalSocketio, _coreSocketio, _masterRedis, _slaveRedis) {
            signalSocketio = _signalSocketio;
            coreSocketio = _coreSocketio;
            masterRedis = _masterRedis;
            slaveRedis = _slaveRedis;
            //schedulerEvent.readyCall.masterRedis = _masterRedis;
        },
        start : function(_signalSocketio, _coreSocketio, _masterRedis, _slaveRedis, pid) {
            const cfg = commonFn.getSchedulerConfig();

            signalSocketio = _signalSocketio;
            coreSocketio = _coreSocketio;
            masterRedis = _masterRedis;
            slaveRedis = _slaveRedis;
            //var rule = new scheduler.RecurrenceRule();
            //rule.minute = -1;

            //let startTime = new Date(Date.now() + 2000);
            //let endTime = new Date(startTime.getTime() + 160000);

            console.log('ready call scheduler event start');
            logger.log('info','[ReadyCall Scheduler Service] ready call scheduler event start');

            rcJob = scheduler.scheduleJob({ /* start: startTime, end: endTime, */ rule: '*/5 * * * * *' }, function() {

                //console.log(schedulerEvent.readyCall.waitUserCnt);
                // wait인 고객 찾기
                let data = {
                    eventOp : 'WaitingCallSch',
                    action : 'findWaiter',
                    pid : pid
                }
                coreConnector.emit(sessionId, data, function(_data){
                    if(!_data.result) {
                        //console.log('waiting client not exist');
                        schedulerEvent.readyCall.waitUserCnt = 0;
                        //logger.log('info','[ReadyCall Scheduler Service] WAIT CALL USER IS NOT EXIST');
                        return;
                    }

                    if(!_data.result.length) {
                        let _tdata = [];
                		_tdata.push(_data.result);
                        _data.result = _tdata;
                    }

                    schedulerEvent.readyCall.waitUserCnt = _data.result.length;
                    let nowDate = new Date(Date.now()).getTime();
                    let waiterDate = new Date(_data.result[0].create_date).getTime() + (cfg.readyCall.waitingTime * 1000) // ms
                    if( nowDate > waiterDate ) {
                        // wait 시간이 지난 경우
                        console.log('date expired', nowDate, waiterDate);
                        logger.log('info',`[ReadyCall Scheduler Service] date expired. ID : ${_data.result[0].genie_id}`);
                        schedulerEvent.readyCall.delete(_data.result[0].genie_id);
                    } else {
                        console.log('go wait call', nowDate, waiterDate);

                        // ready 인 상담사 찾기. (wait인 고객이 걸었던 targetId 기준)

                        data.action = 'findConsultant';
                        data.userId = _data.result[0].genie_id;
                        coreConnector.emit(sessionId, data, function(_data){

                            logger.log('info', `[ReadyCall Scheduler Serice] WAIT CALL! PID : ${pid}`);
                            console.log('pid, data : ', pid, _data);
                            if(!_data.result) {
                                console.log('consultant not exist', _data);
                                logger.log('info','[ReadyCall Scheduler Service] READY STATE CONSULTANT IS NOT EXIST');
                                return;
                            }

                            if(!_data.result.length) {
                                let _tdata = [];
                                _tdata.push(_data.result);
                                _data.result = _tdata;
                            }

                            let genieId = data.userId;
                            let consultantId = _data.result[0].id;
                            let targetId = _data.targetId;
                            if(consultantId) {
                                console.log('consultant exist : ', consultantId);
                                logger.log('info',`[ReadyCall Scheduler Service] READY STATE CONSULTANT IS EXIST /  ${consultantId}`);

                                let inviteData = {
                                    'eventOp'     : 'Invite',
                                    'reqNo'       : commonFn.getReqNo(5),
                                    'userId'      : genieId,
                                    'reqDate'     : commonFn.getDate(),
                                    'serviceType' : 'single'
                                };

                                syncFn.getRoomId4(masterRedis, slaveRedis, genieId).then(function(roomObj) {
                                    console.log('roomId is :: ', roomObj)
                                    if(!roomObj) {
                                        console.log('room id not exist!!');
                                        return;
                                    }
                                    inviteData.roomId = roomObj;
                                });

                                //상담사 소켓아이디를 Sync서버로 가져온 후 Call한 사람 DB의 status 상태를 변경.
                                syncFn.getUserSocketId(masterRedis, slaveRedis, consultantId).then(
                                    function(socketObj){
                                        let memberData = {
                                            eventOp :'MemberStatus',
                                            userId  : data.userId
                                        };

                                        //Call한 사람의 DB상태를 busy로 변경
                                        coreConnector.emit(sessionId, memberData, function(){
                                            signalSocket.emit(socketObj, inviteData);

                                            data.action = 'delete';
                                            data.userId = genieId;
                                            // wait 상태인 사람의 상태를 waitEnd로 변경
                                            coreConnector.emit(sessionId, data, function(_data){
                                                console.log('data delete (wait -> waitEnd) :::', _data);
                                                logger.log('info', `[ReadyCall Scheduler Service] DB DATA DELETE success /' ${JSON.stringify(_data) }`);
                                            });

                                        });
                                    },

                                    function(err){
                                        console.log("error : ", err);
                                        logger.log('info', `[ReadyCall Scheduler Service] getUserSocketId error ${JSON.stringify(err)}`);
                                    }
                                );

                            } else {
                                console.log('consultant not exist', _data);
                            }
                        });
                    }

                });
            });
        },

        stop : function() {
            console.log('scheduler event canceled');
            logger.log('info','[ReadyCall Scheduler Service] scheduler event canceled');
            if(rcJob) { rcJob.cancel(); }
        },

        delete : function(genieId) {
            let roomId;
            let data = {
                eventOp : 'WaitingCallSch',
                action : 'delete',
                userId : genieId
            }

            // wait 상태인 사람의 상태를 waitEnd로 변경
            coreConnector.emit(sessionId, data, function(_data){
                console.log('data delete (wait -> waitEnd) :::', _data);
                logger.log('info', `[ReadyCall Scheduler Service] DB DATA DELETE /  ${JSON.stringify(_data) }`);

                syncFn.getRoomId4(masterRedis, slaveRedis, genieId).then(function(roomObj) {
                    console.log('roomId is :: ', roomObj)
                    if(!roomObj) {
                        console.log('room id not exist!!');
                        return;
                    }
                    roomId = roomObj;
                });

                syncFn.getUserSocketId(masterRedis, slaveRedis, genieId).then(
                    function(socketObj) {
                        console.log('socketObj :::: ', socketObj);
                        if(!socketObj) return;
                        

                        commonFn.getConsultUserName( /*coreSocketio,*/ genieId, function( err, userName ) {
                           
                            let sendData = {
                                'signalOp' : 'Presence',
                                'action'   : 'callTimeout',
                                'userName' : userName,
                                'userId'   : genieId,
                            };
    
                            // presence 메시지 전달
                            signalSocket.emit(socketObj, sendData);
                            console.log('send presence message success');
                            logger.log('info','[ReadyCall Scheduler Service] SEND PRESENCE MESSAGE (callTimeout) / SUCCESS');
                        })  
                        
                        syncFn.getUserList(masterRedis, slaveRedis, roomId)
    	       			.then(
                            function(userArray){
    	       					console.log("userArray : ", userArray);
    	       					usersArray = userArray;
    	       					if(usersArray.length <= 2){
    	       						//현재 방인원이 2명 이하이고 이중 한명이 나가는 경우 방을 삭제하고, 해당 회원들의 상태값을 'ready'로 변경.
                                       console.log("룸에 2명인 경우.");

                                    let readyData = {
                                        eventOp 	: 'MemberStatus',
                                        userId		: genieId,
                                        status		: 'ready'

                                    } 

                                    coreConnector.emit(sessionId, readyData, function(_data){
                                        logger.log('info', `[Socket : ${data.eventOp} Event / Web 전용] *\n* 현재 처리중 방향 : [Signal -> Core] *\n* Status 변경 ', ${JSON.stringify(data) }`);
                                        syncFn.deleteRoom(masterRedis, slaveRedis, roomId)
                                    });    
                                    
                                    return;
                                }else{
                                    //현재 방인원이 3명 이상일 때 해당 회원아이디만 방에서 삭제하고, 해당 회원의 상태값을 'ready'로 변경.
                                    let readyData = {
                                        eventOp 	: 'MemberStatus',
                                        userId		: genieId,
                                        status		: 'ready'

                                    } 
                                    console.log("룸에 3명인경우");

                                    coreConnector.emit(sessionId, readyData, function(_data){
                                        logger.log('info', `[Socket : ${data.eventOp} Event / Web 전용] *\n* 현재 처리중 방향 : [Signal -> Core] *\n* Status 변경 ', ${JSON.stringify(data) }`);
                                        syncFn.deleteUser(masterRedis, slaveRedis, roomId, genieId);
                                    });

                                    return;
    	       					}
    	       				},
    	       				function(error){
    	       					console.log("error : ", error);
                                logger.log('warn','[ReadyCall Scheduler Service] getUserList / ERROR');
    	       				}
                        ).then(
    	       				function(msg){
    	       					if(msg == 'deleteUser'){
    	       						//3명 이상일 경우 한명만 룸에서 삭제한 경우 - deleteUser을 한경우.
    	       						console.log("msg : ", msg);
    	       					}else{
    	       						//2명이하일 경우 - deleteRoom을 한 경우
    	       						//consulting_history 정보 업데이트 및 해당 룸에 있던 사용자 상태 업데이트.
    	       						console.log("deleteRoom 한경우.", usersArray);

	       							if(usersArray.length == 1){
	       								console.log("룸에 한명만 존재 - ");
	       								syncFn.setUsersRoomId(masterRedis, slaveRedis, usersArray[0], socketObj)
	       								.then(function(){
	       									//signalSocketio.to(sessionId).emit('knowledgetalk', exitData);
	   										//logger.log('info','[Signal -> App] ExitRoom Response', commonFn.setJSON(exitData));
	       								})
	       								.catch(function(error) {
                                            console.log('get CoreServer URL error')
                                        });
    	       						}
    	       					}
    	       				}
    	       			).catch(function(error) {
                            console.log('get CoreServer URL error')
                        });
                });
            });
        }
    }
}

//String으로 변환
function setString(data){
	return JSON.stringify(data);
}

//Object로 변환
function setObject(data){
	return JSON.parse(data);
}

module.exports = schedulerEvent;
