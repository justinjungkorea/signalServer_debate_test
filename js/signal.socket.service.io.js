const socketio          = require('socket.io');
const coreio = require('socket.io-client');
const redis             = require('redis');
const ioRedis           = require('socket.io-redis');
const {commonConfig}    = require('../common/common.config');
const commonFn          = require('./fn.common.service');
const signalServerEvent = require('./fn.signal.socket.event');
const coreServerEvent   = require('./fn.core.socket.event');
const execType          = 'TB';
const logger            = require('../common/logger');

// logger.initLog('./log/signal.server');

module.exports = function(_app, pid, workerId){
	logger.log('info', `${JSON.stringify(pid) } is work. workerId : ${JSON.stringify(workerId)} `,);
	const signalSocket  = socketio(_app, { reconnect : true, transports: ['websocket', 'polling'] });

	signalSocket.adapter(ioRedis({ host : commonConfig.serverURL.masterRedis, port: commonConfig.serverPort.masterRedis, password : commonConfig.redisAuth.masterRedis }));
	const masterRedis = redis.createClient(commonConfig.serverPort.masterRedis, commonConfig.serverURL.masterRedis, {auth_pass : commonConfig.redisAuth.masterRedis, db : commonConfig.redisDBNumber});
	const slaveRedis = redis.createClient(commonConfig.serverPort.slaveRedis, commonConfig.serverURL.slaveRedis, {auth_pass : commonConfig.redisAuth.slaveRedis, db : commonConfig.redisDBNumber});

	const signalNameSpace   =  '/' + commonConfig.nameSpace.signalServer;

	const signalSocketio = signalSocket.of(signalNameSpace).on("connection", function(socket){
		console.log('is connection, Process Id : ', pid);
		let sessionId = socket.id;
		logger.log('info', `소켓접속 : ${JSON.stringify(sessionId) }`);
		signalServerEvent(socket, signalSocketio, /*coreSocketio,*/ masterRedis, slaveRedis, sessionId, pid);

		// commonFn.getServerURL('coreServer', execType)
		// .then(function(_coreServerURL){
		// 	coreServerURL = _coreServerURL + "/" + commonConfig.nameSpace.coreServer;
		// 	coreSocketio  = coreio.connect(coreServerURL,{ secure: true, reconnect: true, rejectUnauthorized : false });
		// })
		// .catch(function(error) {
		// 	console.log('get CoreServer URL error')
		// });
	});
};
