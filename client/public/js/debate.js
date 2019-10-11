var socket = io.connect('http://localhost:3000');

function getUrlParams() {
  var params = {};
  window.location.search.replace(/[?&]+([^=&]+)=([^&]*)/gi, function(str, key, value) { params[key] = value; });
  return params;
}

var room;

var data = {
  nickname: '',
  message: ' 입장 하였습니다.'
};

window.onload = ()=>{
  var params = getUrlParams();
  data.message = params.person;
  room = params.room;
}


socket.on('chat message', (data) => {
  $('#messages').append($('<li>').text(data.nickname+": "+data.message));
  window.scrollTo(0, document.body.scrollHeight);
});

socket.emit('chat message', data);