const {commonConfig} = require('../common/common.config');
const coreio = require('socket.io-client');
const request = require('request');
const Promise = require('promise');
const dateUtils = require('date-utils');
const nodemailer = require('nodemailer');
const fs = require('fs');
const fn_Kurento = require('./fn.kurento.service');
const XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;
const syncFn = require('./fn.sync.service');
const logger = require('../common/logger');

// 190318 ivypark, eventOp 필수 parameter 체크
exports.paramChecker = data => {
    const mandatoryKey = {
        Login: ['eventOp', 'reqNo', 'reqDate', 'userId'],
        Call: ['eventOp', 'reqNo', 'userId', 'reqDate', 'reqDeviceType','targetId'],
        Reserve: ['eventOp', 'reqNo', 'userId', 'reqDate', 'targetId'],
        Join: ['eventOp', 'reqNo', 'userId', 'reqDate', 'roomId', 'status'],
        SDP: ['eventOp', 'reqNo', 'userId', 'reqDate', 'sdp', 'roomId'],
        Candidate: ['eventOp', 'reqNo', 'userId', /*'reqDate',*/ 'candidate', 'roomId'],
        ExitRoom: ['eventOp', 'reqNo', 'userId', 'reqDate', 'roomId'],
        SessionReserve: ['eventOp', 'reqNo', 'userId', 'reqDate', 'roomId'],
        SessionReserveEnd: ['eventOp', 'reqNo', 'userId', 'reqDate'],
        FileShareStart: ['eventOp', 'reqNo', 'roomId', 'fileInfoList', 'reqDate', 'userId'],
        FileShare: ['eventOp', 'reqNo', 'roomId', 'fileUrl', 'reqDate', 'userId'],
        FileShareEnd: ['eventOp', 'reqNo', 'userId', 'reqDate', 'roomId'],
        WhiteBoardStart: ['eventOp', 'reqNo', 'roomId', 'reqDate', 'userId'],
        WhiteBoardEnd: ['eventOp', 'reqNo', 'userId', 'reqDate', 'roomId'],
        Logout: ['eventOp', 'reqNo', 'reqDate', 'userId'],
        ScreenShare: ['eventOp', 'reqNo', 'userId', 'reqDate', 'sdp', 'roomId'],
        ScreenShareEnd: ['eventOp', 'reqNo', 'userId', 'reqDate', 'sdp', 'roomId']
    };

    const opArr = Object.keys(mandatoryKey);
    let returnCode = fieldName => {
        return {
            code: '481',
            message: `Parameter error. require ${fieldName} field.`
        };
    };

    return new Promise((resolve, reject) => {
        let isNotExistInChecker = opArr.every(curr => data.eventOp !== curr);
        if (isNotExistInChecker) {
            resolve(null);
            return false;
        }

        opArr.forEach(curr => {
            if(data.eventOp === curr) {
                let invalidParameter;
                mandatoryKey[curr].forEach((cur, index) => {
                    if (!data[cur]) invalidParameter = cur;
                    if (index >= (mandatoryKey[curr]).length - 1) {
                        invalidParameter ? resolve(returnCode(invalidParameter)) : resolve(null);
                    }
                })
            }
        });
    })
};

// 190315 ivypark, server 관련 정보 저장
let serverInfo = {
    signal: {},
    core: [],
    turn: [],
    switch: {
        core: -1,
        turn: -1
    },
    getCore: () => {
        let _self = serverInfo;
        return new Promise((resolve, reject) => {
            _self.switch.core++;
            if (_self.switch.core >= _self.core.length) {
                _self.switch.core = 0;
            }
            resolve(_self.core[_self.switch.core]);
        })
    },
    getTurn: () => {
        let _self = serverInfo;
        return new Promise((resolve, reject) => {
            _self.switch.turn++;
            if (_self.switch.turn >= _self.turn.length) {
                _self.switch.turn = 0;
            }
            resolve(_self.turn[_self.switch.turn]);
        })
    }
};

// 190315 ivypark, add connectionless method, timeout process
let coreConnector = {
    /**
     *
     * @param {string} sessionId
     * @param {string} type
     * @param {string} url
     * @param {object} body
     * @returns {Promise<*>}
     */
    start: async (sessionId, type, url, body) => {
        // 190515 ivypark, Core REST 변경 건으로 인한 수정
        const base = await serverInfo.getCore();
        return new Promise((resolve, reject) => {

            let time = setTimeout(() => {
                clearTimeout(time);
                let msg = {
                    code: '504',
                    message: 'Server Timeout'
                };

                if (!sessionId) {
                    logger.error(`FATAL : All Core Server are DEAD.`);
                    console.log('FATAL : all core server are DEAD...');
                } else {
                    serverInfo.signal.to(sessionId).emit('knowledgetalk', msg);
                }
            }, 3000);

            let OPTIONS = {
                headers: {'Content-Type': 'application/json'},
                url: `${base}conference/v1/${url}`,
                body: JSON.stringify(body)
            };

            let apiCallback = (err, res, result) => {
                if (!err) {
                    clearTimeout(time);
                    if (res.statusCode === 404) {
                        let msg = {
                            code: '501',
                            message: 'Internal Server Error'
                        };

                        if (!sessionId) {
                            console.log('FATAL : all core server are DEAD...');
                        } else {
                            serverInfo.signal.to(sessionId).emit('knowledgetalk', msg);
                        }
                        // resolve({ code: String(res.statusCode) });
                    } else {
                        resolve({ code: String(res.statusCode), ...JSON.parse(result) });
                    }
                }
            };

            switch (type) {
                case 'get':
                    OPTIONS.body = undefined;
                    request.get(OPTIONS, apiCallback);
                    break;

                case 'post':
                    request.post(OPTIONS, apiCallback);
                    break;

                case 'put':
                    request.put(OPTIONS, apiCallback);
                    break;

                case 'delete':
                    request.delete(OPTIONS, apiCallback);
                    break;

                default:
                    logger.error(`# [Signal -> Core] HTTP type are not defined. #`);
                    break;
            }
        });
    },
    emit: async (sessionId, data, callback) => {
        // 190318 ivypark, Core 서버에 접근 하기 전 alive check 하는 flow
        // 이 코드가 들어가게 되면, 반응이 늦어짐. 클라이언트가 요청을 막 보내면 응답이 1초정도 늦게 감.. 확인 필요..

        // let coreUrl = await coreConnector.aliveCheck();
        // if (!coreUrl) {
        // 	if (!sessionId) {
        // 		console.log('FATAL : all core server are DEAD...');
        // 		return;
        // 	}
        // 	serverInfo.signal.to(sessionId).emit('knowledgetalk', {
        // 		eventOp: data.eventOp,
        // 		code: 500,
        // 		message: 'Internal Server Error'
        // 	});
        // }
        // let url = await serverInfo.getCore();

        // let coreSocketIo = coreio.connect(await serverInfo.getCore(), { secure: true, reconnect: true, rejectUnauthorized: false });
        // if (coreSocketIo) {
        //     let time = setTimeout(() => {
        //         clearTimeout(time);
        //         coreConnector.returnMessage(data.eventOp, sessionId);
        //         coreSocketIo.disconnect();
        //     }, 5000);
        //
        //     coreSocketIo.emit('knowledgetalk', data, function (_data) {
        //         let arg2 = arguments[1] ? arguments[1] : undefined;
        //         let arg3 = arguments[2] ? arguments[2] : undefined;
        //         coreSocketIo.disconnect();
        //         clearTimeout(time);
        //         callback(_data, arg2, arg3);
        //     })
        // } else {
        //     coreConnector.returnMessage(data.eventOp, sessionId);
        // }
    },
    // 190319 ivypark, add alive check function
    aliveCheck: () => {
        return new Promise((resolve, reject) => {
            const MAX_RETRY_COUNT = serverInfo.core.length;
            let req, cnt = 0;
            (async function retryRequest() {
                let url = await serverInfo.getCore();
                req = request.get(url, (err, resp, body) => {
                    if (err.code === 'ECONNREFUSED') {
                        cnt++;
                        cnt > MAX_RETRY_COUNT ? resolve(null) : retryRequest()
                    } else {
                        resolve(url);
                        req.abort();
                    }
                })
            })();
        });
    }
};

exports.serverInfo = serverInfo;
exports.coreConnector = coreConnector;

// 190319 ivypark, 서버 정보 세팅 (최초 1회)
exports.setServerInfo = signalIo => {
    return new Promise(async (resolve, reject) => {
        serverInfo.signal = signalIo;

        for (let i in commonConfig.serverURL.coreServer) {
            if (commonConfig.serverURL.coreServer.hasOwnProperty(i)) {
                let _url = commonConfig.serverURL.coreServer[i] + ':'
                    + commonConfig.serverPort.coreServer[i] + '/'
                    + commonConfig.nameSpace.coreServer;

                serverInfo.core.push(_url);
            }
        }

        let result = await coreConnector.start('', 'get', 'info/servers', {})
        serverInfo.turn = result.servers;
        resolve();
    });
};

let signalSocket = {
    emit: (sessionId, respData, reqData) => {
        if (!sessionId || !respData) {
            logger.log('warn', '[Signal -> App]', 'do not send response message...');
            return;
        }

        if (respData.eventOp) {
            transaction(respData, reqData || {}, sessionId);
        }
        logger.log('info', `[Signal -> App] ${JSON.stringify(respData)}`);
        serverInfo.signal.to(sessionId).emit('knowledgetalk', respData);
    },
    broadcast: (socket, roomId, respData, reqData) => {
        if (!roomId || !respData) {
            logger.log('warn', '[Signal -> App]', 'do not send broadcast message...');
            return;
        }

        if (respData.eventOp) {
            transaction(respData, reqData || {});
        }
        logger.log('info', `[Signal -> App] ${JSON.stringify(respData) }`);
        socket.broadcast.to(roomId).emit('knowledgetalk', respData);
    }
};

exports.signalSocket = signalSocket;

const transaction = async function(res, req, sessionId) {
    let serviceName = '';
    if (!res.code) {
        console.log('do not have to insert transactions.');
        return false;
    }

    async function insertTransactionError(result) {
        let transactionErrorData = {
            'eventOp'        : 'TransactionError',
            'eventOpName'    : res.eventOp,
            'eventOpData'    : res.message,
            'userId'         : (res.userId || req.userId) || '',
            'reqData'        : req,
            'resData'        : res,
            'idx'            : result ? result.idx : 0,
            'roomId'         : (res.roomId || req.roomId) || ''
        };
        logger.log('info', `[Signal -> App] send Data :  ${JSON.stringify(transactionErrorData)}`);
        await coreConnector.start(
            sessionId,
            'post',
            'info/transaction/error',
            transactionErrorData
        );
        // coreConnector.emit(sessionId || '', transactionErrorData, function (result) {});
    }

    let transactionData = {
        'eventOp'        : 'Transaction',
        'code'           : res.code,
        'userId'         : (res.userId || req.userId) || '',
        'service'        : serviceName,
        'codeMessage'    : res.message || (res.code === '200' ? 'OK' : 'error message not defined.'),
        'roomId'         : (res.roomId || req.roomId) || ''
    };

    switch (res.eventOp) {
        case 'Login':
            transactionData.service = "로그인";
            logger.log('info', `[Signal -> App] ${JSON.stringify(transactionData)}`);
            break;

        case 'Call':
        case 'Join':
            if (res.code === '200') return false;
            transactionData.service = "영상통화 시작";
            logger.log('info', `[Signal -> App] send Data :  ${JSON.stringify(transactionData)}`);
            break;

        case 'SDP':
            transactionData.service = "영상통화 시작";
            logger.log('info', `[Signal -> App] send Data :  ${JSON.stringify(transactionData)}`);
            break;

        case 'Logout':
            transactionData.service = "로그아웃";
            logger.log('info', `[Signal -> App] send Data : ${JSON.stringify(transactionData)}`);
            break;

        case 'ExitRoom':
            transactionData.service = "영상통화 종료";
            logger.log('info', `[Signal -> App] send Data :  ${JSON.stringify(transactionData)}`);
            break;

        default:
            console.log(res.eventOp);
            console.log(res.code);
            if (res.code !== '200') insertTransactionError();
            logger.log('info', `[Signal -> App] send Data :  ${JSON.stringify(transactionData)}`);
            return false;
    }

    let result = await coreConnector.start(
        sessionId,
        'post',
        'info/transaction',
        transactionData
    );

    if (res.code !== '200') {
        console.log('ivypark ::::::::: ', result);
        await insertTransactionError(result.result)
        logger.log('info', `transaction data : ${JSON.stringify(result)}`);
    }
};

exports.transaction = transaction;

//서버이중화를 위한 메서드
exports.getServerURL = function(server, execType){
    return new Promise(function(resolve, reject){
        let serverURL  = commonConfig.serverURL[server];
        let serverPort = commonConfig.serverPort[server];
        let serverAuth = null;
        let returnServerUrl;

        if(server === 'redisServer'){
            serverAuth = commonConfig.redisAuth;
        }

        if(execType === 'TB'){

            if(server === 'coreServer'){
                returnServerUrl = serverURL[0] + ":" + serverPort[0];
            }

            if(server === 'redisServer'){
                returnServerUrl = {
                    serverURL  : serverURL[0],
                    serverPort : serverPort[0],
                    serverAuth : serverAuth[0]
                }
            }

            resolve(returnServerUrl);
            return false;
        }

        /*
    	* 이중화 할경우 SignalServer로 request('URL')을 보내서 서버를 상태를 체크
    	* error이 없을 경우 해당 Signal 서버이용, request('URL') 했던 객체를 abort()로 취소하고 페이지 render()
    	* error가 있을 경우 다른 SignalServer를 이용.
    	*/

        let serverArray = [];

    	for(let i in serverURL){
    		let connectServer = serverURL[i] + ":" + serverPort[i];
    		serverArray.push(connectServer);
    	}

        //실행중인 request객체를 담는 배열
    	let urlrequest = [];

    	for(let i in serverArray){
    		urlrequest[i] = request.get(serverArray[i], function (error, response, body) {

			if( error != null && (response && response.statusCode) == undefined){
				//전체 signalServer가 안될경우 해당 메세지를 보냄.
				if(i == (serverArray.length - 1 )){
					returnServerUrl = undefined;
					reject(returnServerUrl);
				}
			}else if(error == null && (response && response.statusCode) != undefined){
				//생성했던 모든 requst객체 취소.
				for(let k in urlrequest){
					urlrequest[k].abort();
				}
				returnServerUrl = serverArray[i];
			}

			resolve(returnServerUrl);
    		});
    	}
    })
};

exports.sendFindMail = function(data, data2) {

    var mailText = '<!DOCTYPE html>' +
        '<html lang="ko">' +
        '<head>' +
            '<meta charset="utf-8">' +
            '<meta http-equiv="X-UA-Compatible" content="IE=edge">' +
            '<meta name="description" content="">' +
            '<meta name="viewport" content="width=device-width">' +
            '<title>NGC Project Mail Service</title>' +
        '</head>' +
        '<body style="background:#f9f9f9">' +
        '<div style="width:670px;height:845px;margin:0 auto;padding:58px 77px;border-top:3px solid #ff0f0f;border-bottom:1px solid #888;background:#fff;box-sizing:border-box">' +
            '<div style="position:relative;padding-bottom:5px;border-bottom:1px solid #ccc">' +
                '<img src="" alt="NGCP">' +
                '<span style="position:absolute;right:0;bottom:5px;font-size:12px;color:#686868">본 메일은 발신전용입니다.</span>' +
            '</div>';

    mailText += data.eventOp == 'FindId' ?
           '<div style="margin-top:47px">' +
               '<div style="margin-bottom:30px;font-size:17px;font-weight:bold;color:#444">아이디 찾기 결과 안내</div>' +
               '<div style="width:100%;padding:30px 0;text-align:center;font-size:17px;font-weight:bold;border:2px solid #f4f2f3;background:#fbfbfb">' + data.userName + '님의 아이디는 <span style="color:#ff4e4e">' + data2.id + '</span>  입니다.</div>' +
               '<a href="" style="display:block;width:148px;height:27px;margin:30px auto 0;line-height:27px;text-align:center;text-decoration:none;font-size:12px;font-weight:bold;color:#fff;border-radius:2px;background:#6e6e6e">로그인하러 가기</a>' +
           '</div>' +
           '</div>' +
           '</body>' +
           '</html>'
           :
           '<div style="margin-top:47px">' +
               '<div style="margin-bottom:30px;font-size:17px;font-weight:bold;color:#444">비밀번호 찾기 결과 안내</div>' +
               '<div style="width:100%;padding:30px 0;text-align:center;font-size:17px;font-weight:bold;border:2px solid #f4f2f3;background:#fbfbfb">' + data.userId + '님의 임시 비밀번호는 <span style="color:#ff4e4e">' + data2 + '</span>  입니다.</div>' +
               '<div style="margin-top:10px;font-size:12px;font-weight:bold;color:#393939">로그인 후 비밀번호를 꼭 변경해주세요.</div>' +
               '<a href="" style="display:block;width:148px;height:27px;margin:30px auto 0;line-height:27px;text-align:center;text-decoration:none;font-size:12px;font-weight:bold;color:#fff;border-radius:2px;background:#6e6e6e">로그인하러 가기</a>' +
           '</div>' +
           '</div>' +
           '</body>' +
           '</html>'


    var smtpTransport = nodemailer.createTransport({
        service: 'Gmail',
        auth: {
            user: 'ktgeniemaster',
            pass: 'q1w2e3r4T%'
        }
    });

    var mailOptions = {
        from: 'GENIEMASTER',
        to: data.userId, // 메일 주소 받기
        subject: 'KT GiGA Genie 금융 화상컨설팅 서비스',
        html: mailText
    };

    smtpTransport.sendMail(mailOptions, function(error, response){

        if (error){
            console.log(error);
        } else {
            console.log("Message sent : " + response.message);
        }
        smtpTransport.close();
    });

};

exports.getReqNo = function(reqNo) {

    if(Number(reqNo) % 2 == 1){
        ++reqNo;
    }

    return reqNo.toString();
};

exports.reqNo = function() {
    return new Promise(function(resolved, rejected){
        const randomNum  = "0123456789";
        const date        = new Date();
        const newDate     = date.toFormat('YYYYMMDDHH24MISS');

        let randomResult = '';
        for(let i = 0; i < 4; i++) {
            randomResult += randomNum.charAt(Math.floor(Math.random() * randomNum.length));
        };

        randomResult = Number(randomResult);
        if(randomResult % 2 == 1){
            ++randomResult;
        }
        randomResult = String(randomResult);

        if(randomResult.length < 4) {
            let _t = '';
            for(let i = 0; i < 4 - randomResult.length; i++) {
                _t += '0';
            }
            randomResult = _t + randomResult;
        }

        let result = newDate + randomResult;
        //console.log('## reqNo result ::', result);
        resolved(result);
    });
}

//서버시간을 리턴.
exports.getDate = function(){
	const date = new Date();
	const newDate = date.toFormat('YYYYMMDDHH24MISS');
	return newDate;
};

//서버시간을 리턴.
exports.getRoomId = function(){
	let roomIdObj = this;
	return new Promise(function(resolved, rejected){
		const date        = new Date();
		const newDate     = date.toFormat('YYYYMMDDHH24MISS');
		roomIdObj.randomText().then(function(text){
			console.log("text : ", text);
			const roomId = newDate + '-' + text;
			console.log("roomId : ", roomId);
			resolved(roomId);
		});
	});
};

exports.randomText = function(){
	console.log("randomText !!!!!");
	return new Promise(function(resolved, rejected){
		const ramdonText  = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
		let result = '';
		for(let i = 0; i < 12; i++) {
			  result += ramdonText.charAt(Math.floor(Math.random() * ramdonText.length));
		};
		console.log("result : ", result);
		  resolved(result);
	});
};

function setDuplicateLoginInfo( masterRedis, slaveRedis, sessionId, callback ) {
	masterRedis.HSET( 'DUPLICATE_LOGIN_INFO', sessionId, true );
	callback();
}

function getDuplicateLoginInfo ( masterRedis, slaveRedis, sessionId, callback ) {
	slaveRedis.HGET( 'DUPLICATE_LOGIN_INFO', sessionId, function( err, result ) {
		
		/**
		 * If there isn't result, this session is not dupicate login.
		 */
		if ( !result ) {
			callback( false );
		} else {
			callback( result );
		}
	});
}


function delDuplicateLoginInfo( masterRedis, slaveRedis, sessionId, callback ) {
	masterRedis.HDEL( 'DUPLICATE_LOGIN_INFO', sessionId, function( err, result ) {	
		callback( result );
		
	});
	// masterRedis.HDEL("CONFERENCE:"+room_id+":SESSION_INFO", session_id, function (error, resp3)
}

async function getUserName( /*coreSocket,*/ userId, callback ) {
	let eventOp = 'GetUserName';
	let data = {
		eventOp,
		userId,
    }

    let result = await coreConnector.start('', 'get', `users/${data.userId}`, {});
    callback( null, result.name );
}

async function getUserNumber( /*coreSocket,*/ userId, callback ) {
    let eventOp = 'GetUserNumber';
    let data = {
        eventOp,
        userId,
    };

    let result = await coreConnector.start('', 'get', `users/${data.userId}`, {} );
    callback( result.user.user_number);
}

function getConsultUserName( coreSocket, userId, callback ) {
	let eventOp = 'GetConsultUserName';
	let data = {
		eventOp,
		userId,
	}

	coreSocket.emit( 'knowledgetalk', data, function( err, result ) {
		if ( err ) {
			callback( err, null );
			return;
		}
		callback( null, result );
	});
}

exports.delDuplicateLoginInfo = delDuplicateLoginInfo;
exports.getDuplicateLoginInfo = getDuplicateLoginInfo;
exports.setDuplicateLoginInfo = setDuplicateLoginInfo;
exports.getUserName = getUserName;
exports.getConsultUserName = getConsultUserName;
exports.getUserNumber = getUserNumber;

exports.hasSession = function( masterRedis, slaveRedis, sessionId, callback ) {

	slaveRedis.HGET( 'SESSION_USER_SOCKET_INFO', sessionId, function(err, obj){
		if ( err ) {
			callback( err, null );
			return;
		}

		let result =  JSON.parse( obj );
		
		if ( !result ) {
			callback( null, 'There is no data in redis' );
			return;
		}

		if ( result.ROOM_ID === '' ) {
			callback( null, 'This user dose not have a room' );
			return;
		}

		
		let roomId;
		let userId;

		try {
			
			roomId = result.ROOM_ID;
			userId = result.ID;

		} catch( err ) {

			callback( err, null )
		}


		slaveRedis.HGET( 'ROOMS_INFO', roomId, function( err, obj ){
			if ( err ) {
				callback( err, null );
				return;
			}
		
			
			let result = JSON.parse( obj );
			let serviceType;
			let sessionInfo ;
			
			try {

				serviceType = result.SERVICE_TYPE;
				sessionInfo = result.SCREEN;

			} catch( e ) {
				callback( err, null );
			}

			if ( serviceType !== 'multi') {
				callback( null, 'The user who use consultant app do not have to use this api' );
				return;
			}
			
			if ( !sessionInfo.USERID || sessionInfo.USERID !== userId ) {
				callback( null, 'This user does not have a share resource' );
				return;				
			}

			if ( sessionInfo.USERID === userId ) {

				result.SCREEN.FLAG = false;
				result.SCREEN.USERID = null;

				masterRedis.HSET( 'ROOMS_INFO', roomId, JSON.stringify(result) );
				callback( null, 'This user have a share resource', { roomId, userId });
				
			} else {
				callback( null, 'Unknown result' )
			}

		})
	});
}

exports.setJSON = function(_data){
	return JSON.stringify(_data);
};

exports.logOut = function(socket, signalSocketio, /*coreSocketio,*/ masterRedis, slaveRedis, sessionId, userId,  roomId){
    let logoutId;
	let logoutRoomId;
	let logOutObj = this;
    let logoutService ;

	// 로컬 공유 삭제 처리
    syncFn.getUserId(masterRedis, slaveRedis, sessionId).then(function(resultId) {
    
        // Room Id 체크 (방에 ScreenShare Flag 삭제해야 함.)
        if ( !resultId ) {
            logger.log('warn', 'logout data.userid 없음.');
        } else {
        	let redisInfo = {
                master: masterRedis,
                slave : slaveRedis
			};

            syncFn.getLocalShareRoom(redisInfo, roomId, function (roomInfo) {

            	try {
            		if (roomInfo && roomInfo.MAKER) {
                        let makerSessionId = roomInfo.MAKER;

                        let localScreenShareEndSvr = {
                            'eventOp': 'LocalScreenShareEndSvr',
                            'reqNo': '1',
                            'userId': roomInfo.USER[makerSessionId].ID
                        };

                        let _arr = Object.keys(roomInfo.USER);

                        for (let sid of _arr) {
                            if (sid !== makerSessionId) {
                                syncFn.getRoomId3(masterRedis, slaveRedis, sid).then(function(rid) {
                                    console.log( rid );
                                    syncFn.resetScreenShareFlag( redisInfo, rid, function(err) {} );
                                });
                            }
                            syncFn.resetLocalScreenShare(redisInfo, sid, function () {});
                            signalSocket.emit(sid, localScreenShareEndSvr);
                        }
					}
				} catch (e) {
					console.log(e);
                }

                syncFn.getUserService(masterRedis, slaveRedis, sessionId)
                    .then(function(_roomData){
                        logoutService = _roomData;
                        syncFn.logOut(masterRedis, slaveRedis, sessionId, userId, roomId).then(
                            function(leaveData){
                                fn_Kurento.stop(sessionId, leaveData.roomId, masterRedis, slaveRedis);
                                fn_Kurento.hwShareRemoveSession(leaveData.roomId, sessionId);
                                fn_Kurento.deleteUserFromConferenceWaitingLine(masterRedis, slaveRedis, leaveData.roomId, sessionId);
                                socket.leave(leaveData.roomId);

                                if(!leaveData){
                                    logger.log('info', `[common.service logout] there is NOT logout data - ${JSON.stringify(leaveData)}`);
                                    return;
                                }

                                logoutId     = leaveData.logoutId;
                                logoutRoomId = leaveData.roomId;
                                flag         = leaveData.flag;

                                if ('file' === flag){
                                    let fileDate = {
                                        'eventOp': 'FileShareEndSvr',
                                        'userId': logoutId,
                                        'roomId': logoutRoomId
                                    }
                                    signalSocket.broadcast(socket, logoutRoomId, fileDate);
                                } else if('true' === flag){
                                    let screenData = {
                                        'eventOp': 'ScreenShareConferenceEndSvr',
                                        'roomId': logoutRoomId,
                                        'code': '200',
                                        'message': 'OK'
                                    }
                                    signalSocket.broadcast(socket, logoutRoomId, screenData);
                                }

                                let data = {
                                    'eventOp'  : 'Logout',
                                    'userId' : leaveData.logoutId,
                                    'userList' : leaveData.userList,
                                    'roomId'   : leaveData.roomId
                                }

                                console.log("service가져옴:",logoutService);
                                data.serviceType = logoutService;

                                getDuplicateLoginInfo( masterRedis, slaveRedis, sessionId, function( result ) {
                                    data.duplicateLogin = result; // true or false

                                    coreConnector.start('', 'put', `users/${data.userId}/logout`, {})
                                    .then( function(_data){
                                       /**
                                         * After execption process of logout in Core server, Core server return string (duplicate login)
                                         */
                                        if ( _data === 'duplicate login' ) {
                                            delDuplicateLoginInfo( masterRedis, slaveRedis, sessionId, function( result ) {
                                                /**
                                                 * if there isnt's removed field, result is 0
                                                 * so, if key exist, return 1
                                                 */
                                                console.log( result )
                                            })
                                        }

                                        logger.log('info', `[common.service logout] logout success - ${JSON.stringify(logoutId) }`);
                                        // #0917

                                        getUserName( /*coreSocketio,*/ logoutId, async function( err, userName ){
                                            let exitDate = logOutObj.getDate();
                                            let exitData = {
                                                'signalOp' : 'Presence',
                                                'userId'   : logoutId,
                                                'userName' : userName,
                                                'action'   : 'exit'
                                            };

                                            transaction({
                                                eventOp: 'Logout',
                                                userId: logoutId,
                                                code: '200',
                                                message: 'OK'
                                            }, {}, sessionId || '');
                                      
                                            if(leaveData.userList){
                                                if (leaveData.isEnded){
                                                    exitData.action = 'end';
                                                    for(let i = 0; i < leaveData.userList.length; i++) {
                                                        await coreConnector.start('', 'put', `users/${leaveData.userList[i]}/status`, {status: 'ready'})
                                                    };
                                                    coreConnector.start('', 'put', `rooms/${data.roomid}/exit`, {}).then(data => {
                                                        logger.log('info', `UpdateConferenceHistory callback ${JSON.stringify(data)}`);
                                                    });                                                                                                   
                                                } else {
                                                    //iamabook. 190201
                                                    exitData.userCount = Object.values(leaveData.userList).length;
                                                    if (exitData.userCount === 1) {
                                                        coreConnector.start('', 'put', `rooms/${data.roomid}/exit`, {}).then(data => {
                                                            logger.log('info', `UpdateConferenceHistory callback ${JSON.stringify(data)}`);
                                                        });
                                                    }
                                                }
                                                socket.broadcast.to(leaveData.roomId).emit('knowledgetalk', exitData);
                                                logger.log('info', `[common.service logout] presense msg send success (signal -> app) : ${JSON.stringify(exitData)}`);
                                                }
                                           }
                                        )
                                    });
                                })
                            }
                        )

                    }).catch(function(error){
                    console.log("비정상종료 서비스타입못가져 왓을때 && 결과값이없을때");
                });

            });
        }

    });
};

//config에 추가한 mediaConstraint를 가져오는 함수
exports.getMediaConstraint = function() {
	return commonConfig.mediaConstraint;
};

exports.getMediaServerUrls = function() {
	return commonConfig.mediaServerUrls;
};

exports.getSchedulerConfig = function() {
	return commonConfig.scheduler;
};

exports.getMexServerConfig = function() {
    return commonConfig.mexServer;
};

exports.getMediaServerSelector = function() {
    return commonConfig.mediaServerSelector;
};

exports.getPushConfig = function() {
	return commonConfig.push;
};

exports.getJanusUrl = function() {
    return commonConfig.janusUrls;
};

exports.isSfu = function() {
    return commonConfig.isSfu;
};

exports.getJanusSecret = function() {
    return commonConfig.janusSecret;
};
