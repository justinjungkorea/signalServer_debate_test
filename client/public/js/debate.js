var socket = io.connect('http://localhost:3000');

function getUrlParams() {
  var params = {};
  window.location.search.replace(/[?&]+([^=&]+)=([^&]*)/gi, function(str, key, value) { params[key] = value; });
  return params;
}

var data = {
  room: '',
  nickname: '',
  message: ' 입장'
};

var params = getUrlParams();
if(params.person==='1'){
  data.nickname = '사회자';
} else if(params.person === '2'){
  data.nickname = '참여자A';
} else {
  data.nickname = '참여자B';
}
data.room = params.room;


socket.emit('info', data);

socket.emit('chat message', data);

socket.on('chat message', (data) => {
  $('#messages').append($('<li>').text(data.nickname+": "+data.message));
  window.scrollTo(0, document.body.scrollHeight);
});

$('form').submit((e)=>{
  e.preventDefault();
  data.message = $('#m').val();
  socket.emit('chat message', data);
  $('#m').val('');
  return false;
});