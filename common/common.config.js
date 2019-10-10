let commonConfig = {
	port : 7000,
	serverURL : {
		coreServer  : [],
		masterRedis : '',
		slaveRedis  : ''
	},
	serverPort : {
		coreServer  : [],
		masterRedis : '',
		slaveRedis  : ''
	},
	redisDBNumber : 1,
	redisAuth : {
		masterRedis : '',
		slaveRedis  : ''
	},
	nameSpace : {
		signalServer : 'SignalServer',
		coreServer   : ''
	},
	mediaConstraint : {
		video : {
			width	: 1280,
			height	: 720,
			framerate : 15
		},
        maxVideoRecvBandwidth : 1000,
        maxVideoSendBandwidth : 1000,
	},
    mediaServerUrls : [],
	mexServer: {
		uri: 'ws://218.145.218.225:3010',
		type: 'sfu'
	},
    mediaServerSelector: true,
	//janus
	janusUrls: [],
	isSfu: true,
	janusSecret: '',
	/*
	 	ivypark 180219 config +
		5초 주기로 체크하는 스케줄러 내 대기콜, 호처리 timeout 시간 설정
		unit : seconds
	 */
	scheduler : {
		readyCall : {
			waitingTime : 60
		},
		msgTimeout : {
			waitingTime : 3,
		}
	},
};

function setConfig(configs, callback) {
	try {
        commonConfig.port = configs.server.port;

		for (let i in configs.server.core) {
			if (configs.server.core.hasOwnProperty(i)) {
				commonConfig.serverURL.coreServer.push(configs.server.core[i].url);
				commonConfig.serverPort.coreServer.push(configs.server.core[i].port);
			}
		}

        commonConfig.serverURL.masterRedis = configs.server.sync.url;
        commonConfig.serverURL.slaveRedis = configs.server.sync.url;

        commonConfig.serverPort.masterRedis = configs.server.sync.masterPort;
        commonConfig.serverPort.slaveRedis = configs.server.sync.slavePort;

        commonConfig.redisDBNumber = configs.server.sync.dbNumber;
        commonConfig.redisAuth.masterRedis = configs.server.sync.masterAuth;
        commonConfig.redisAuth.slaveRedis = configs.server.sync.slaveAuth;

		commonConfig.mediaServerUrls[0] = configs.server.media.url;
		commonConfig.mediaServerUrls[1] = configs.server.media.url;

		//janus
		commonConfig.janusUrls[0] = configs.server.janus.url;
		commonConfig.janusSecret = configs.server.janus.secret;

		callback();
	} catch (e) {
		console.log(e);
		callback('Error');
    }
}

module.exports = {
	commonConfig,
	setConfig
};
