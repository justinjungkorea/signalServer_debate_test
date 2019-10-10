"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const WsTransCnn_1 = require("./WsTransCnn");
const alog_1 = require("./alog");
const MexMsg_1 = require("./MexMsg");
const RtcSession_1 = require("./RtcSession");
var ROOM_STATUS;
(function (ROOM_STATUS) {
    ROOM_STATUS[ROOM_STATUS["NORMAL"] = 0] = "NORMAL";
    ROOM_STATUS[ROOM_STATUS["DISCONNECTED"] = 1] = "DISCONNECTED";
    ROOM_STATUS[ROOM_STATUS["UNKNOWN"] = 2] = "UNKNOWN";
})(ROOM_STATUS = exports.ROOM_STATUS || (exports.ROOM_STATUS = {}));
class MexRoom {
    constructor(param, service, tag) {
        this.handleSeed = 0;
        this.sessions = new Map();
        const { serverUrl } = param;
        this.wscnn = new WsTransCnn_1.WsTransCnn();
        this.wscnn.connect(serverUrl, (status) => {
            if (!status) {
                alog_1.default.info('server connected');
            }
            else {
                alog_1.default.info('server disconnected');
                if (this.statusCb) {
                    this.close();
                    this.statusCb(ROOM_STATUS.DISCONNECTED);
                }
            }
        });
        this.wscnn.setOnRequestLis((req) => {
            const smsg = req.reqMsg;
            if (smsg.userHandle != undefined) {
                const ss = this.sessions.get(smsg.userHandle);
                if (ss) {
                    const ret = ss.procSessionReq(smsg);
                    if (!ret) {
                        req.response(MexMsg_1.RS.OK);
                    }
                    else {
                        req.response(MexMsg_1.RS.SERVER_ERROR);
                    }
                }
                else {
                    req.response(MexMsg_1.RS.NOT_FOUND, 'session not found');
                }
            }
            else {
                req.response(MexMsg_1.RS.BAD_REQUEST);
            }
        });
        const reqmsg = new MexMsg_1.CreateMexRoomReqMsg(service, tag);
        this.wscnn.requestMsg(reqmsg, (err, respmsg) => {
            alog_1.default.info('room created');
            const cresp = respmsg;
            this.msRoomId = cresp.msRoomId;
            if (this.statusCb) {
                this.statusCb(ROOM_STATUS.NORMAL);
            }
        });
    }
    /**
     * mex room을 종료하고 mex server와의 연결을 종료한다.
     *
     */
    close() {
        this.releaseRoom();
        if (this.wscnn) {
            this.wscnn.close();
            this.wscnn = null;
        }
        this.sessions.clear();
    }
    /**
     * room 상태 콜백을 등록한다.
     * callback status: 0 이면 room 생성 성공, 아니면 error 이며 이경우 더 이상 room을 사용할 수 없다.
     * @param callback
     */
    setOnStatus(callback) {
        this.statusCb = callback;
    }
    /**
     * mex room에 Webrtc session을 추가한다.
     *
     * @param type 현재 'sfu' 만 사용
     * @param group 현재는 'screen' 만 사용
     * @param dir mex서버를 기준으로한 media stream의 방향(ex, 화면공유자의 세션을 연결할 경우 room에는 'recvonly'로 추가해야함,
     *      화면수신자의 세션을 연결할 경우 'sendonly'로 추가해야 함.)
     * @param sdp client으로 부터 수신한 offer sdp
     * @param tag 디버깅 정보로서 log상에 session을 구별하기 위한 용도. 실제 동작에는 영함 미치지 않음.( recommend: 사용자id 값)
     * @param callback
     */
    addRtcSession(type, group, dir, sdp, tag, callback) {
        const user_handle = this.generateUserHandle();
        const ss = new RtcSession_1.RtcSession(this, user_handle, tag);
        this.sessions.set(user_handle, ss);
        alog_1.default.info('sdp:\n', sdp);
        const reqmsg = {
            method: MexMsg_1.Method.ADD_RTC_SESSION,
            userHandle: user_handle,
            group: group,
            groupType: type,
            mediaDir: dir,
            sdp: sdp,
            tag: tag
        };
        this.wscnn.requestMsg(reqmsg, (err, respmsg) => {
            console.log('wscnn.requestMsg, err : ', err, respmsg);

            if (respmsg.status == MexMsg_1.RS.OK) {
                callback(undefined, 0);
            }
            else {
                callback(new Error('### fail to add rtc'), -1);
            }
        });
        return ss;
    }
    removeSession(user_handle) {
        const ss = this.sessions.get(user_handle);
        if (ss) {
            const reqmsg = {
                method: MexMsg_1.Method.REMOVE_RTC_SESSION,
                userHandle: user_handle,
                group: 'screen',
                groupType: 'sfu'
            };
            this.wscnn.requestMsg(reqmsg, (respmsg) => {
            });
            this.sessions.delete(user_handle);
        }
    }
    releaseRoom() {
        if (this.msRoomId && this.wscnn) {
            const reqmsg = {
                method: MexMsg_1.Method.RELEASE_MEX_ROOM,
                msRoomId: this.msRoomId,
            };
            this.wscnn.requestMsg(reqmsg, respmsg => {
            });
            this.msRoomId = undefined;
        }
    }
    request(reqmsg, callback) {
        this.wscnn.requestMsg(reqmsg, callback);
    }
    generateUserHandle() {
        this.handleSeed++;
        return this.handleSeed;
    }
}
exports.MexRoom = MexRoom;
//# sourceMappingURL=MexRoom.js.map