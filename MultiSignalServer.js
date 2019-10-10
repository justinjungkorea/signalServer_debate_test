const http         = require('http');
const https        = require('https');
const express      = require('express');
const fs           = require('fs');
const path         = require('path');
const favicon      = require('serve-favicon');
const logger       = require('morgan');
const socketio     = require('./js/signal.socket.service.io');

const {commonConfig, setConfig} = require('./common/common.config');
const ini = require('ini');
const cluster = require('cluster');
const numCPUs = require('os').cpus().length;

let pid;

if (cluster.isMaster) {
   for (var i = 0; i < 1; i++) {
      cluster.fork();
   }

   cluster.on('online', function(worker) {
       console.log('worker ' + worker.process.pid + ' created.');
   });

   cluster.on('exit', function(worker, code, signal) {
      console.log('worker ' + worker.process.pid + ' died');
      //cluster.fork();
   });

} else {

    pid = process.pid;

    let config = ini.parse(fs.readFileSync('./config.ini', 'utf-8'));
    console.log(config);

    setConfig(config, function() {
        const app = express();
        const port = commonConfig.port;

        app.use(logger('dev'));
        app.use(express.static(path.join(__dirname, '/')));

        const options = {
            key  : fs.readFileSync('./SSL/knowledgetalk.key'),
            cert : fs.readFileSync('./SSL/knowledgetalk.pem')
        };

        const server = https.createServer(options, app).listen(port, function() {
            console.log('::: HTTPS ::: Signal Server Started - PORT : ' + port);
        });

        // 18.03.13 ivypark // cluster ++ //
        socketio(server, pid, cluster.worker.id);
    });
}
