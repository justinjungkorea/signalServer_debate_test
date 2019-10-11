const https = require('https');
const fs = require('fs');
const express = require('express');
const app = require('express')();
const path = require('path');
const PORT = 5000;

app.set('views', path.join(__dirname,'/'));
app.set('view engine','html');

app.use(express.static('public'));

const options = {
    key: fs.readFileSync('./ssl/test.pem'),
    cert: fs.readFileSync('./ssl/test2.pem')
};

https.createServer(options, app).listen(PORT, ()=>{
    console.log(`✅ Server running on https://localhost:${PORT}`);
});
