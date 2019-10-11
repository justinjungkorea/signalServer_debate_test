/****************************************************
* 소스정보 : fn.sync.service.js
* 작 성 일 : 2017.11.
* 수 정 일 :
* 설    명 : Sync서버관련 메서드
*****************************************************/
const logger = require('../common/logger');

//String으로 변환
function setString(data){
	return JSON.stringify(data);
}

//Object로 변환
function setObject(data){
	return JSON.parse(data);
}

let MASTER_REDIS;
let SLAVE_REDIS;

exports.getRedisServer = function() {
    return {
        master: MASTER_REDIS,
        slave: SLAVE_REDIS
    }
};

exports.initGuestUserInfo = function(syncMaster, syncSlave, userId, socketId) {
    let socketIdData = {'ID':userId, 'ROOM_ID':''};
    syncMaster.HSET('SESSION_USER_SOCKET_INFO', socketId, setString(socketIdData));
};

//소켓정보 저장
exports.setUserInfo = function(syncMaster, syncSlave, userId, socketId ,serviceType){
	if(!MASTER_REDIS)
		MASTER_REDIS = syncMaster;
	if(!SLAVE_REDIS)
		SLAVE_REDIS = syncSlave;

	let socketIdData = {'ID':userId, 'ROOM_ID':'','SERVICE_TYPE': serviceType};
	let userIdData   = {'SOCKET_ID':socketId, 'ROOM_ID':'','SERVICE_TYPE': serviceType};

	syncMaster.HSET('SESSION_USER_SOCKET_INFO', socketId, setString(socketIdData));
	syncMaster.HSET('SESSION_USER_ID_INFO', userId, setString(userIdData));
};

let rejectCode = {
	code: '561',
	message: 'Internal Server Error'
};

//소켓정보가져오기
exports.getUserSocketId = function(syncMaster, syncSlave, userId){
	if(!MASTER_REDIS)
		MASTER_REDIS = syncMaster;
	if(!SLAVE_REDIS)
		SLAVE_REDIS = syncSlave;

    return new Promise(function(resolved, rejected){
		syncSlave.HGET('SESSION_USER_ID_INFO', userId, function(error, objString){
			if (!objString) {
				resolved(null);
				return false;
			}

			if (error) {
				logger.log('warn', `[Sync Server : getUserSocketId] User Id가 Redis (SESSION_USER_ID_INFO)에 없음, user Id : ' ${userId}`);
				rejected(rejectCode);
				return false;
			} else {
				let socketId;
				let parseObject = setObject(objString);

				try {
					socketId = parseObject.SOCKET_ID;
					logger.log('info', `[Sync Server : getUserSocketId] + ${userId} +의 Socket Id 찾기 성공 : ${socketId}`);
					resolved(socketId);
				} catch(err) {
					logger.log('error', `[Sync Server : getUserSocketId] parseObject.SOCKET_ID를 찾을 수 없음. : ${JSON.stringify(parseObject)}`);
					console.log('socket Id 없음. ERROR!!!!');
					rejected(rejectCode);
				}
			}
		});
	});
};

//소켓아이디로 UserId
exports.getUserId = function(syncMaster, syncSlave, socketId){
	let userId;
	return new Promise(function(resolved, rejected){
		syncSlave.HGET('SESSION_USER_SOCKET_INFO', socketId, (error, objString) => {

			console.log("2:::: objString ::::: ", objString);

			if(objString == null){
				logger.log('warn', `[Sync Server : getUserId] socketId가 Redis (SESSION_USER_SOCKET_INFO)에 없음, socketId : ${socketId}`);
				resolved(null);
				return;
			}

			try {
				let parseObject = setObject(objString);
				let userId    = parseObject.ID;

				if(error){
					rejected(rejectCode);
				}else{
					logger.log('info', `[Sync Server : getUserId] ' ${socketId} '의 User Id 찾기 성공 : ${userId}`);
					resolved(userId);
				}
			} catch(err) {
				logger.log('error', '[Sync Server : getUserId] parseObject.ID를 찾을 수 없음 : ');
				console.log('userId 없음. ERROR!!!!');
			}

		});
	});
};

exports.getUserService = function(syncMaster, syncSlave, socketId){
	let service_type;
	return new Promise(function(resolved, rejected){
		syncSlave.HGET('SESSION_USER_SOCKET_INFO', socketId, function(error, objString){

			console.log("3:::: objString ::::: ", objString);

			if(objString == null){
				logger.log('warn', `[Sync Server : getUserService] socketId가 Redis (SESSION_USER_SOCKET_INFO)에 없음, socketId : ${socketId}`);
				rejected(null);
				return false;
			}

			try {
				let parseObject = setObject(objString);
				service_type    = parseObject.SERVICE_TYPE; // 이거 뭐야
				//console.log("@@@@@@@@@@@@@@@@@:이상해",service_type);
			} catch(err) {
				logger.log('error', `[Sync Server : getUserService] parseObject.SERVICE_TYPE을 찾을 수 없음 : ${JSON.stringify(parseObject)}`);
				console.log('서비스타입 없음. ERROR!!!!');
			}

			if(error){
				rejected(error);
			}else{
				logger.log('info', `[Sync Server : getUserService] ' ${socketId} '의 service_type 찾기 성공 : ${JSON.stringify(service_type)}`);
				resolved(service_type);
			}
		});
	});
};


//Sync서버에서 해당 방에 있는 회원리스트
exports.getUserList = function(syncMaster, syncSlave, roomId){
	return new Promise(function(resolved, rejected){
		syncSlave.HGET('ROOMS_INFO', roomId, function(error, obj){

			if(obj){
				try {
					let usersObj = setObject(obj).USERS;
					let userList = [];
					//let uid;
					//let uname;
					for(let key in usersObj){
						userList.push(key);
					}

                    userList.forEach(function(v, idx) {
                        userList[idx] = v.split('<#>')[0];
                    });

					resolved(userList);
					logger.log('info', `[Sync Server : getUserList] ROOMS_INFO에 ' ${roomId} '의 유저 목록. : ${userList}`);
				} catch (err) {
					rejected(rejectCode);
					logger.log('warn', '[Sync : getUserList] 방에 user가 없음.');
				}
			} else {
				logger.log('info', `[Sync Server : getUserList] ROOMS_INFO에 ' ${roomId} '은 유저 목록이 없음. '`);
				resolved('notExist');
			}
		})
	});
};

//Sync서버에서 해당 방에 있는 회원리스트
exports.getUserListIncludeGuest = function(syncMaster, syncSlave, roomId){
    return new Promise(function(resolved, rejected){
        syncSlave.HGET('ROOMS_INFO', roomId, function(error, obj){

            if (obj) {
                try {
                    let usersObj = setObject(obj).USERS;
                    let userList = [];

                    for (let key in usersObj) {
                        userList.push(key);
                    }

                    resolved(userList);
					logger.log('info', `[Sync Server : getUserList] ROOMS_INFO에 '${roomId} '의 유저 목록. : ${userList}`);
                } catch (err) {
                    logger.log('warn', '[Sync : getUserList] 방에 user가 없음.');
                }
            } else {
				logger.log('info', `[Sync Server : getUserList] ROOMS_INFO에 ' ${roomId} '은 유저 목록이 없음. `);
                resolved('notExist');
            }
        })
    });
};

//User 수
exports.getUserCount = function(syncMaster, syncSlave, roomId){
	return new Promise(function(resolved, rejected){
		syncSlave.HGET('ROOMS_INFO', roomId, function(error, roomObj){
			let rooms    = setObject(roomObj);
			let userList = rooms.USERS;
			let userListLength = Object.keys(userList).length;
			console.log("userList : ", userListLength);
			resolved(userListLength);
		});
	});
}

//해당룸에 있는 User을 삭제.
exports.deleteUser = function(syncMaster, syncSlave, roomId, userId){
	let deleteObj = this;
	console.log('roomId values ::: ', roomId, userId);
	return new Promise(function(resolved, rejected){
		syncSlave.HGET('ROOMS_INFO', roomId, function(error, obj){
			try {
				let roomObj  = setObject(obj);
				let userList = roomObj.USERS;
				delete userList[userId];

				console.log(userList);
				roomObj.USERS = userList;
				syncMaster.HSET('ROOMS_INFO', roomId, setString(roomObj), function(error, result){
					logger.log('info', `[Redis] deleteUser, delete success!', ${JSON.stringify(result)}`);
					resolved('deleteUser');
				});
			} catch (err) {
				logger.log('warn', '[Sync : deleteUser] 방에 user가 없음.');
			}

		});
	});
};

//disconection으로 인한 비정상적인 로그 아웃, 정상적인 로그아웃
exports.logOut = function(syncMaster, syncSlave, _socketId, _userId, _roomId){
	let userId = _userId;
	let roomId = _roomId;
	let socketId;
	let isDuplicated = false;
	let logoutObj = this;

	console.log("sync logout!!", _socketId, _userId, _roomId)
	return new Promise(function(resolved, rejected){
		if(userId){
			//정상적인 로그아웃 - 로그아웃 버튼을 누르고 로그아웃 한경우.
			syncSlave.HGET('SESSION_USER_ID_INFO', userId, function(error, idObj){
				try {
					let idObject = setObject(idObj);
					socketId = idObject.SOCKET_ID;
					roomId = idObject.ROOM_ID;
				} catch (err) {
					logger.log('warn', '[Sync : logOut] user의 SID, RoomId가 없음.');
				}
			});

			logoutObj.logoutProc(syncMaster, syncSlave, userId, _socketId, roomId, isDuplicated, resolved, rejected);

		}else{
            //disconnection에 의한 종료
			console.log("userId가 없는경우..", _socketId);

			syncSlave.HGET('SESSION_USER_SOCKET_INFO', _socketId, function(error, idObj){
				let idObject = setObject(idObj);
				if (idObject){
                    syncSlave.HGET('SESSION_USER_ID_INFO', idObject.ID, function(error, sObj) {
                        try {
                            let socketObject = setObject(sObj);
                            console.log('+ ivypark disconnect session :: ', _socketId, '  redis session : ', socketObject.SOCKET_ID);
                            console.log('########## duplicated check...........!', socketObject.SOCKET_ID, _socketId);
                            if (socketObject.SOCKET_ID && socketObject.SOCKET_ID !== _socketId) {
                                console.log('########## duplicated...........!');
                                logger.log('info', '이미 로그인 한 상태에서, 지니는 disconnect가 늦게 떨어질 가능성 있음. 예외처리.');
                                isDuplicated = true;
                                // return;
                            }
                        } catch (e) {
                        	logger.log('disconnection error, catch block', e);
                            console.log(e);
                        }

                        userId = idObject.ID;
                        roomId = idObject.ROOM_ID;
                        logoutObj.logoutProc(syncMaster, syncSlave, userId, _socketId, roomId, isDuplicated, resolved, rejected);
                    });
				}
			});
		}
	});
};

//로그아웃
exports.logoutProc = function(syncMaster, syncSlave, userId, socketId, roomId, isDuplicated, resolved, rejected){
	let logoutObj = this;
	let userList;
	let flag = 'false';

	if(roomId){

		//다자간일경우
        let redisInfo = {
            master: syncMaster,
            slave: syncSlave
        };

        logoutObj.getRoom(syncSlave, roomId).then(function(obj) {
			if(userId === obj.SCREEN.USERID){
				logoutObj.resetScreenShareFlag(redisInfo, userId, roomId, function(err){
					logger.log('info', `SessionReserve 관련 resetScreenShareFlag Error :  ${err} `);
				})					
				if ('file' === obj.SCREEN.FLAG){
					flag = 'file';
				} else if('true' === obj.SCREEN.FLAG){
					flag = 'true';
				};
			};
		});
							
		logoutObj.getUserList(syncMaster, syncSlave, roomId).then(
			function(userList){
				let userCount = userList.length;

				if (!isDuplicated) {
                    syncMaster.HDEL('SESSION_USER_ID_INFO', userId);
                    syncMaster.HDEL('SESSION_USER_SOCKET_INFO', socketId);
				}

				isYourSocket( syncMaster, syncSlave, userId, socketId, function( err, you ) {
					if ( err ) {
						console.log(err);
						//throw new Error( err )
					}

					if ( you ) {

						// syncMaster.HDEL('SESSION_USER_ID_INFO', userId, function() {
                            logoutObj.getRoomAdmin(syncSlave, roomId).then(function(admin) {
                                if (userCount <= 1 || userId === admin.id){
                                    syncMaster.HDEL('ROOMS_INFO', roomId, function(error, obj){
                                        let userIndex = userList.indexOf(userId);
                                        userList.splice(userIndex, 1);
                                        if(userList[0] === null || userList[0] === undefined){
                                            let data = {'logoutId' : userId, 'roomId' : roomId, 'userList' : userList, 'isEnded': true};
                                            resolved(data);
                                        }else{
                                            try {
                                                syncMaster.HGET('SESSION_USER_ID_INFO', userList[0], function(error, obj){
                                                    let objId = setObject(obj);
                                                    let leftUserSocketId;
                                                    try {
                                                        leftUserSocketId = objId.SOCKET_ID;
                                                        objId.ROOM_ID = '';

                                                        syncMaster.HSET('SESSION_USER_ID_INFO', userList[0], setString(objId));
                                                        syncMaster.HGET('SESSION_USER_SOCKET_INFO', leftUserSocketId, function(err, socketObj){
                                                            let objSocket = setObject(socketObj);
                                                            objSocket.ROOM_ID = '';
                                                            syncMaster.HSET('SESSION_USER_SOCKET_INFO', leftUserSocketId, setString(objSocket));
                                                            let data = {'logoutId' : userId, 'roomId' : roomId, 'userList' : userList, 'isEnded': true};
                                                            resolved(data);
                                                        });
													} catch (e) {
														logger.log('warn', 'logoutProc getRoomAdmin error');
                                                    }
                                                });
                                            } catch(err) {
                                                console.log('ivypark - catch - user is not exist - error.');
                                                logger.log('error', '[Sync Server : SESSION_USER_ID_INFO] ERROR');
                                            }
                                        }
                                    });
                                } else {
                                    syncSlave.HGET('ROOMS_INFO', roomId, function(error, obj){
                                        let roomObj  = setObject(obj);
                                        let userList = roomObj.USERS;
                                        let userListArr = Object.keys(userList);

                                        let _id = userListArr.some( el => el.indexOf('<#>') > -1 ) ? (userId + '<#>' + socketId) : userId;
                                        delete userList[_id];

                                        roomObj.USERS = userList;

                                        syncMaster.HSET('ROOMS_INFO', roomId, setString(roomObj), function(error, result){
											logger.log('info', `[Redis] deleteUser, delete success!', ${JSON.stringify(result)}`);
                                            let data = {'logoutId' : userId, 'roomId' : roomId, 'userList' : userList, 'isEnded': false};
                                            resolved(data);
                                        });

                                    });
                                }
							});
						// })
					} else {
                        logoutObj.getRoomAdmin(syncSlave, roomId).then(function(admin) {
                            if (userCount <= 1 || userId === admin.id) {
                                syncMaster.HDEL('ROOMS_INFO', roomId, function (error, obj) {
                                    let userIndex = userList.indexOf(userId);
                                    userList.splice(userIndex, 1);
                                    if (userList[0] == null || userList[0] === undefined) {
                                        let data = {'logoutId': userId, 'roomId': roomId, 'userList': userList, 'isEnded': true};
                                        resolved(data);
                                    } else {
                                        try {
                                            syncMaster.HGET('SESSION_USER_ID_INFO', userList[0], function (error, obj) {
                                            	try {
                                                    let objId = setObject(obj);
                                                    let leftUserSocketId = objId.SOCKET_ID;
                                                    objId.ROOM_ID = '';
                                                    syncMaster.HSET('SESSION_USER_ID_INFO', userList[0], setString(objId));
                                                    syncMaster.HGET('SESSION_USER_SOCKET_INFO', leftUserSocketId, function (err, socketObj) {
                                                        let objSocket = setObject(socketObj);
                                                        objSocket.ROOM_ID = '';
                                                        syncMaster.HSET('SESSION_USER_SOCKET_INFO', leftUserSocketId, setString(objSocket));
                                                        let data = {
                                                            'logoutId': userId,
                                                            'roomId': roomId,
                                                            'userList': userList,
                                                            'isEnded': true
                                                        };
                                                        resolved(data);
                                                    });
												} catch (e) {
													console.log('error!!!', e);
                                                }
                                            });
                                        } catch (err) {
                                            console.log('ivypark - catch - user is not exist - error.');
                                            logger.log('error', '[Sync Server : SESSION_USER_ID_INFO] ERROR');
                                        }
                                    }
                                });
                            } else {
                                syncSlave.HGET('ROOMS_INFO', roomId, function (error, obj) {
                                    let roomObj = setObject(obj);

                                    try {

                                        let userList = roomObj.USERS;
                                        let userListArr = Object.keys(userList);

                                        let _id = userListArr.some(el => el.indexOf('<#>') > -1) ? (userId + '<#>' + socketId) : userId;
                                        delete userList[_id];

                                        console.log(userList);
                                        roomObj.USERS = userList;

                                        syncMaster.HSET('ROOMS_INFO', roomId, setString(roomObj), function (error, result) {
											logger.log('info', `[Redis] deleteUser, delete success!', ${JSON.stringify(result)}`);
                                            let data = {'logoutId': userId, 'roomId': roomId, 'userList': userList, 'isEnded': false, 'flag' : flag};
                                            resolved(data);
                                        });
									} catch (e) {
										console.log('error!!!', e);
                                    }

                                });
                            }
                        });
					}

				})

				//방정보를 레디스에서 비워줄때 예외처리필요
			}
		);

	}else{
		//룸이 없는 상태에서 로그아웃 한경우.
		console.log("룸아이디 없음:::::", roomId, socketId, userId, isDuplicated); //  /SignalServer#8aBcG3RgjWEAvH7dAAAH ctest1
		if(userId && socketId){

            if (!isDuplicated) {
                syncMaster.HDEL('SESSION_USER_SOCKET_INFO', socketId);
            }

			/**
			 * 현재 연결되어 있는 소켓이 나의 소켓인지
			 * 다른 기기에서 연결을 시도한 소켓인지 체크해서
			 * 다른 기기에서 연결을 시도한 소켓이라면 DB에서 지우지 않고
			 * 현재 연결되어 있는 소켓이라면 DB에서 지움
			 */
			this.isYourSocket( syncMaster, syncSlave, userId, socketId, function( err, you ) {
				if ( err ) {
					throw new Error( err )
				}

				if ( you ) {

                    let data = {'logoutId' : userId, 'roomId' : roomId, 'userList' : userList};

                    if (!isDuplicated) {
                        syncMaster.HDEL('SESSION_USER_ID_INFO', userId, function (error, obj) {
                            resolved(data);
						});
                    } else {
                        resolved(data);
					}
				}
			})
		}

	}
};


//
function isYourSocket ( syncMaster, syncSlave, userId, socketId, cb ) {

	syncSlave.HGET( 'SESSION_USER_ID_INFO', userId, function( error, result ){

		if ( error || !result ) {
			cb( error, null );
			return;
		}
		// 내 소켓 ID
		try {

			let mine = JSON.parse( result ).SOCKET_ID;

			// 로그인 되어 있던 소켓 ID
			let yours = socketId;

			cb( null, mine === yours )

		} catch ( err ) {

            cb( err, null );
			logger.log('warn', '[Sync / Login Dupl check] There is NOT SOCKET_ID.');

		}

	});
}

exports.isYourSocket = isYourSocket;

//룸세팅
exports.setRoom = (syncMaster, syncSlave, roomId, serviceType, userId, userName, sessionId, reqDeviceType, targetId , initialRoomLength, userNumber) => {

	if(!targetId) targetId = '';
	console.log("rooms : ", roomId, serviceType, userId, sessionId, userName, reqDeviceType, userNumber);

	let roomList = {
		'SERVICE_TYPE'   : serviceType,
		'TARGET_ID'   	 : targetId,
		'MEDIA_PIPELINE' : '',   //Media서버를 위한 부분.
		'COMPOSE'        : '',  //Media서버를 위한 부분.
        'ADMIN'		     : {
		    'id': userId,
            'userNumber': userNumber
        }, // 180623 ivypark, 방장 개념 추가
		'USERS'          : {},
		'SCREEN'	     : { FLAG: false, USERID: null },
	};

	roomList.USERS[userId] = {
		'NAME'        : userName,
		'DEVICE_TYPE' : reqDeviceType,
		'JOINED' : 'join' // yet, join, reject, exit
	};

	if(initialRoomLength) roomList.initialRoomLength = initialRoomLength + 1;

	syncSlave.HGET('SESSION_USER_ID_INFO', userId, (error, idObj) => {
		let idObject = setObject(idObj);
		try {
			idObject.ROOM_ID = roomId;
		} catch(err) {
			logger.log('warn', '[Sync Server : setRoom] roomId 없음');
			console.log('RoomId가 없음. ERROR!!!!')
		}
		syncMaster.HSET('SESSION_USER_ID_INFO', userId, setString(idObject));
	});

	syncSlave.HGET('SESSION_USER_SOCKET_INFO', sessionId, (error, socketObj) => {
		console.log('SESSION_USER_SOCKET_INFO : socketObj  :: ', socketObj);
		let socketObject = setObject(socketObj);
		try {
			socketObject.ROOM_ID = roomId;
		} catch(err) {
			logger.log('warn', '[Sync Server : setRoom] roomId 없음');
			console.log('RoomId가 없음. ERROR!!!!')
		}
		syncMaster.HSET('SESSION_USER_SOCKET_INFO', sessionId, setString(socketObject));
	});

	syncMaster.HSET('ROOMS_INFO', roomId, setString(roomList));
	logger.log('info', `[Sync Server : setRoom] Room 저장 성공 : ${roomId}`);

};

//룸에 사용자 추가(eventOp : Join)
exports.enterRoom = (syncMaster, syncSlave, roomId, userId, userName, sessionId, deviceType, status) => {
	let enterObj = this;
	return new Promise((resolved, rejected) => {
		console.log('ivypark - enterRoom -> ', roomId, userId, userName, sessionId, status);
		if (status !== 'reject') {
			if (status !== 'guest') {
                syncSlave.HGET('SESSION_USER_ID_INFO', userId, (error, idObj) => {
                    try {
                    	console.log('enterroom - idObj', idObj);
						let idObject = setObject(idObj);
						idObject.ROOM_ID = roomId;
						syncMaster.HSET('SESSION_USER_ID_INFO', userId, setString(idObject));
                    } catch(err) {
                        logger.log('warn', '[Sync / enterRoom] EnterRoom 시 id info에 roomID 들어가지 않는 현상. 확인 필요...... fix되면 삭제');
                    }
                });

                syncSlave.HGET('SESSION_USER_SOCKET_INFO', sessionId, (error, socketObj) => {
                    let socketObject = setObject(socketObj);
                    try {
                        console.log('enterroom - SESSION_USER_SOCKET_INFO', socketObj);
                        socketObject.ID = userId;
                        socketObject.ROOM_ID = roomId;
                        syncMaster.HSET('SESSION_USER_SOCKET_INFO', sessionId, setString(socketObject));
                    } catch(err) {
                        logger.log('warn', '[Sync / enterRoom] 495 error.....')
                    }
                });
            } else {
                let socketIdData = {'ID': userId, 'ROOM_ID': roomId};
                syncMaster.HSET('SESSION_USER_SOCKET_INFO', sessionId, setString(socketIdData));
            }

			syncSlave.HGET('ROOMS_INFO', roomId, (error, obj) => {
				if(obj){
					let roomObj = setObject(obj);
					let roomJsonObj;

					console.log('sync roomObj :: ', roomObj);
					if (status === 'guest') {
					    userId = userId + '<#>' + sessionId;
                    }

					roomObj.USERS[userId] = {
						'NAME' : userName,
						'DEVICE_TYPE' : deviceType,
						'JOINED': 'yet' // yet, join, reject, exit
					};

					if(deviceType){
						roomObj.USERS[userId].DEVICE_TYPE = deviceType;
					}

					roomJsonObj = setString(roomObj);
					syncMaster.HSET('ROOMS_INFO', roomId, roomJsonObj, () => {
					    let roomInfo = {
					    	userList: [],
							admin: {}
						};

                        roomInfo.userList = Object.keys(roomObj.USERS);
                        roomInfo.admin = roomObj.ADMIN;
                        resolved(roomInfo);
					});
				} else {
					rejected('error : ' + error);
				}
			})
		} else {
            console.log('ivypark - enterRoom -> status : ', status);
			enterObj.getUserList(syncMaster, syncSlave, roomId).then(
				function(userList){
					console.log("userList : ", userList);
					resolved(userList);
				}
			);
		}
	});
};

exports.setJoinFlag = function (syncMaster, syncSlave, roomId, userId, flag) {
	return new Promise(function (resolve, reject) {
		switch (flag) {
			case 'yet':
			case 'join':
			case 'exit':
			case 'reject':
				if ( !roomId ) {
					resolve( null );
					return;
				}

				syncSlave.HGET('ROOMS_INFO', roomId, function(error, obj){
					let objectRoom = setObject(obj);
					if (obj) {
						objectRoom.USERS[userId].JOINED = 'join';
						syncMaster.HSET('ROOMS_INFO', roomId, setString(objectRoom), function() {
							resolve();
						});
					} else {
						reject(rejectCode);
					}
				});
				break;

			default:
				reject(rejectCode);
				break;
		}
	});
};

//roomId 이용하여 Room 정보 가져오기
exports.getRoom = function(syncSlave, roomId){
	let _self = this;
	return new Promise(function(resolved, rejected){
		if( !roomId ) {
			resolved( null );
			return;
		}

		syncSlave.HGET('ROOMS_INFO', roomId, function(error, obj){
			let objectRoom = setObject(obj);
			if(obj){

                _self.getUserList('', syncSlave, roomId).then(
                    function(userList){
                        userList.forEach(function(v, idx) {
                            userList[idx] = v.split('<#>')[0];
                        });

                        objectRoom.USERS = userList;
                        resolved(objectRoom);
                    }
                );
			}else{
				rejected(rejectCode);
			}
		});
	});
};

exports.getRoomAdmin = function(syncSlave, roomId) {
    return new Promise(function(resolved, rejected) {
        syncSlave.HGET('ROOMS_INFO', roomId, function (error, obj) {
        	let _r;
        	if (obj) {
                try {
                    _r = setObject(obj).ADMIN;
                } catch (err) {
                    resolved(_r);
                }
            }

            resolved(_r);
        });
    });
};

exports.setMultiType = function(syncMaster,syncSlave,roomId){
	//console.log(roomId);
	return new Promise(function(resolved, rejected){
		syncSlave.HGET('ROOMS_INFO', roomId, function(error, obj){
			let objectRoom = setObject(obj);

			if ( !objectRoom  ) {
				resolved('no data in redis');
			} else {
				try {
					objectRoom.SERVICE_TYPE = 'multi';
					if( objectRoom.MULTITYPE === 'Y' ) {
						objectRoom.MULTITYPE = "Y"
					} else {
						if(Object.keys(objectRoom.USERS).length >= 2 ) {
							objectRoom.SERVICE_TYPE = 'Y';
						}

						if(Object.keys(objectRoom.USERS).length >= 2 ) {
							objectRoom.MULTITYPE = "Y";
						} else {
							objectRoom.MULTITYPE = "N";
						}
					}

					syncMaster.HSET('ROOMS_INFO', roomId, setString(objectRoom));
					resolved(objectRoom);
					logger.log('info', `[Sync Server : setMultiType] 다자간 변경 성공 : ', ${roomId}`);
				} catch (e) {
					rejected(rejectCode);
					logger.log('warn', `[Sync Server : setMultiType] 다자간 변경 실패 : ', ${roomId}`);
				}
			}
		});
	});
};

exports.getParticipants = function(syncMaster,syncSlave,roomId){
	//console.log(roomId);
	return new Promise(function(resolved, rejected){
		syncSlave.HGET('ROOMS_INFO', roomId, function(error, obj){
			let objectRoom = setObject(obj);

			if ( !objectRoom  ) {
				resolved('no data in redis');
			} else {
				try {
					resolved(objectRoom);
				} catch (e) {
					rejected(e);
				}
			}
		});
	});
};

exports.changeMultiType = function (syncMaster, syncSlave, roomId) {
	return new Promise(function (resolved, rejected) {
		syncSlave.HGET('ROOMS_INFO', roomId, function (error, obj) {
			let objRoom = setObject(obj);
			if (!objRoom) {
				resolve('Not data change in redis');
			} else {
				try {
					objRoom.SERVICE_TYPE = "multi";
					if (objRoom.MULTITYPE === "Y") {
						objRoom.MULTITYPE = "N"
					} else {
						console.log(" NOT changeMultiType");
					}
					syncMaster.HSET('ROOMS_INFO', roomId, setString(objRoom));
					resolved(objRoom);
					logger.log('info', `[Sync Server : changeMultiType ] Y -> N 으로 변경 성공 : ', ${roomId} , ${objRoom.MULTITYPE}`);
				} catch (e) {
					rejected(rejectCode);
					logger.log('warn', `[Sync Server : setMultiType] Y -> N 으로 변경 실패 : ', ${roomId} , ${objRoom.MULTITYPE}`);
				}
			}
		});
	});
}

exports.getMultiType = function(syncMaster, syncSlave, roomId) {
    return new Promise(function(resolved, rejected){
        syncSlave.HGET('ROOMS_INFO', roomId, function(error, obj){
        	try {
                let objectRoom = setObject(obj);

                if (obj) {
                    resolved(objectRoom.MULTITYPE);
                } else {
                    rejected();
                }
			} catch (e) {
        		console.log('ROOMS_INFO 데이터 없음.');
            }
        });
    });
};

exports.setShareSettings = function(syncMaster, syncSlave, roomId, isHWAcceleration, isRTPShare) {
	syncSlave.HGET('ROOMS_INFO', roomId, function(error, obj){
		try {
			let objectRoom = setObject(obj);

			if (obj) {
                objectRoom.isRTPShare = !!isRTPShare;
				objectRoom.isHWAcceleration = !!isHWAcceleration;
				console.log(objectRoom);
				syncMaster.HSET('ROOMS_INFO', roomId, setString(objectRoom));
			} else {
				console.log('ROOMS_INFO 데이터 넣는 중 에러 발생');
			}
		} catch (e) {
			console.log('ROOMS_INFO 데이터 없음.');
		}
	});
};

//룸아이디 초기화.
exports.setUsersRoomId = function(syncMaster, syncSlave, userId, socketId){
	return new Promise(function(resolved, rejected){
		syncSlave.HGET('SESSION_USER_ID_INFO', userId, function(error, idObj){
			
			try {

                let idObject = setObject(idObj);
                console.log(idObject);

                idObject.ROOM_ID = '';

                syncMaster.HSET('SESSION_USER_ID_INFO', userId, setString(idObject));
                console.log('+++ ExitRoom -> ', userId, '의 ROOM_ID 삭제 성공. +++');
				logger.log('info', `[Sync Server : setUsersRoomId] SESSION_USER_ID_INFO에 '  ${userId}  ' 삭제 성공 : ', ${userId}`);

			} catch (e) {

				console.log(e);

            }
			
		});

		syncSlave.HGET('SESSION_USER_SOCKET_INFO', socketId, function(error, socketObj){
			let socketObject = setObject(socketObj);
			try {
				socketObject.ROOM_ID = '';
				syncMaster.HSET('SESSION_USER_SOCKET_INFO', socketId, setString(socketObject));

                console.log('+++ ExitRoom -> SESSION_USER_SOCKET_INFO ---> ', socketId, '의 ROOM_ID 삭제 성공. +++', socketObject);
				logger.log('info', `[Sync Server : setUsersRoomId] SESSION_USER_SOCKET_INFO ' ${socketId} ' 삭제 성공 : ', ${userId}`);
				resolved('roomIdClear');
			} catch (err) {
				console.log('ROOM_ID 이미 지워짐. 예외처리');
				logger.log('info', 'ROOM_ID 이미 지워짐. 예외처리');
				return;
			}
		});

	});
};

//sessionId로 roomId 가져오기
exports.getRoomId3 = (syncMaster, syncSlave, sessionId) => {
	console.log("getRoomId3 Function!!");
	return new Promise((resolved, rejected) => {
		syncSlave.HGET('SESSION_USER_SOCKET_INFO', sessionId, (error, idObj) => {
			try {
				let idObject = setObject(idObj);
				console.log(idObject);
				resolved(idObject.ROOM_ID);
				logger.log('info', `[Sync Server : getRoomId3] ' ${sessionId} '로 SESSION_USER_SOCKET_INFO Room id 찾기 성공', ${idObject.ROOM_ID}`);
			} catch (err) {
				rejected(rejectCode);
				logger.log('warn', '[Sync Server : getRoomId3] there is NOT room id. catch', 'catch');
			}
		});
	});
}

//userId로 roomId 가져오기
exports.getRoomId4 = (syncMaster, syncSlave, userId) => {
	console.log("getRoomId4 Function!!");
	return new Promise((resolved, rejected) => {
		syncSlave.HGET('SESSION_USER_ID_INFO', userId, (error, idObj) => {
			try {
				let idObject = setObject(idObj);
				console.log(idObject);
				resolved(idObject.ROOM_ID);
				logger.log('info', `[Sync Server : getRoomId4] ' ${userId} '로 SESSION_USER_ID_INFO Room id 찾기 성공', ${idObject.ROOM_ID}`);
			} catch (err) {
				resolved(null);
				logger.log('warn', '[Sync Server : getRoomId4] there is NOT room id. catch', 'catch');
			}
		});
	});
}

//룸삭제
exports.deleteRoom = function(syncMaster, syncSlave, roomId){
	return new Promise(function(resolved, rejected){

			console.log('deleteRoom  ! ', roomId);
		syncMaster.HDEL('ROOMS_INFO', roomId, function(error, obj){
			logger.log('info', `[Redis] deleteRoom, delete success ${JSON.stringify(obj)}`);
			resolved(obj);
		});
	});
};

//invite User 추가
exports.inviteUsers = function(syncMaster, syncSlave, callUser, receiveUser){
	let inviteObj = this;
	console.log("inviteUser : ", callUser, receiveUser);
	inviteObj.getInviteReceiveUser(syncSlave, callUser).then(
		function(_receiveUser){
			let userList = new Array(receiveUser);
			syncMaster.HSET('INVITE_USER', callUser, setString(userList));
		}
	)

};

//invite user삭제.
exports.deleteInvite = function(syncMaster, caller){
	console.log("caller : ", caller);
	syncMaster.HDEL('INVITE_USER', caller);
};

//초대받은 사람 검색
exports.getInviteReceiveUser = function(syncSlave, callUser){
	console.log("getInviteusers", callUser)
	return new Promise(function(resolved){
		syncSlave.HGET('INVITE_USER', callUser, function(error, obj){
			let receiveUser = setObject(obj);
			console.log("receiveuser : ", receiveUser);
			resolved(receiveUser);
		});
	});
}

exports.isInviteUser = function(syncSlave, userId){
	return new Promise(function(resolved){
		console.log("isInviteUser Fuuc : ", userId);
		syncSlave.HGETALL('inviteUser', function(error, obj){
			let isUser = false;
			let inUser;
			console.log("inviteUser obj : ", obj);

			for(var key in obj){
				inUser = setObject(obj[key]);
				for(var ukey in inUser){
					if(userId == inUser[ukey]){
						isUser = true;
					}
				}
			}
			resolved(isUser);
		});
	});
};

exports.inviteTargetIdCheck = function(syncMaster, syncSlave, roomId, _targetId, token) {
	// 18.03.15 ivypark // inviteTargetIdCheck ++ // @param token -> 'add', 'delete', 'check'
	// if @param token is 'add' :
	// ; ROOMS_INFO { TARGET_ID } <- ADD USER
	// if @param token is 'delete' :
	// ; ROOMS_INFO { TARGET_ID } <- DELETE USER
	// if @param token is 'check' :
	// ; ROOMS_INFO { TARGET_ID } <- LENGTH CHECK / ADD USER (INVITE)

	// let targetId = _targetId;
	// let roomId = _roomId
	//
	// console.log('tar : ', targetId, roomId);
	//
	// return new Promise(function(resolved, rejected){
	// 	syncSlave.HGET('ROOMS_INFO', roomId, function(error, roomObj){
	// 		let rooms = setObject(roomObj);
	// 		console.log('rooms ::: ', rooms);
	// 		let roomTargetIds;
	//
	// 		try {
	// 			roomTargetIds = rooms.TARGET_ID;
	// 			let result;
	//
	// 			console.log('roomTargetIds 이전 : ', roomTargetIds);
	//
	// 			switch (token) {
	//
	// 				case 'add' :
	//
	// 					if(roomTargetIds.indexOf(targetId) > -1) {
	// 						result = 'duplicate';
	// 					} else {
	// 						console.log(targetId);
	// 						roomTargetIds = roomTargetIds.concat(targetId);
	// 						result = 'success';
	//
	// 						rooms.TARGET_ID = roomTargetIds;
	// 						syncMaster.HSET('ROOMS_INFO', roomId, setString(rooms));
	// 					}
	//
	// 					console.log('roomTargetIds 추가 후 : ', roomTargetIds);
	//
	// 					break;
	//
	// 				case 'delete' :
	//
	// 					let roomTargetIdIndex = roomTargetIds.indexOf(targetId);
	// 					if(roomTargetIdIndex > -1) {
	// 						result = 'success';
	// 						roomTargetIds.splice(roomTargetIdIndex, 1);
	//
	// 						rooms.TARGET_ID = roomTargetIds;
	// 						syncMaster.HSET('ROOMS_INFO', roomId, setString(rooms));
	// 					} else {
	// 						result = 'notExist';
	// 					}
	//
	// 					console.log('roomTargetIds 삭제 후 : ', roomTargetIds);
	//
	// 					break;
	//
	// 				case 'check' :
	//
	// 					if(targetId.length > 1) {
	// 						console.log('1');
	// 						// roomTargetIds = roomTargetIds.concat(targetId).reduce(function(a,b){
	// 						// 	if (a.indexOf(b) < 0 ) a.push(b);
	// 						// 	return a;
	// 						// },[]);
	// 						//
	// 						// rooms.TARGET_ID = roomTargetIds;
	// 						// syncMaster.HSET('ROOMS_INFO', roomId, setString(rooms));
	//
	// 						// 기회가 된다면 위와 같이 처리.. 현재는 targetId가 2가 한번 넘어가면 무조건 다자간이어서 관리할 필요가 없음..
	// 						// 고도화 하실때 참고하세요. ^^
	// 						resolved('pass');
	// 					} else {
	// 						console.log('2');
	//
	// 						if(roomTargetIds.indexOf(targetId) > -1) {
	// 							result = 'duplicate';
	// 						} else {
	// 							roomTargetIds = roomTargetIds.concat(targetId);
	//
	// 							// 한번 다자간으로 진입했으면 P2P로는 다시 갈 수 없음.
	// 							// (예외 처리 필요)
	// 							if(rooms.MULTITYPE === 'N') {
	// 								// important, 여기서 다자간과 P2P가 갈림
	// 								result = (roomTargetIds.length <= 1) ? 'N' : 'Y';
	//
	// 								rooms.MULTITYPE = result;
	// 								rooms.TARGET_ID = roomTargetIds;
	// 								syncMaster.HSET('ROOMS_INFO', roomId, setString(rooms));
	// 							}
	// 						}
	// 					}
	//
	// 					break;
	// 			}
	//
	// 			if(result === undefined) { rejected('error'); }
	// 			resolved(result);
	//
	// 		} catch (err) {
	// 			console.log('error :: ', err);
	// 			rejected('error');
	// 		}
	//
	// 	});
	// });
}

exports.getRoomMedia = function(syncMaster, syncSlave, roomId){
	return new Promise(function(resolved, rejected){
		syncSlave.HGET('ROOMS_INFO', roomId, function(error, roomObj){
			let rooms    = setObject(roomObj);
			resolved(rooms);
		});
	});
}

exports.getUserInfo = function(syncMaster, syncSlave, userId){
	return new Promise(function(resolved, rejected){
		syncSlave.HGET('SESSION_USER_ID_INFO', userId, function(error, userObj){
			if (!userObj) rejected(rejectCode);
			let user = setObject(userObj);
			resolved(user);
		});
	});
}

exports.getUserSocketInfo = function(syncMaster, syncSlave, sessionId){
    return new Promise(function(resolved, rejected){
        syncSlave.HGET('SESSION_USER_SOCKET_INFO', sessionId, function(error, userObj){
            let user = setObject(userObj);
            resolved(user);
        });
    });
}

exports.setRoomMedia = function(syncMaster, syncSlave, roomId , compose , mediapipeline){
	return new Promise(function(resolved, rejected){
		syncSlave.HGET('ROOMS_INFO', roomId, function(error, roomObj){
			let rooms    = setObject(roomObj);
			rooms.MEDIA_PIPELINE = mediapipeline;
			rooms.COMPOSE = compose;
			console.log(rooms);
			syncMaster.HSET('ROOMS_INFO', roomId, rooms);
			resolved("pipeline,compose saved");
		});
	});
}

exports.setRoomService = function(syncMaster, syncSlave, roomId , userId){
	return new Promise(function(resolved, rejected){
		syncSlave.HGET('ROOMS_INFO', roomId, function(error, roomObj){
			let rooms    = setObject(roomObj);
			rooms.USERS[userId] = {
				//userId     : userId,
				'NAME' : '',
				'DEVICE_TYPE' : ''
			};
			syncMaster.HSET('ROOMS_INFO', roomId, setString(rooms));

			let usersObj = rooms.USERS;
			let userList = [];
			//let uid;
			//let uname;
			for(let key in usersObj){
				userList.push(key);
			}

			resolved(userList);
		});
	});
}

exports.getRoomService = function(syncMaster , syncSlave, roomId){
	//console.log("룸서비수",roomId);
	return new Promise(function(resolved, rejected){
		syncSlave.HGET('ROOMS_INFO', roomId, function(error, obj){
			let objectRoom = setObject(obj);
			if(obj){
				resolved(objectRoom);
				logger.log('info', `[Sync Server : getRoomService] ROOMS_INFO 찾기 성공, ${roomId}`);
			}else{
				rejected();
				logger.log('info', `[Sync Server : getRoomService] ROOMS_INFO 찾기 실패, ${roomId}`);
			}
		});
	});
};

exports.setLocalShareUser = function( redisInfo, userId, sessionId, roomId, cb ) {

	let roomInfo = {
		// 'TYPE': 'Local',
		'MAKER': sessionId,
		'USER': {}
	};

	roomInfo.USER[sessionId] = {
		'ID': userId
    };

    redisInfo.master.HSET( 'ROOMS_INFO', roomId, setString( roomInfo ), function( err, res ) {

        let idInfo = {
            'ID': userId,
            'LOCAL_SHARE_ROOM': roomId
        };

        redisInfo.master.HSET( 'SESSION_USER_SOCKET_INFO', sessionId, setString( idInfo ), function( err, res ) {
            cb();
        });
    });
};

exports.deleteLocalShareUser = function( redisInfo, sessionId ) {

    try {
        redisInfo.master.HDEL( 'SESSION_USER_SOCKET_INFO', sessionId );
    } catch( err ) {
        logger.log('warn', 'getLocalShareUser err');
    }
};

exports.addLocalShareRoom = function( redisInfo, userId, sessionId, roomId, cb ) {

    try {
        redisInfo.slave.HGET( 'ROOMS_INFO', roomId, function( err, obj ) {
            let result = JSON.parse( obj );

            result.USER[sessionId] = {
                'ID': userId
            };

            redisInfo.master.HSET( 'ROOMS_INFO', roomId, setString( result ), function( err, res ) {
                cb();
			});
        });
    } catch( err ) {
        logger.log('warn', 'getLocalShareRoom err');
    }

};

exports.deleteLocalShareRoom = function( redisInfo, roomId ) {

    try {
        redisInfo.master.HDEL( 'ROOMS_INFO', roomId );
    } catch( err ) {
        logger.log('warn', 'deleteLocalShareRoom err');
    }

};

exports.getLocalShareRoom = function( redisInfo, roomId, cb ) {

    try {
        redisInfo.slave.HGET( 'ROOMS_INFO', roomId, function( err, obj ) {
            let result = JSON.parse( obj );
            console.log('getLocalShareRoom result :', result);
            cb(result);
        });
    } catch( err ) {
    	console.log('getLocalShareRoom roomId 없음.')
        logger.log('warn', 'getLocalShareRoom err');
    	cb(null);
    }

};

exports.isLocalScreenShare = function( redisInfo, sessionId, roomId, cb ) {
    if ( typeof cb !== 'function') return;

    redisInfo.slave.HGET( 'SESSION_USER_SOCKET_INFO', sessionId, function( err, obj ) {

        if ( err ) {
            console.log( err );
            return;
        }

        let result;

        try {
            result = JSON.parse( obj );
		} catch(err) {
        	logger.log('error', err);
		}

        let localShareRoom;

        try {
            if ( !result.LOCAL_SHARE_ROOM ) {
                logger.log('info', 'LOCAL_SHARE_USER 없을 수 있음.');
                result.LOCAL_SHARE_ROOM = roomId;
            } else {
                localShareRoom = result.LOCAL_SHARE_ROOM;
                console.log('이미 공유중인 사람 있을 때.. roomId 변경 완료 -> : ', localShareRoom);
                result.LOCAL_SHARE_ROOM = roomId;
            }
		} catch(err) {
        	logger.log('error', err);
		}

        redisInfo.master.HSET( 'SESSION_USER_SOCKET_INFO', sessionId, setString( result ), function( err, res ) {
            if ( localShareRoom ) {
                cb( localShareRoom );
            } else {
                cb( null );
            }
        });

    })

};

exports.resetLocalScreenShare = function( redisInfo, sessionId, cb ) {
    if ( typeof cb !== 'function') return;

    if ( !sessionId ) {
        logger.log('error', 'resetLocalScreenShare sessionId 없음.');
        return;
    }

    redisInfo.slave.HGET( 'SESSION_USER_SOCKET_INFO', sessionId, function( err, obj ) {

        if ( err ) {
            console.log( err );
            return;
        }

        try {
            let result = JSON.parse( obj );
            result.LOCAL_SHARE_ROOM = null;

            redisInfo.master.HSET( 'SESSION_USER_SOCKET_INFO', sessionId, setString( result ), function( err, res ) {
				cb( null );
            });

            return;
        } catch (err) {
            // console.log('resetLocalScreenShare error 발생.', err);
            // logger.log('error', 'resetLocalScreenShare error 발생.', err);
            logger.log('error', 'SESSION_USER_SOCKET_INFO에 LOCAL_SHARE_ROOM이 없지만 지우려 함.');
        }

    })
};

exports.isScreenSharePossible = function( reidInfo, roomId, userId, callback ) {
	if ( typeof callback !== 'function') return;

    if ( !roomId ) {
        logger.log('error', 'isScreenSharePossible roomid 없음.');
        callback('error');
        return;
    }

	reidInfo.slave.HGET( 'ROOMS_INFO', roomId, function( err, obj ) {

		if ( err ) {
			console.log( err )
			return
		}

		let result = JSON.parse( obj )

		try {

            if ( result.SCREEN.USERID && result.SCREEN.USERID === userId ) {
                callback( true )
                return;
            }

            if (typeof result.SCREEN.FLAG !== 'boolean' && result.SCREEN.FLAG === 'file') {
                callback('file');
                return;
            }

            if ( !result.SCREEN.FLAG ) {
                callback( true )
                return
            }

		} catch (e) {

			console.log('1210, ', e);
            callback( 'error' );
            return false;

        }


		callback( false )
		return;

	})

}

// exports.initScreenShareFlag = function( reidInfo, roomId, callback ) {
// 	if ( typeof callback !== 'function') return;
// 	let setData = {
// 		flag: {
// 			on: false,
// 			userId: null
// 		}
// 	}

// 	reidInfo.master.HSET( 'SCREEN_SHARE_INFO', roomId, setString( setData ), function( err, res ) {
// 		if ( err ) {
// 			callback( err )
// 			return;
// 		}
// 		callback( null )
// 	})
// }

exports.setScreenShareFlag = function( reidInfo, roomId, userId, callback ) {
	if ( typeof callback !== 'function') return;

	reidInfo.slave.HGET( 'ROOMS_INFO', roomId, function( err, obj ) {
		if ( err ) {
			console.log( err )
			return
		}

		let result = JSON.parse( obj )

		let multitype = result.MULTITYPE;

		result.SCREEN.FLAG   = true
		result.SCREEN.USERID = userId

		reidInfo.master.HSET( 'ROOMS_INFO', roomId, setString( result ), function( err, res ) {
			if ( err ) {
				callback( err, null )
				return;
			}
			callback( null, multitype );
		})

	})

}

exports.resetScreenShareFlag = function( reidInfo, userId, roomId, callback ) {
	if ( typeof callback !== 'function') return;

	if ( !roomId ) {
		logger.log('error', 'resetScreenShareFlag roomid 없음.');
		callback('error');
        return;
    }

	reidInfo.slave.HGET( 'ROOMS_INFO', roomId, function( err, obj ) {
		if ( err ) {
			console.log( err )
			return
		}

		let result = JSON.parse( obj )

		try {
			if (userId === result.SCREEN.USERID) {
				result.SCREEN.FLAG   = false;
				result.SCREEN.USERID = null;
				result.FILE_LIST = null;
				result.FILE_INDEX = null;

				reidInfo.master.HSET( 'ROOMS_INFO', roomId, setString( result ), function( err, res ) {
					if ( err ) {
						callback( err )
						return;
					}
					callback( null )
				})
			} else {
				callback('user error');
			}
        } catch (e) {
			console.log(e);
			logger.log('error', 'resetScreenShareFlag error');
        }
	})
}

//exports.

exports.setFileList = function(redisInfo, roomId, fileList, cb) {
	if (typeof cb !== 'function') {
		logger.log('error', `setFileList: callback is not function`);
		return;
	}

	console.log(`setFileList 11 ---> ${roomId} `);
    redisInfo.slave.HGET('ROOMS_INFO', roomId, function(err, obj) {

    	try {
			let result = JSON.parse( obj );

			console.log(`setFileList  222 ---> ${obj}, ${result}, ${fileList} `);

			result.FILE_LIST = fileList;
			result.SCREEN.FLAG = 'file';

			redisInfo.master.HSET('ROOMS_INFO', roomId, setString(result), function() {
				cb();
			});
		} catch (e) {
			logger.log('warn', `setFileList: room is not exist`);
		}

	});
};

exports.getFileShare = function(redisInfo, roomId, cb) {
    if (typeof cb !== 'function') {
        logger.log('error', `getFileShare: callback is not function`);
        return;
    }

    redisInfo.slave.HGET('ROOMS_INFO', roomId, function(err, obj) {

        let result = JSON.parse( obj );

        if (!result.SCREEN.FLAG || result.SCREEN.FLAG !== 'file' || !result.FILE_LIST) {
            logger.log('error', `getFileShare: not being file share`);
        	cb(null);
		}

        let form = {
        	fileInfoList: result.FILE_LIST,
			fileUrl: result.FILE_INDEX,
			userId: result.SCREEN.USERID
		};

        cb(form);
    });
};

exports.setFileIndex = function(redisInfo, roomId, fileUrl, cb) {
    if (typeof cb !== 'function') {
        logger.log('error', `setFileIndex: callback is not function`);
        return;
    }

    redisInfo.slave.HGET('ROOMS_INFO', roomId, function(err, obj) {

        let result = JSON.parse( obj );
        result.FILE_INDEX = fileUrl;

        redisInfo.master.HSET('ROOMS_INFO', roomId, setString(result), function() {
            cb();
        });
    });
};

exports.msgManager = {
	name : {
		tableName : 'MESSAGE_INFO'
	},

	key : function(userId, reqNo) {
		return (userId + '-' + reqNo);
	},

	save : function(syncMaster, syncSlave, data, reqNo, sessionId, pid, isGuest) {
		let el = this;
		let roomId = data.roomId;
		let userId = data.userId;
		let tableKey = reqNo;

		console.log('save ---> ', data, isGuest);
		return new Promise(function(resolved, rejected){
			if(!userId) {
				syncSlave.HGET('SESSION_USER_SOCKET_INFO', sessionId, function(error, objString){

					if(objString == null){
						return;
					}

					try {
						let parseObject = setObject(objString);
						userId = parseObject.ID;
					} catch(err) {
						console.log(err);
						console.log('userId 없음. ERROR!!!!');
					}

					console.log(tableKey);

					const date = new Date();
					const newDate = date.toFormat('YYYYMMDDHH24MISS');

					let msgData = {
						'REQ_OP_NAME'	: data.eventOp,
						'REQ_NO'		: data.reqNo,
						'REQ_USER_ID'	: userId,
						'REQ_TIME'		: newDate,
						'ROOM_ID'		: roomId,
						'RESULT_STATUS' : 'N',
						'PID'			: pid
					};

					msgData.RESULT_STATUS = 'N';
					syncMaster.HSET(el.name.tableName, tableKey, setString(msgData));
					resolved();
				});
			} else {

				console.log('there is userId ', tableKey);

				const date = new Date();
				const newDate = date.toFormat('YYYYMMDDHH24MISS');

				let msgData = {
					'REQ_OP_NAME'	: data.eventOp,
					'REQ_NO'		: data.reqNo,
					'REQ_USER_ID'	: userId,
					'REQ_TIME'		: newDate,
					'ROOM_ID'		: roomId,
					'RESULT_STATUS' : 'N',
					'PID'			: pid
				};

				if (data.eventOp === 'GuestJoin') {
					msgData.ISGUEST = isGuest;
					msgData.SESSION_ID = sessionId;
				}

				msgData.RESULT_STATUS = 'N';
				syncMaster.HSET(el.name.tableName, tableKey, setString(msgData));
				resolved();
			}
		});

	},

	load : function(syncMaster, syncSlave, data, sessionId, _pid) {
		let reqNo = data.reqNo;
		let roomId = data.roomId;
		let userId = data.userId;
		let tableKey = reqNo;
		let pid = _pid;

		//console.log('4. LOAD, REQNO, USERID', reqNo, userId, sessionId);

		let msgManager = this;

		return new Promise(function(resolved, rejected){

			// 시작
			try {
				console.log('# reqNo -> ', tableKey);
				syncSlave.HGET(msgManager.name.tableName, tableKey, function(error, objString){
					if(!objString) {
						console.log(' tableKey에 해당하는 내용이 없음 : ', tableKey);
						return;
					}

					let msgData = JSON.parse(objString);
					try {
						// if(msgData.PID === pid) {
							// 내용이 맞고 'Result Status'가 N이 맞다면,
							console.log('RESULT_STATUS ----> ', msgData.RESULT_STATUS, tableKey);
							if(msgData.RESULT_STATUS === 'N') {
								// 해당 내용을 변경한다.
								 // Result Status를 Y로 변경한다.
								msgData.RESULT_STATUS = 'Y';

								// 해당 내용을 덮어 쓴다.
								syncMaster.HSET(msgManager.name.tableName, tableKey, setString(msgData));

								console.log('save, msgData : ', msgData);
								// 내용에 적힌 Resp 내용을 해당 유저에게 전달한다. (signalServer로 리턴)
								let _d = {
									'eventOp'		: msgData.REQ_OP_NAME,
									'reqNo'			: msgData.REQ_NO,
									'roomId'		: msgData.ROOM_ID,
									'resultStatus'	: msgData.RESULT_STATUS,
									'userId': msgData.REQ_USER_ID
								};

								if (_d.eventOp === 'GuestJoin') {
								    _d.isGuest = msgData.ISGUEST;
									_d.userId = msgData.REQ_USER_ID;
                                    _d.sessionId = msgData.SESSION_ID;
								}

								resolved(_d);
							} else {
                                let _d = {
                                    'eventOp'		: msgData.REQ_OP_NAME,
                                    'reqNo'			: msgData.REQ_NO,
                                    'roomId'		: msgData.ROOM_ID,
                                    'resultStatus'	: msgData.RESULT_STATUS,
									'userId': msgData.REQ_USER_ID,
                                    'complete' : 'Y'
                                };

                                if (_d.eventOp === 'GuestJoin') {
                                    _d.isGuest = msgData.ISGUEST;
                                    _d.userId = msgData.REQ_USER_ID;
                                    _d.sessionId = msgData.SESSION_ID;

                                    resolved(_d);
                                }
                            }
						// }
					} catch (err) {
						logger.log('info', 'MSG Timeout 에러 발생. 예외처리 완료.');
					}

				});
			} catch(err) {
				console.log('ERROR ::: 잘못된 TableKey 호출 ::: tableKey : ', tableKey);
			}
		});
	}
}

//console.log('# ivypark MSG sync 750 - tablekey is : ', tableKey);
// syncSlave.HGETALL(this.name.tableName, function(error, obj){
// 	let o;
//
// 	console.log('# ivypark MSG sync 754 - obj is : ', obj);
// 	console.log('# ivypark MSG sync 755 - obj[gt-3] is : ', obj['gt-3']);
// 	for(var objKey in obj) {
// 		o = obj[objKey];
// 		console.log('# ivypark MSG sync 761 - obj[objKey] is : ', o);
// 		console.log('##################### : ', o.ROOM_ID);
// 		if(o && o.ROOM_ID) {
//
// 			console.log('# ivypark MSG sync 756 - obj roomid is : ', o.ROOM_ID);
// 			for(var key in o){
// 				if(key == 'ROOM_ID') {
// 					console.log('# ivypark MSG sync 761 - obj roomID == roomId');
// 				}
// 			}
//
// 		} else {
// 			console.log('# ivypark MSG sync 767 - obj roomid is undefined : ', o.ROOM_ID);
// 		}
// 	}
// });

/*
'SERVICE_TYPE'   : serviceType,
'MEDIA_PIPELINE' : '',   //Media서버를 위한 부분.
'COMPOSE'        : '',  //Media서버를 위한 부분.
'USERS'          : {}
*/

//janus.
/**
 * @param redisInfo
 * @param data = {roomId,janus_url}
 * @returns {Promise}
 */
exports.setJanusServer = (redisInfo, data) => {
	return new Promise((resolve, reject) => {
		redisInfo.master.SET("CONFERENCE:"+data.roomId+":JANUS_SERVER", data.janus_url, (error, resp) => {
			if(error){
				reject();
				return false;
			}
			resolve();
		});
	});
};
/**
 * @param redisInfo
 * @param roomId
 * @returns {Promise}
 */
exports.getJanusServerByRoomId = (redisInfo, roomId) => {
	return new Promise((resolve, reject) => {
		redisInfo.slave.GET('CONFERENCE:' + roomId + ':JANUS_SERVER', async (error, resp) => {
			if (error) {
				respError(error);
				reject();
			}
			resolve(resp);
		});
	});
}
/**
 *
 * @param redisInfo
 * @param data (roomId, janus_room_id)
 * @returns {Promise}
 */
exports.setJanusRoomId = (redisInfo, data) => {
	return new Promise((resolve, reject) => {
		redisInfo.master.SET("CONFERENCE:"+data.roomId+":JANUS_ROOM_ID", data.janus_room_id, (error, resp) => {
			if(error){
				reject();
				return false;
			}
			resolve();
		});
	});
};

exports.getJanusRoomId = (redisInfo, roomId) => {
	return new Promise((resolve, reject) => {
		redisInfo.slave.GET('CONFERENCE:' + roomId + ':JANUS_ROOM_ID', async (error, resp) => {
			if (error) {
				respError(error);
				reject();
			}
			let janusRoomId = parseInt(resp);
			resolve(janusRoomId);
		});
	});
}

exports.setJanusPluginInfo = (redisInfo, data) => {
	return new Promise((resolve, reject) => {
		let _data = {
			socketio_session_id: data.socketio_session_id,
			ptype: data.ptype,
			usage: data.usage,
			ufrag: data.ufrag
		};

		redisInfo.master.HSET("JANUS_PLUGIN_INFO", data.janus_plugin_id, setString(_data), (error, resp) => {
			if(error){
				console.log('setJanusPluginInfo ERROR OCCURRED.' + error);
				reject();
				return false;
			}
			resolve(resp);
		});
	});
};


exports.getJanusPluginInfo = (redisInfo, videoPluginId) => {
	return new Promise((resolve, reject) => {
		redisInfo.slave.HGET('JANUS_PLUGIN_INFO', videoPluginId, (error, resp) => {
			if(error) {
				console.log('getJanusPluginInfo..  ERROR OCCURRED.', error);
				reject();
				return false;
			}
			let data = JSON.parse(resp);

			resolve(data);
		});

	}) ;
}

exports.updateUserSocketInfo = (redisInfo, sessionId, data) => {
	return new Promise((resolve, reject) => {
		redisInfo.master.HSET('SESSION_USER_SOCKET_INFO', sessionId, setString(data), (error, resp) => {
			if(error) {
				console.log('updateUserSocketInfo..  ERROR OCCURRED.', error);
				reject();
				return false;
			}
			resolve();
		});
	});
}

exports.setSdpUfragToJanusVideoPluginId = (redisInfo, data) => {
	return new Promise((resolve, reject) => {
		redisInfo.master.HSET('SDP_UFRAG_JANUS_PLUGINID_MATCHER', data.ufrag, data.videoRoomPluginId, (error, resp) => {
			if(error) {
				console.log('SET PLUGINID WITH SDP UFRAG..  ERROR OCCURRED.', error);
				reject(error);
				return false;
			}
			resolve();
		});
	});
}

exports.getJanusPluginIdFromUfrag = (redisInfo, ufrag) => {
	return new Promise((resolve, reject) => {
		if (!ufrag) return false;

		redisInfo.slave.HGET('SDP_UFRAG_JANUS_PLUGINID_MATCHER', ufrag, (error,resp) => {
			if(error) {
				console.log('GET PLUGINID WITH SDP UFRAG..  ERROR OCCURRED.', error);
				reject(error);
				return false;
			}
			resolve(parseInt(resp));
		})
	})
}

exports.removeUfrag = (redisInfo, ufrag) => {
    return new Promise((resolve, reject) => {
        redisInfo.master.HDEL('SDP_UFRAG_JANUS_PLUGINID_MATCHER', ufrag, (error,resp) => {
            if(error) {
                console.log('DELETE PLUGINID WITH SDP UFRAG..  ERROR OCCURRED.', error);
                reject(error);
                return false;
            }
            resolve();
        })
    })
}

exports.saddSDPOffer = (redisInfo, data) => {
	return new Promise((resolve, reject) => {
		redisInfo.master.SADD('CONFERENCE:' + data.roomId + ':SDP_QUEUE:' + data.sessionId, setString(data.sendData), (error, resp) => {
			if(error) reject();
			else resolve();
		})
	});
};

exports.spopSDPOffer = (redisInfo, data) => {
	return new Promise((resolve, reject) => {
		redisInfo.master.SPOP('CONFERENCE:' + data.roomId + ':SDP_QUEUE:' + data.sessionId, (error, resp) => {
			if(error) reject();
			else resolve(resp);
		})
	});
};

exports.getSessionIsQueuing = (redisInfo, data) => {
	return new Promise((resolve, reject) => {
		redisInfo.slave.HGET('CONFERENCE:' + data.roomId + ':SESSION_IS_QUEUING', data.sessionId, (error, resp) => {
			if(error) reject();
			else resolve(resp === 'true');
		})
	});
};

exports.setSessionIsQueuing = (redisInfo, data) => {
	return new Promise((resolve, reject) => {
		redisInfo.master.HSET('CONFERENCE:' + data.roomId + ':SESSION_IS_QUEUING', data.sessionId, data.isQueuing, (error, resp) => {
			if(error) reject();
			else resolve();
		})
	});
};

exports.deleteJanusRoomId = (redisInfo, roomId) => {
	return new Promise((resolve, reject) => {
		redisInfo.master.DEL('CONFERENCE:' + roomId + ':JANUS_ROOM_ID', (error, resp) => {
			if(error) reject();
			else resolve();
		})
	});
}

// exports.deleteJanusServerIdx = (redisInfo, roomId) => {
// 	return new Promise((resolve, reject) => {
// 		redisInfo.master.DEL('CONFERENCE:' + roomId + ':JANUS_SERVER_IDX', (error, resp) => {
// 			if(error) reject();
// 			else resolve();
// 		})
// 	});
// }

exports.deleteJanusServer = (redisInfo, roomId) => {
	return new Promise((resolve, reject) => {
		redisInfo.master.DEL('CONFERENCE:' + roomId + ':JANUS_SERVER', (error, resp) => {
			if(error) reject();
			else resolve();
		})
	});
}

exports.deleteJanusSessionQueue = (redisInfo, roomId) => {
	return new Promise((resolve, reject) => {
		redisInfo.master.DEL('CONFERENCE:' + roomId + ':SESSION_IS_QUEUING', (error, resp) => {
			if(error) reject();
			else resolve();
		})
	});
}

exports.hdelJanusPluginInfo = (redisInfo, videoPluginId) => {
	return new Promise((resolve, reject) => {
		redisInfo.master.HDEL('JANUS_PLUGIN_INFO', videoPluginId, (error, resp) => {
			if(error) reject();
			else resolve();
		})
	});
}

exports.setJanusVideoFeedId = (redisInfo, data) => {
	return new Promise((resolve, reject) => {
		redisInfo.master.HSET('JANUS_FEED_INFO', data.feedId, data.usage, (error, resp) => {
			if(error) {
				console.log('SET JANUS_FEED_INFO..  ERROR OCCURRED.', error);
				reject(error);
				return false;
			}
			resolve();
		});
	});
}

exports.getJanusVideoFeedId = (redisInfo, feedId) => {
	return new Promise((resolve, reject) => {
		redisInfo.slave.HGET('JANUS_FEED_INFO', feedId, (error, resp) => {
			if(error) {
				console.log('GET JANUS_FEED_INFO..  ERROR OCCURRED.', error);
				reject(error);
				return false;
			}
			resolve(resp);
		});
	});
}

exports.deleteJanusVideoFeedId = (redisInfo, data) => {
	return new Promise((resolve, reject) => {
		redisInfo.master.HDEL('JANUS_FEED_INFO', data.feedId, (error, resp) => {
			if(error) {
				console.log('HDEL JANUS_FEED_INFO..  ERROR OCCURRED.', error);
				reject(error);
				return false;
			}
			resolve();
		});
	});
}
//janus end.