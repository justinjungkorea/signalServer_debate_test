document.addEventListener('DOMContentLoaded', function(){
  const inputId = document.getElementById('inputId');
  const inputPw = document.getElementById('inputPw');
  const loginBtn = document.getElementById('loginBtn');
  const joinBtn = document.getElementById('joinBtn');
  const exitBtn = document.getElementById('exitBtn');
  const localVideo = document.getElementById('localVideo');
  const remoteVideo = document.getElementById('remoteVideo');
  
  let reqNo = 1;
  let localStream;
  let peerCon;
  
  
  loginBtn.addEventListener('click', function (e) {
      let loginData = {
          eventOp: 'Login',
          reqNo: reqNo++,
          userId: inputId.value,
          userPw: inputPw.value,
          reqDate: nowDate(),
          deviceType: 'pc'
      };
      try {
          console.log('send(login)', loginData);
          signalSocketIo.emit('knowledgetalk', loginData);
          signalSocketIo.emit('target',signalSocketIo.id)
      } catch (err) {
          if (err instanceof SyntaxError) {
              alert(' there was a syntaxError it and try again : ' + err.message);
          } else {
              throw err;
          }
      }
  });
  
  joinBtn.addEventListener('click', function (e) {
      let joinData = {
          eventOp: 'Join',
          reqNo: reqNo++,
          reqDate: nowDate(),
          userId: inputId.value,
          roomId,
          status: 'accept'
      };
      
      try {
          console.log('send(join)', joinData);
          signalSocketIo.emit('knowledgetalk', joinData);
      } catch (err) {
          if (err instanceof SyntaxError) {
              alert(' there was a syntaxError it and try again : ' + err.message);
          } else {
              throw err;
          }
      }
  });
  
  exitBtn.addEventListener('click', function (e) {
      localVideo.srcObject = null;
      remoteVideo.srcObject = null;
      let callEndData = {
          eventOp: 'ExitRoom',
          reqNo: reqNo,
          userId: inputId.value,
          reqDate: nowDate(),
          roomId
      };
  
      try {
          console.log('send', callEndData);
          signalSocketIo.emit('knowledgetalk', callEndData);
          if (window.roomId) {
              window.roomId = null;
          }
  
      } catch (err) {
          if (err instanceof SyntaxError) {
              alert('there was a syntaxError it and try again:' + err.message);
          } else {
              throw err;
          }
      }
  });
  
  function onIceCandidateHandler(e) {
      if (!e.candidate) return;
  
      let iceData = {
          eventOp: 'Candidate',
          candidate: e.candidate,
          useMediaSvr: 'N',
          usage: 'cam',
          userId: inputId.value,
          roomId,
          reqNo: reqNo++,
          reqDate: nowDate()
      };
  
      try {
          console.log('send(onIceCandidateHandler)', iceData);
          signalSocketIo.emit('knowledgetalk', iceData);
      } catch (err) {
          if (err instanceof SyntaxError) {
              alert(' there was a syntaxError it and try again : ' + err.message);
          } else {
              throw err;
          }
      }
  }
  
  function onAddStreamHandler(e) {
      remoteVideo.srcObject = e.streams[0];
  }
  
  signalSocketIo.on('knowledgetalk', function(data){
      console.log('receive', data.eventOp, data.signalOp, data);

      if (!data.eventOp && !data.signalOp) {
          console.log('error', 'eventOp undefined');
      }
  
      if(data.eventOp === 'Login'){
          loginBtn.disabled = true;
      }
  
      if(data.eventOp === 'Invite'){
          roomId = data.roomId;
          joinBtn.disabled = false;
      }
  
      if(data.eventOp === 'Join'){
          joinBtn.disabled = true;
          
          navigator.mediaDevices
          .getUserMedia({video:true, audio:true})
          .then(stream => {
              localStream = stream;
              localVideo.srcObject = localStream;
  
              roomId = data.roomId;
              peerCon = new RTCPeerConnection(configuration);
              peerCon.onicecandidate = onIceCandidateHandler;
  
              peerCon.ontrack = onAddStreamHandler;
              localStream.getTracks().forEach(function(track){
                  peerCon.addTrack(track, localStream);
              });


              peerCon.createOffer().then(sdp => {
                  peerCon.setLocalDescription(new RTCSessionDescription(sdp));
  
                  let sdpData = {
                      eventOp: 'SDP',
                      sdp,
                      useMediaSvr: 'N',
                      usage: 'cam',
                      userId: inputId.value,
                      roomId,
                      reqNo: reqNo++,
                      reqDate: nowDate()
                  };
  
                  try {
                      console.log('send(offerdata)', sdpData);
                      signalSocketIo.emit('knowledgetalk', sdpData);
                  } catch (err) {
                      if (err instanceof SyntaxError) {
                          alert(
                              ' there was a syntaxError it and try again : ' + err.message
                          );
                      } else {
                          throw err;
                      }
                  }
              })
          })
      }
  
      if(data.eventOp === 'SDP' && data.sdp.type === 'answer'){
          peerCon.setRemoteDescription(data.sdp);
      }
  
      if(data.eventOp === 'Candidate'){
          peerCon.addIceCandidate(new RTCIceCandidate(data.candidate));
  
          let iceData = {
              eventOp: 'Candidate',
              roomId: data.roomId,
              reqNo: data.reqNo,
              resDate: nowDate(),
              code: '200'
          };
  
          try {
              console.log('send(icedata)', iceData);
              signalSocketIo.emit('knowledgetalk', iceData);
          } catch (err) {
              if (err instanceof SyntaxError) {
                  alert(' there was a syntaxError it and try again : ' + err.message);
              } else {
                  throw err;
              }
          }
      }
  
      if(data.signalOp === 'Presence' && data.action === 'exit'){
          localVideo.srcObject = null;
          remoteVideo.srcObject = null;
      }
  
  })

  signalSocketIo.on('target', data => {
      console.log('receive',data);
  })
})