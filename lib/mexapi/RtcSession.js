"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const MexMsg = require("./MexMsg");
const MexMsg_1 = require("./MexMsg");
const alog_1 = require("./alog");
class RtcSession {
    constructor(room, user_handle, tag) {
        this.userHandle = user_handle;
        this.tag = tag;
        this.room = room;
    }
    setOnLocalDescription(callback) {
        this.sdpCb = callback;
    }
    setOnCandidate(callback) {
        this.iceCb = callback;
    }
    addIceCandidate(candidate, callback) {
        const reqmsg = {
            method: MexMsg.Method.CANDIDATE,
            userHandle: this.userHandle,
            group: 'screen',
            groupType: 'sfu',
            candidate: candidate
        };
        this.room.request(reqmsg, (err, respmsg) => {
            if (respmsg.status == 200) {
                callback(undefined, 0);
            }
            else {
                callback(new Error('addIceCandidate error'), -1);
            }
        });
    }
    //현재 이 API는 안씀.
    setRemoteSessionDescription(sdp, callback) {
        const reqmsg = {
            method: MexMsg.Method.SDP,
            userHandle: this.userHandle,
            group: 'screen',
            groupType: 'sfu',
            sdp: sdp,
        };
        this.room.request(reqmsg, (err, respmsg) => {
            if (respmsg.status == 200) {
                callback(undefined, 0);
            }
        });
    }
    procSessionReq(reqmsg) {
        const method = reqmsg.method;
        if (method == MexMsg_1.Method.CANDIDATE) {
            if (this.iceCb) {
                const cmsg = reqmsg;
                this.iceCb(undefined, cmsg.candidate);
            }
            return 0;
        }
        else if (method == MexMsg_1.Method.SDP) {
            if (this.sdpCb) {
                const cmsg = reqmsg;
                this.sdpCb(undefined, cmsg.sdp);
            }
            return 0;
        }
        else {
            alog_1.default.info('### unknown method:', method);
            return -1;
        }
    }
    getUserHandle() {
        return this.userHandle;
    }
}
exports.RtcSession = RtcSession;
//# sourceMappingURL=RtcSession.js.map