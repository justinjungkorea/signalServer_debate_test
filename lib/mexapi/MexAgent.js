"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const MexRoom_1 = require("./MexRoom");
/**
 *
 * @param url mex 서버 websocket url, ex) ws://215.145.218.225:3010
 * @param service 현재는 'sfu' 만 사용
 * @param tag 디버깅 정보로서 room을 log상에서 구별하기 위한용도. 실제 동작에는 영향을 주지 않는다.
 *
 * RETURN VALUE 생성한 MexRoom ojbect return. return 받은 즉시 MexRoom object에 콜백을 설정해야한다.
 */
function createMexRoom(url, service, tag) {
    const param = {
        serverUrl: url,
    };
    const room = new MexRoom_1.MexRoom(param, service, tag);
    return room;
}
exports.createMexRoom = createMexRoom;
//# sourceMappingURL=MexAgent.js.map