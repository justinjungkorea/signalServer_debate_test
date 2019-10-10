"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const WsTransCnn_1 = require("./WsTransCnn");
/**
 * Response Status Code
 */
var RS;
(function (RS) {
    RS[RS["OK"] = 200] = "OK";
    RS[RS["BAD_REQUEST"] = 400] = "BAD_REQUEST";
    RS[RS["NOT_FOUND"] = 404] = "NOT_FOUND";
    RS[RS["SERVER_ERROR"] = 500] = "SERVER_ERROR";
    RS[RS["SERVICE_UNAVAIL"] = 503] = "SERVICE_UNAVAIL";
})(RS = exports.RS || (exports.RS = {}));
exports.Method = {
    CREATE_MEX_ROOM: 'createMexRoom',
    ADD_RTC_SESSION: 'addRtcSession',
    REMOVE_RTC_SESSION: 'removeRtcSession',
    CANDIDATE: 'candidate',
    SDP: 'SDP',
    RELEASE_MEX_ROOM: 'releaseRoom',
};
class SessionReqMsg extends WsTransCnn_1.RequestMsg {
}
exports.SessionReqMsg = SessionReqMsg;
class CreateMexRoomReqMsg extends WsTransCnn_1.RequestMsg {
    constructor(service, tag) {
        super(exports.Method.CREATE_MEX_ROOM);
        this.service = service;
        this.tag = tag;
    }
}
exports.CreateMexRoomReqMsg = CreateMexRoomReqMsg;
class CreateMexRoomRespMsg extends WsTransCnn_1.ResponseMsg {
}
exports.CreateMexRoomRespMsg = CreateMexRoomRespMsg;
class ReleaseMexRoomReqMsg extends WsTransCnn_1.RequestMsg {
}
exports.ReleaseMexRoomReqMsg = ReleaseMexRoomReqMsg;
class AddRtcSessionReqMsg extends SessionReqMsg {
}
exports.AddRtcSessionReqMsg = AddRtcSessionReqMsg;
class CandidateReqMsg extends SessionReqMsg {
}
exports.CandidateReqMsg = CandidateReqMsg;
class SdpReqMsg extends SessionReqMsg {
}
exports.SdpReqMsg = SdpReqMsg;
//# sourceMappingURL=MexMsg.js.map