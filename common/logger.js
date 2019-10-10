'use strict';

/* external modules */
const winston = require('winston');
const winstonDaily = require('winston-daily-rotate-file');
const { combine, printf } = winston.format;

const logDir = './log/';
const logDirDate = '%DATE%';
const maxFileSize = '1M';

const logger = winston.createLogger({
	level: 'debug',
	format: combine(
		printf(log => `[${new Date().toLocaleString().replace(/[TZ]/g, ' ').substring(2, 19)}] ${log.level}) ${log.message}`)
	),
	transports: [
		new winston.transports.Console(),
		new (winstonDaily)({
			level: 'info',
			filename: `${logDir}${logDirDate}.log`,
			datePattern: 'YYMMDD.HH',
			maxSize: maxFileSize
		})
	]
});

module.exports = logger;