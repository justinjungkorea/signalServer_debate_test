"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const isBrowser = this.window === this;
// import * as cluster from 'cluster'
// import * as alog from 'electron-log'
// // const alog = require('electron-log')
// function current_woker_id() {
// 	if(cluster.worker) {
// 		return cluster.worker.id
// 	} else {
// 		return 0
// 	}
// }
//
// alog.transports.console.format = '{h}:{i}:{s}:{ms}[{level}]'+'<'+current_woker_id()+'>'+ '{text}';
// export function getLogInst() {
// 	const log = {
// 		info: function(...args) {
// 			const tag =
// 			alog.info('<'+tag+'>', ...args)
// 		}
// 	}
// 	return log
// }
// export default alog
/**
 * Created by netmind on 17. 5. 22.
 */
const tracer = require('tracer');
function remote_log(data) {
}
const trlog = tracer.console({
    // format : "{{timestamp}} <{{title}}> {{message}} (in {{file}}:{{line}})",
    format: "{{timestamp}} <{{title}}> [{{file}}:{{line}}]" + '<' + getProcInst() + '> ' + "{{message}}",
    dateformat: "HH:MM:ss.L",
});
// const log = require('electron-log')
// log.transports.console.level = 'verbose';
// module.exports = {
// 	TAG:'',
// 	info: function(fmt, ...args) {
// 		log.info(this.TAG+fmt, args)
// 	},
// 	verbose: function(fmt, ...args) {
// 		log.verbose(this.TAG+fmt, args)
// 	},
// 	error: function(fmt, ...args) {
// 		log.error(this.TAG+fmt, args)
// 	},
// 	tag:function(tagname) {
// 		this.TAG = '<'+tagname+'> ';
// 	}
// }
// module.exports = {
// 	verbose: trlog.trace,
// 	debug: trlog.debug,
// 	info: trlog.info,
// 	warn: trlog.warn,
// 	error: trlog.error,
// 	setLevel: tracer.setLevel
// }
function testlog() {
    console.log('testlog');
}
exports.testlog = testlog;
function getProcInst() {
    if (!isBrowser) {
        const cluster = require('cluster');
        if (cluster.worker) {
            return cluster.worker.id.toString();
        }
        else {
            return '0';
        }
    }
    else {
        return '0';
    }
}
const alog = {
    verbose: trlog.trace,
    debug: trlog.debug,
    info: trlog.info,
    warn: trlog.warn,
    error: trlog.error,
    setLevel: tracer.setLevel
};
// module.exports = alog
exports.default = alog;
//# sourceMappingURL=alog.js.map