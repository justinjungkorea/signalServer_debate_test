const express = require('express');
const app = express();
const http = require('http').createServer(app);
const PORT = 7878;
const redis = require('redis');
const JSON = require('JSON');
const bodyParser = require('body-parser');
const client = redis.createClient(6379,'127.0.0.1');

app.use(bodyParser.json());

app.get('/', (req,res)=>{
    res.send('<h1>Hello World</h1>')
});

app.use(function(req,res,next){
    req.cache = client;
    next();
});

app.post('/profile', (req,res,next)=>{
    req.accepts('application/json');

    var key = req.body.name;
    var value = JSON.stringify(req.body);

    req.cache.set(key,value,(err,data)=>{
        if(err){
                console.log(err);
                res.send("error "+err);
                return;
        }

        req.cache.expire(key,60);
        res.json(value);
    });

});

app.get('/profile/:name', (req,res,next)=>{
    var key = req.params.name;

    req.cache.get(key, (err,data)=>{
        if(err){
            console.log(err);
            res.send("error"+err);
            return;
        }

        var value = JSON.parse(data);
        res.json(value);
    });
});

http.listen(7878, ()=>{
    console.log(`✅ Signal Server is running on http://localhost:${PORT}`);
})