/**
 * แจ้งเตือนทาง LINE เมื่อมีการจองห้องสำเร็จ (LINE Messaging API — LINE Notify ปิดบริการไปตั้งแต่ปี 2025)
 *
 * ค่าที่ต้องตั้ง (Script Properties):
 *  - LINE_CHANNEL_ACCESS_TOKEN  โทเคนของ Messaging API channel (ความลับ ตั้งเองในหน้า Project Settings เท่านั้น
 *                               ไม่มีคำสั่งไหนอ่านค่านี้ส่งกลับไปหน้าเว็บ)
 *  - LINE_TARGETS               รหัสผู้รับ (กลุ่ม C... / ผู้ใช้ U...) คั่นด้วยจุลภาค — ผู้ดูแลเลือกจากหน้า "ตั้งค่าข้อมูล > แจ้งเตือน LINE"
 *  - PUBLIC_SITE_URL            ที่อยู่หน้าเว็บสำหรับปุ่มในการ์ด (บันทึกจากหน้าตั้งค่าได้)
 *
 * การส่งไม่สำเร็จไม่ทำให้การจองล้มเหลว — การจองบันทึกไปแล้ว แค่จด AuditLogs ให้ผู้ดูแลตามแก้
 */

const PROP_LINE_TOKEN = 'LINE_CHANNEL_ACCESS_TOKEN';
const PROP_LINE_TARGETS = 'LINE_TARGETS';
const PROP_SITE_URL = 'PUBLIC_SITE_URL';
const PROP_LINE_CAPTURE_UNTIL = 'LINE_CAPTURE_UNTIL';
const PROP_LINE_SEEN = 'LINE_SEEN_SOURCES';
const PROP_LINE_LAST = 'LINE_LAST_RESULT';

/** หน้าเว็บที่เผยแพร่อยู่ — ใช้เมื่อผู้ดูแลยังไม่ได้บันทึกค่าเอง */
const DEFAULT_SITE_URL = 'https://tctatc.github.io/nasakorn-thaluang-room-booking2/';
const LINE_MAX_TARGETS = 5;
const LINE_CAPTURE_MINUTES = 10;

function siteUrl_() {
  const value = getProp_(PROP_SITE_URL);
  return value !== '' && Domain.isSafeSiteUrl(Domain.normalizeSiteUrl(value)) ? Domain.normalizeSiteUrl(value) : DEFAULT_SITE_URL;
}

function lineTargets_() {
  return Domain.parseLineTargets(getProp_(PROP_LINE_TARGETS));
}

function readJsonProp_(key, fallback) {
  try {
    const value = getProp_(key);
    return value === '' ? fallback : JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function lineFetch_(path, body) {
  const response = UrlFetchApp.fetch(`https://api.line.me/v2/bot/message/${path}`, {
    method: 'post',
    contentType: 'application/json',
    // X-Line-Retry-Key: ถ้า LINE ได้รับซ้ำ (เช่น เน็ตหลุดกลางทาง) จะไม่ส่งซ้ำให้ผู้รับ
    headers: { Authorization: `Bearer ${getProp_(PROP_LINE_TOKEN)}`, 'X-Line-Retry-Key': Utilities.getUuid() },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  return response.getResponseCode();
}

/** ส่งข้อความถึงผู้รับทุกราย — คืนสรุปผล ไม่ throw */
function sendLine_(messages) {
  if (getProp_(PROP_LINE_TOKEN) === '') return { sent: 0, failed: 0, skipped: 'ยังไม่ได้ใส่ LINE_CHANNEL_ACCESS_TOKEN' };
  const targets = lineTargets_();
  if (targets.length === 0) return { sent: 0, failed: 0, skipped: 'ยังไม่ได้เลือกกลุ่มหรือผู้รับ' };
  const codes = targets.map(function (to) {
    try {
      return lineFetch_('push', { to: to, messages: messages });
    } catch (error) {
      console.error(`ส่ง LINE ไม่สำเร็จ: ${error && error.message}`);
      return 0;
    }
  });
  const result = {
    at: nowIso_(), sent: codes.filter(function (code) { return code === 200; }).length,
    failed: codes.filter(function (code) { return code !== 200; }).length, codes: codes,
  };
  scriptProps_().setProperty(PROP_LINE_LAST, JSON.stringify(result));
  return result;
}

function lineInfoFromBooking_(booking) {
  return {
    bookingId: String(booking.bookingId), title: String(booking.title || ''),
    bookerName: String(booking.bookerName || booking.userName || ''), department: String(booking.department || ''),
    roomName: String(booking.customLocation || '') || String(booking.roomName || ''),
    dateKey: Domain.normalizeDateKey(booking.dateKey), startMin: Number(booking.startMin), endMin: Number(booking.endMin),
    status: String(booking.status), approvalStep: Number(booking.approvalStep) || 0,
    attachment: Domain.attachmentMetaFromRow(booking),
  };
}

/** เรียกหลังบันทึกการจองสำเร็จ (นอกล็อก) */
function notifyBookingCreated_(booking) {
  try {
    const result = sendLine_([Domain.bookingLineMessage(lineInfoFromBooking_(booking), siteUrl_())]);
    if (result.failed > 0) audit_('system', 'line.fail', 'booking', String(booking.bookingId), { codes: result.codes });
    return result;
  } catch (error) {
    console.error(`สร้างข้อความ LINE ไม่สำเร็จ: ${error && error.message}`);
    audit_('system', 'line.fail', 'booking', String(booking.bookingId), { error: String(error && error.message) });
    return { sent: 0, failed: 1 };
  }
}

/* ---------- หน้าตั้งค่าของผู้ดูแล ---------- */

function lineStatus_() {
  const captureUntil = Number(getProp_(PROP_LINE_CAPTURE_UNTIL)) || 0;
  return {
    hasToken: getProp_(PROP_LINE_TOKEN) !== '',
    targets: lineTargets_(),
    siteUrl: siteUrl_(),
    captureUntil: captureUntil > Date.now() ? new Date(captureUntil).toISOString() : '',
    seen: readJsonProp_(PROP_LINE_SEEN, []),
    last: readJsonProp_(PROP_LINE_LAST, null),
  };
}

function lineSave_(user, payload) {
  const raw = Array.isArray(payload.targets) ? payload.targets.join(',') : String(payload.targets || '');
  const targets = Domain.parseLineTargets(raw);
  if (targets.length > LINE_MAX_TARGETS) throw appError_(ERROR_CODES.VALIDATION, `เลือกผู้รับได้ไม่เกิน ${LINE_MAX_TARGETS} ราย`);
  const site = Domain.normalizeSiteUrl(String(payload.siteUrl || ''));
  if (payload.siteUrl && !Domain.isSafeSiteUrl(site)) {
    throw appError_(ERROR_CODES.VALIDATION, 'ที่อยู่หน้าเว็บต้องขึ้นต้นด้วย https://');
  }
  scriptProps_().setProperty(PROP_LINE_TARGETS, targets.join(','));
  if (payload.siteUrl) scriptProps_().setProperty(PROP_SITE_URL, site);
  audit_(user.email, 'line.save', 'settings', 'line', { targets: targets.length, siteUrl: site });
  return lineStatus_();
}

/** เปิดรับรหัสกลุ่ม 10 นาที — ระหว่างนี้ใครพิมพ์ในกลุ่มที่มีบอท รหัสกลุ่มจะขึ้นในหน้าตั้งค่าให้เลือก */
function lineCapture_(user) {
  scriptProps_().setProperty(PROP_LINE_CAPTURE_UNTIL, String(Date.now() + LINE_CAPTURE_MINUTES * 60 * 1000));
  audit_(user.email, 'line.capture', 'settings', 'line', {});
  return lineStatus_();
}

function lineTest_(user) {
  const today = Domain.toDateKey(serverNow_());
  const message = Domain.bookingLineMessage({
    bookingId: 'test', title: 'ทดสอบการแจ้งเตือน (ไม่ใช่การจองจริง)', bookerName: user.displayName, department: user.department,
    roomName: 'ห้องประชุมตัวอย่าง', dateKey: today, startMin: 9 * 60, endMin: 10 * 60, status: 'pending', approvalStep: 1,
    attachment: null,
  }, siteUrl_());
  const result = sendLine_([message]);
  audit_(user.email, 'line.test', 'settings', 'line', { sent: result.sent || 0, failed: result.failed || 0 });
  return { result: result, status: lineStatus_() };
}

/* ---------- webhook จาก LINE (ใช้ตอนตั้งค่าเท่านั้น) ---------- */

function isLineWebhook_(body) {
  return body && typeof body === 'object' && Array.isArray(body.events) && typeof body.action !== 'string';
}

/**
 * Apps Script อ่าน header X-Line-Signature ไม่ได้ จึงตรวจลายเซ็นของ LINE ไม่ได้
 * แทนด้วย: รับรหัสเฉพาะช่วง 10 นาทีที่ผู้ดูแลกดเปิดเอง และรหัสที่ได้เป็นแค่ "ตัวเลือก" — ผู้ดูแลต้องกดเลือกเองจึงมีผล
 * นอกช่วงนั้น webhook ไม่ทำอะไรเลย
 */
function handleLineWebhook_(body) {
  const captureUntil = Number(getProp_(PROP_LINE_CAPTURE_UNTIL)) || 0;
  if (captureUntil < Date.now()) return { ok: true };
  const seen = readJsonProp_(PROP_LINE_SEEN, []);
  body.events.slice(0, 20).forEach(function (event) {
    const source = (event && event.source) || {};
    const id = String(source.groupId || source.roomId || source.userId || '');
    if (!Domain.LINE_TARGET_PATTERN.test(id)) return;
    const existing = seen.filter(function (item) { return item.id === id; })[0];
    if (existing) existing.at = nowIso_();
    else seen.unshift({ id: id, kind: Domain.lineTargetKind(id), at: nowIso_() });
    if (event.replyToken && getProp_(PROP_LINE_TOKEN) !== '') {
      try {
        lineFetch_('reply', { replyToken: String(event.replyToken), messages: [{
          type: 'text', text: `ระบบจองห้องประชุมเห็น${Domain.lineTargetKind(id)}นี้แล้ว\nกลับไปที่หน้า "ตั้งค่าข้อมูล > แจ้งเตือน LINE" แล้วกดเลือกเพื่อเริ่มรับแจ้งเตือน`,
        }] });
      } catch (error) {
        console.warn(`ตอบกลับในกลุ่มไม่สำเร็จ: ${error && error.message}`);
      }
    }
  });
  scriptProps_().setProperty(PROP_LINE_SEEN, JSON.stringify(seen.slice(0, 10)));
  return { ok: true };
}
