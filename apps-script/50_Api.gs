/**
 * ประตูเดียวที่หน้าเว็บคุยกับ server
 *
 * รูปแบบคำขอ (POST): { "action": "ชื่อคำสั่ง", "token": "session token", "payload": {...} }
 * รูปแบบคำตอบสำเร็จ: { "ok": true, "data": {...} }
 * รูปแบบคำตอบล้มเหลว: { "ok": false, "error": { "code": "...", "message": "ข้อความไทย", "issues": [...] } }
 *
 * หมายเหตุสำคัญ: Apps Script ตอบ HTTP 200 เสมอแม้มีข้อผิดพลาด
 * หน้าเว็บจึงต้องดูฟิลด์ ok ไม่ใช่ดู HTTP status
 *
 * ส่ง Content-Type เป็น text/plain จากหน้าเว็บ เพื่อให้เบราว์เซอร์ไม่ต้องยิง preflight
 * (Apps Script ไม่มีทางตั้ง CORS header เองได้ คำขอจึงต้องเป็นแบบ simple request)
 */

function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : '';

  try {
    if (action === 'version') {
      // endpoint เบาที่สุดสำหรับให้หน้าเว็บถามทุก 15 วินาทีว่ามีอะไรเปลี่ยนไหม
      return jsonOutput_({ ok: true, data: { dataVersion: getDataVersion_(), serverTime: nowIso_() } });
    }
    return jsonOutput_({
      ok: true,
      data: { service: 'ระบบจองห้องประชุม', serverTime: nowIso_() },
    });
  } catch (error) {
    return jsonOutput_(errorEnvelope_(error));
  }
}

function doPost(e) {
  let request;
  try {
    const body = parseBody_(e);
    // LINE ส่ง webhook มาที่ URL เดียวกัน (ใช้ตอนผู้ดูแลเลือกกลุ่มรับแจ้งเตือน ดู 47_Line.gs)
    if (isLineWebhook_(body)) return jsonOutput_(handleLineWebhook_(body));
    request = parseRequest_(body);
  } catch (error) {
    return jsonOutput_(errorEnvelope_(error));
  }

  try {
    const handler = apiHandlers_()[request.action];
    if (handler === undefined) {
      throw appError_(ERROR_CODES.BAD_REQUEST, `ไม่รู้จักคำสั่ง "${request.action}"`);
    }
    return jsonOutput_({ ok: true, data: handler(request.payload, request.token) });
  } catch (error) {
    console.error(`คำสั่ง ${request.action} ล้มเหลว: ${error && error.message}`);
    return jsonOutput_(errorEnvelope_(error));
  }
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw appError_(ERROR_CODES.BAD_REQUEST, 'ไม่พบข้อมูลคำขอ');
  }
  try {
    const body = JSON.parse(e.postData.contents);
    return body && typeof body === 'object' ? body : {};
  } catch (error) {
    throw appError_(ERROR_CODES.BAD_REQUEST, 'รูปแบบข้อมูลคำขอไม่ถูกต้อง');
  }
}

function parseRequest_(body) {
  const action = typeof body.action === 'string' ? body.action : '';
  if (action === '') throw appError_(ERROR_CODES.BAD_REQUEST, 'ไม่ได้ระบุคำสั่ง');

  return {
    action: action,
    token: typeof body.token === 'string' ? body.token : '',
    payload: body.payload === undefined || body.payload === null ? {} : body.payload,
  };
}

/**
 * ตารางคำสั่งทั้งหมด
 * โมดูลที่เพิ่มภายหลัง (ห้องประชุม การจอง รายงาน) จะมาเพิ่มรายการในนี้
 */
function apiHandlers_() {
  return {
    // ไม่ต้องล็อกอิน
    ping: function () {
      return { pong: true, serverTime: nowIso_() };
    },
    // ไม่ต้องล็อกอิน — ผู้จองทั่วไป (ดูกติกาความปลอดภัยใน 65_Public.gs)
    publicBootstrap: function () { return publicBootstrap_(); },
    publicSchedule: function (payload) { return publicSchedule_(payload || {}); },
    guestBooking: function (payload) { return guestBooking_(payload || {}); },
    trackBooking: function (payload) { return trackBooking_(payload || {}); },
    trackCancel: function (payload) { return trackCancel_(payload || {}); },
    // เอกสารแนบด้วยรหัสติดตาม (ผู้จองทั่วไป) — รหัสติดตามคือกุญแจของคำขอนั้น
    trackAttachment: function (payload) { return trackAttachment_(payload || {}); },
    login: function (payload) {
      return login_(payload || {});
    },
    loginPin: function (payload) {
      return loginPin_(payload || {});
    },

    // ต้องล็อกอิน
    me: function (payload, token) {
      return { user: authenticate_(token) };
    },
    bootstrap: function (payload, token) {
      const user = authenticate_(token);
      return {
        user: user,
        settings: readSettings_(),
        dataVersion: getDataVersion_(),
        serverTime: nowIso_(),
      };
    },
    // ไม่มี token = ผู้จองทั่วไป เห็นห้องทั้งหมด / มี token = ตรวจสิทธิ์ห้องรายบุคคลตามเดิม
    rooms: function (payload, token) { return token ? listRooms_(authenticate_(token)) : publicRooms_(); },
    bookings: function (payload, token) { return listBookings_(authenticate_(token), payload || {}); },
    roomSlotsToday: function () { return roomSlotsToday_(); },
    // ช่วงเวลาที่ไม่ว่าง (ไม่มีชื่อ/หัวข้อ) — ฟอร์มจองของผู้จองทั่วไปต้องใช้ จึงไม่ต้องล็อกอิน
    availability: function (payload) { return roomAvailability_(null, payload || {}); },
    createBooking: function (payload, token) { return createBooking_(authenticate_(token), payload); },
    cancelBooking: function (payload, token) { return cancelBooking_(authenticate_(token), payload || {}); },
    // ผู้ลงนามแต่ละขั้น (ไม่ใช่ admin) — decideBooking_ ตรวจว่าเป็นขั้นของคนนี้หรือไม่
    decideBooking: function (payload, token) { return decideBooking_(authenticate_(token), payload || {}); },
    // ผู้ดูแลเท่านั้น: แก้/ลบคำขอที่ส่งมาแล้ว และล้างข้อมูลการจองเพื่อเริ่มบันทึกใหม่ (ดู 62_AdminBookings.gs)
    adminUpdateBooking: function (payload, token) { return adminUpdateBooking_(requireAdmin_(token), payload || {}); },
    adminDeleteBooking: function (payload, token) { return adminDeleteBooking_(requireAdmin_(token), payload || {}); },
    adminResetBookings: function (payload, token) { return adminResetBookings_(requireAdmin_(token), payload || {}); },
    // เปิดเอกสารแนบ — เฉพาะผู้จอง ผู้ลงนาม และผู้ดูแล (ตรวจใน bookingAttachment_)
    bookingAttachment: function (payload, token) { return bookingAttachment_(authenticate_(token), payload || {}); },
    announcements: function (payload, token) { return listAnnouncements_(authenticate_(token)); },
    saveAnnouncement: function (payload, token) { return saveAnnouncement_(requireAdmin_(token), payload || {}); },
    archiveAnnouncement: function (payload, token) { return archiveAnnouncement_(requireAdmin_(token), payload || {}); },

    // รีวิวหลังใช้ห้อง — คะแนนเฉลี่ยทุกคนเห็น ความคิดเห็นเฉพาะผู้ดูแล (และเจ้าของรีวิว)
    reviewSummary: function (payload, token) { authenticate_(token); return reviewSummary_(); },
    reviews: function (payload, token) { return listReviews_(authenticate_(token)); },
    submitReview: function (payload, token) { return submitReview_(authenticate_(token), payload || {}); },

    // ข้อมูลตั้งต้นและห้องประชุม — ทุกคนอ่านได้ แก้ได้เฉพาะผู้ดูแล
    // ผู้จองทั่วไปได้รายการตัวเลือกแต่ไม่ได้หมายเหตุ (เช่นชื่อหัวหน้าแผนก) — ไม่จำเป็นต่อการจอง
    lookups: function (payload, token) {
      if (token) { authenticate_(token); return listLookups_(); }
      return { lookups: listLookups_().lookups.map(function (item) { return Object.assign({}, item, { note: '' }); }) };
    },
    saveLookup: function (payload, token) { return saveLookup_(requireAdmin_(token), payload || {}); },
    archiveLookup: function (payload, token) { return archiveLookup_(requireAdmin_(token), payload || {}); },
    saveRoom: function (payload, token) { return saveRoom_(requireAdmin_(token), payload || {}); },
    deleteRoom: function (payload, token) { return deleteRoom_(requireAdmin_(token), payload || {}); },

    // แจ้งเตือน LINE — เฉพาะผู้ดูแล (โทเคนไม่เคยถูกส่งกลับ บอกแค่ว่าตั้งแล้วหรือยัง)
    lineStatus: function (payload, token) { requireAdmin_(token); return lineStatus_(); },
    lineSave: function (payload, token) { return lineSave_(requireAdmin_(token), payload || {}); },
    lineCapture: function (payload, token) { return lineCapture_(requireAdmin_(token)); },
    lineTest: function (payload, token) { return lineTest_(requireAdmin_(token)); },

    // จัดการผู้ใช้ — เฉพาะผู้ดูแล
    users: function (payload, token) { requireAdmin_(token); return listUsers_(); },
    createUser: function (payload, token) { return createUser_(requireAdmin_(token), payload || {}); },
    updateUser: function (payload, token) { return updateUser_(requireAdmin_(token), payload || {}); },
    resetUserPin: function (payload, token) { return resetUserPin_(requireAdmin_(token), payload || {}); },
    resetUserPassword: function (payload, token) { return resetUserPassword_(requireAdmin_(token), payload || {}); },
    deleteUser: function (payload, token) { return deleteUser_(requireAdmin_(token), payload || {}); },
  };
}

function errorEnvelope_(error) {
  const code = (error && error.appCode) || ERROR_CODES.INTERNAL;
  const message =
    code === ERROR_CODES.INTERNAL
      ? 'ระบบขัดข้อง กรุณาลองอีกครั้ง หากยังเกิดซ้ำให้แจ้งผู้ดูแลระบบ'
      : (error && error.message) || 'เกิดข้อผิดพลาด';

  const envelope = { ok: false, error: { code: code, message: message } };
  if (error && error.appDetails !== undefined) envelope.error.issues = error.appDetails;

  // ข้อผิดพลาดที่ไม่คาดคิด ต้องขึ้น log ให้ครบเพื่อตามแก้ได้ แต่ไม่ส่งรายละเอียดภายในให้ client
  if (code === ERROR_CODES.INTERNAL && error) {
    console.error(`ข้อผิดพลาดที่ไม่คาดคิด: ${error.message}\n${error.stack || ''}`);
  }
  return envelope;
}

function jsonOutput_(object) {
  return ContentService.createTextOutput(JSON.stringify(object)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
