commonFn.reqNo().then((reqResult)=>{
    inviteData.reqNo = reqResult;
    syncFn.setMultiType(masterRedis, slaveRedis, userInfo.ROOM_ID).then((result)=>{
        if (result === 'no data in redis') {		//처음초대했을때 ... 1:1 인지 다자간인지 체크
            if (data.targetId.length === 1) {
                inviteData.useMediaSvr = 'N';
            } else {
                inviteData.useMediaSvr = 'Y';
            }
        } else { 	// 처음초대가 아닌경우 .. 지속적인 다자간인지 1:1 인지 체크
            if (result.MULTITYPE === 'Y') {
                inviteData.useMediaSvr = 'Y';
            } else {
                if (data.targetId.length === 1) {
                    inviteData.useMediaSvr = 'N';
                } else {
                    inviteData.useMediaSvr = 'Y';
                }
            }
        }

        if (inviteData.useMediaSvr === 'Y') {
            //janus.
            if (commonFn.isSfu() === true) {
                signalSocketio.to(socketObj).emit('knowledgetalk', inviteData);
                logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의 / Invite] *\n* 현재 처리중 방향 : [Signal -> App (Req)] *\n* 수신자 : ' ${JSON.stringify(send_targetId)} ' *\n Invite 메시지 : ' ${JSON.stringify(inviteData)}`);
            } else {
                setTimeout(()=>{
                    fn_Kurento.checkMediaServerStatus(0, function (mediaServerStatus) {
                        if (mediaServerStatus === false) {
                            console.log("MEDIASERVER IS DEAD!!");
                        } else {
                            signalSocket.emit(socketObj, inviteData, data);
                            logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의 / Invite] *\n* 현재 처리중 방향 : [Signal -> App (Req)] *\n* 수신자 : '${JSON.stringify(send_targetId)}' *\n Invite 메시지 : ' ${JSON.stringify(inviteData)}`);
                        }
                    });
                }, 3000);
            }
            //janus end.
        } else {
            setTimeout(function () {
                signalSocket.emit(socketObj, inviteData, data);
                logger.log('info', `[Socket : ' ${data.eventOp} ' Event / 다자간 화상회의 / Invite] *\n* 현재 처리중 방향 : [Signal -> App (Req)] *\n* 수신자 : ' ${JSON.stringify(send_targetId)}' *\n Invite 메시지 :  ${JSON.stringify(inviteData)}`);
            }, 3000);
        }

        // 180803 ivypark, enterRoom Invite에 추가. invite 대상이 초대 팝업이 뜨면 방장이 나갔을 때 사라져야 함. 요청 : kt
        console.log('invite enterRoom -> ', send_targetId);
        syncFn.enterRoom(masterRedis, slaveRedis, roomId, send_targetId, inviteData.userName, socketObj, '', 'accept').then((userList)=>{
            if (count-- > 0) {
                enterRoom();
            }
        }).catch((err) => {
                console.log(`ivypark ::::::::::::: `, err);
                logger.log('warn', '사용자가 방에 정상적으로 참가되지 않았음.');
        });
    }).catch(() => {
            console.log('RoomsInfo에 Multitype setting 중 error ', '');
            logger.log('warn', 'RoomsInfo에 Multitype setting 중 error');
    });
}).catch(function () {
    console.log('ReqNo 다자간 화상회의 Invite error');
});