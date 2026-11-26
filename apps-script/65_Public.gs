/**
 * คำสั่งที่ไม่ต้องเข้าสู่ระบบ — ผู้จองทั่วไปจองห้อง ดูปฏิทิน และติดตามสถานะด้วยรหัสติดตาม
 *
 * กติกาของไฟล์นี้ (ทุกคำสั่งที่นี่ใครก็เรียกได้จากอินเทอร์เน็ต):
 *  - ส่งออกเฉพาะข้อมูลที่จำเป็น: ปฏิทินมีแค่ห้อง วัน เวลา สถานะ — ไม่มีชื่อ หัวข้อ หรือเบอร์ของใคร
 *  - รายละเอียดคำขอเปิดได้ด้วยรหัสติดตามเท่านั้น (สุ่ม ~50 บิต และจำกัดการค้นผิดต่อชั่วโมง)
 *  - การเขียนทุกครั้งผ่านกฎเดียวกับผู้ใช้ที่ล็อกอิน (createBookingAs_ ตรวจในล็อก) และยังต้องอนุมัติ 3 ขั้น
 *  - จำกัดจำนวนคำขอต่อชั่วโมงทั้งระบบ และจำนวนคำขอค้างต่อเบอร์โทร กันคนยิงคำขอปลอมจนห้องเต็ม
 */

/** รหัสติดตามจาก UUID v4 สองชุด (ใช้ตัวสุ่มที่ปลอดภัยของระบบ) — ทิ้งไบต์ที่ทำให้เอียงใน Domain */
function newTrackingCode_() {
  const hex = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  const bytes = [];
  for (let i = 0; i + 1 < hex.length; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
  // UUID v4 มีบิตคงที่ (version/variant) ที่ไบต์ 6 และ 8 ของแต่ละชุด — ตัดทิ้งไม่ให้ลดความสุ่ม
  const random = bytes.filter(function (_byte, index) { return index % 16 !== 6 && index % 16 !== 8; });
  return Domain.trackingCodeFromBytes(random);
}

/**
 * นับครั้งต่อชั่วโมงทั้งระบบ เกินแล้วปฏิเสธ — CacheService ไม่บวกแบบอะตอมมิก จึงอาจนับขาดเล็กน้อยเมื่อยิงพร้อมกัน
 * พอสำหรับกันการยิงรัว ๆ (ตัวตัดสินจริงเรื่องห้องว่างยังอยู่ในล็อกเสมอ)
 */
function hourlyLimitReached_(name, limit) {
  const cached = CacheService.getScriptCache().get(`${name}:${Math.floor(Date.now() / 3600000)}`);
  return Number(cached || 0) >= limit;
}

function countHourly_(name) {
  const cache = CacheService.getScriptCache();
  const key = `${name}:${Math.floor(Date.now() / 3600000)}`;
  cache.put(key, String(Number(cache.get(key) || 0) + 1), 3700);
}

/** ค่าที่หน้าเว็บต้องใช้ก่อนเข้าสู่ระบบ (กฎการจองสำหรับฟอร์ม) */
function publicBootstrap_() {
  return { settings: readSettings_(), dataVersion: cachedDataVersion_(), serverTime: nowIso_() };
}

/** ห้องทั้งหมด — ผู้จองทั่วไปไม่มีการจำกัดห้องรายบุคคล (การจำกัดใช้กับบัญชีที่ล็อกอินเท่านั้น) */
function publicRooms_() {
  return { rooms: cachedRooms_() };
}

function publicSchedule_(raw) {
  const parsed = Domain.validateScheduleRange(raw);
  if (!parsed.ok) throw appError_(ERROR_CODES.VALIDATION, 'ช่วงวันที่ไม่ถูกต้อง', parsed.issues);
  const rows = readHotColumns_(Domain.SHEET_BOOKINGS, Domain.BOOKING_HOT_COLUMNS).objects;
  return { slots: Domain.publicSlotsBetween(rows, parsed.value.from, parsed.value.to) };
}

function guestBooking_(raw) {
  // ช่องดักบอท: คนจริงมองไม่เห็นช่องนี้ ถ้ามีค่ามาแปลว่าโปรแกรมกรอกเอง
  if (raw && raw.website) throw appError_(ERROR_CODES.VALIDATION, 'ส่งคำขอไม่สำเร็จ กรุณาลองใหม่');
  const parsed = Domain.validateBookingRequest(raw);
  if (!parsed.ok) throw appError_(ERROR_CODES.VALIDATION, 'ข้อมูลการจองไม่ถูกต้อง', parsed.issues);
  const input = parsed.value;
  const issues = Domain.guestRequesterIssues(input);
  if (issues.length) throw appError_(ERROR_CODES.VALIDATION, issues[0].message, issues);
  if (hourlyLimitReached_('guest-bookings', Domain.GUEST_BOOKINGS_PER_HOUR)) {
    throw appError_(ERROR_CODES.BUSY, 'มีคำขอจองเข้ามามากผิดปกติ ระบบหยุดรับชั่วคราว กรุณาลองใหม่ในอีกสักครู่ หรือติดต่อเจ้าหน้าที่');
  }
  const guest = {
    email: Domain.guestAccountId(input.requesterPhone), displayName: input.bookerName,
    department: input.department, role: 'guest', allowedRoomIds: [],
  };
  const result = createBookingAs_(guest, input, parseAttachment_(raw));
  countHourly_('guest-bookings');
  return result;
}

function findByTrackingCode_(raw) {
  const code = Domain.normalizeTrackingCode(raw);
  if (hourlyLimitReached_('tracking-misses', Domain.TRACKING_MISSES_PER_HOUR)) {
    throw appError_(ERROR_CODES.BUSY, 'มีการค้นรหัสผิดหลายครั้ง ปิดการค้นชั่วคราว กรุณาลองใหม่ภายหลัง');
  }
  const row = code === '' ? null : readAll_(Domain.SHEET_BOOKINGS).objects.find(function (item) {
    return String(item.trackingCode) === code;
  });
  if (!row) {
    countHourly_('tracking-misses');
    throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบคำขอจากรหัสนี้ ตรวจรหัสอีกครั้ง (10 ตัว เช่น ABCDE-FGHJK)');
  }
  return row;
}

/** รายละเอียดคำขอของเจ้าของรหัส — พร้อมชื่อห้องสำหรับพิมพ์แบบฟอร์ม */
function trackBooking_(payload) {
  const row = findByTrackingCode_(payload && payload.code);
  const roomRow = findByKey_(Domain.SHEET_ROOMS, String(row.roomId));
  return { booking: publicBooking_(row, 'owner'), room: roomRow ? publicRoom_(roomRow) : null };
}

function trackCancel_(payload) {
  const reason = String((payload && payload.reason) || '').trim().slice(0, 300);
  return withScriptLock_(function () {
    const row = findByTrackingCode_(payload && payload.code);
    if (['pending', 'confirmed'].indexOf(String(row.status)) < 0) {
      throw appError_(ERROR_CODES.CONFLICT, 'คำขอนี้ยกเลิกไม่ได้แล้ว');
    }
    const cancelRule = Domain.canCancelBooking({
      startInstant: Domain.fromDateKeyAndMinutes(Domain.normalizeDateKey(row.dateKey), Number(row.startMin)),
      now: serverNow_(), settings: readSettings_(), isAdmin: false,
    });
    if (!cancelRule.ok) throw appError_(ERROR_CODES.FORBIDDEN, cancelRule.message);
    const now = nowIso_();
    const patch = { status: 'cancelled', cancelReason: reason, updatedBy: String(row.userEmail), updatedAt: now };
    updateByKey_(Domain.SHEET_BOOKINGS, String(row.bookingId), patch);
    audit_(String(row.userEmail), 'booking.cancel.tracking', 'booking', String(row.bookingId), { reason: reason });
    bumpDataVersion_();
    return { booking: publicBooking_(Object.assign({}, row, patch), 'owner') };
  });
}
