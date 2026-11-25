/**
 * เอกสารแนบของคำขอจอง — เก็บใน Google Drive ของผู้ติดตั้งแบบส่วนตัว (ไม่เปิดแชร์ลิงก์)
 *
 * ทำไมไม่ใช้ลิงก์ Drive ตรง ๆ: ลิงก์แบบ "ทุกคนที่มีลิงก์" ส่งต่อกันได้ไม่มีที่สิ้นสุด
 * ไฟล์จึงออกจากระบบได้ทางเดียวคือคำสั่ง bookingAttachment / trackAttachment ซึ่งตรวจสิทธิ์ทุกครั้ง:
 *  - ผู้ดูแลและผู้ลงนามทั้ง 3 ขั้น (เห็นทุกคำขออยู่แล้ว)
 *  - เจ้าของคำขอที่เข้าสู่ระบบ
 *  - ผู้จองทั่วไปที่ถือรหัสติดตามของคำขอนั้น
 * ทุกครั้งที่เปิดไฟล์ บันทึกลง AuditLogs ว่าใครเปิด
 */

const PROP_ATTACHMENT_FOLDER_ID = 'ATTACHMENT_FOLDER_ID';
const ATTACHMENT_FOLDER_NAME = 'ระบบจองห้องประชุม - เอกสารแนบ (ห้ามแชร์โฟลเดอร์นี้)';

function attachmentFolder_() {
  const id = getProp_(PROP_ATTACHMENT_FOLDER_ID);
  if (id !== '') {
    try {
      const folder = DriveApp.getFolderById(id);
      if (!folder.isTrashed()) return folder;
    } catch (error) {
      console.warn(`เปิดโฟลเดอร์เอกสารแนบเดิมไม่ได้ (${error && error.message}) — สร้างใหม่`);
    }
  }
  const folder = DriveApp.createFolder(ATTACHMENT_FOLDER_NAME);
  scriptProps_().setProperty(PROP_ATTACHMENT_FOLDER_ID, folder.getId());
  return folder;
}

/** ตรวจไฟล์ที่ส่งมากับคำขอจอง (ก่อนเข้าล็อก) — ไม่มีไฟล์ = null */
function parseAttachment_(raw) {
  const parsed = Domain.validateAttachmentUpload(raw && raw.attachment, Domain.ATTACHMENT_MAX_BYTES);
  if (!parsed.ok) throw appError_(ERROR_CODES.VALIDATION, parsed.issues[0].message, parsed.issues);
  return parsed.value;
}

function saveAttachmentFile_(bookingId, upload) {
  const blob = Utilities.newBlob(Utilities.base64Decode(upload.dataBase64), upload.mimeType, `${bookingId}__${upload.name}`);
  const file = attachmentFolder_().createFile(blob);
  return { fileId: file.getId() };
}

function trashAttachmentFile_(fileId) {
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (error) {
    console.error(`ย้ายไฟล์แนบ ${fileId} ลงถังขยะไม่สำเร็จ: ${error && error.message}`);
  }
}

/** ใครเปิดเอกสารของคำขอนี้ได้บ้าง (ผู้ใช้ที่เข้าสู่ระบบ) */
function canOpenAttachment_(user, row) {
  return user.role === 'admin' || Domain.canSeeAllBookings(user.role) || String(row.userEmail) === user.email;
}

function readAttachmentFile_(row) {
  const meta = Domain.attachmentMetaFromRow(row);
  if (!meta) throw appError_(ERROR_CODES.NOT_FOUND, 'คำขอนี้ไม่มีเอกสารแนบ');
  let bytes;
  try {
    bytes = DriveApp.getFileById(String(row.attachmentFileId)).getBlob().getBytes();
  } catch (error) {
    console.error(`อ่านไฟล์แนบของ ${row.bookingId} ไม่ได้: ${error && error.message}`);
    throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบไฟล์เอกสารแนบ ไฟล์อาจถูกลบออกจาก Google Drive แล้ว กรุณาติดต่อผู้ดูแลระบบ');
  }
  return Object.assign({}, meta, { dataBase64: Utilities.base64Encode(bytes) });
}

/** เปิดเอกสารแนบ (เข้าสู่ระบบแล้ว) — ส่งรายละเอียดการจองมาด้วยให้หน้าเปิดไฟล์แสดงว่าเป็นของคำขอไหน */
function bookingAttachment_(user, payload) {
  const bookingId = String((payload && payload.bookingId) || '');
  const row = bookingId === '' ? null : findByKey_(Domain.SHEET_BOOKINGS, bookingId);
  if (!row) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบรายการจองนี้');
  if (!canOpenAttachment_(user, row)) {
    audit_(user.email, 'attachment.denied', 'booking', bookingId, {});
    throw appError_(ERROR_CODES.FORBIDDEN, 'บัญชีนี้ไม่มีสิทธิ์เปิดเอกสารของคำขอนี้ (เปิดได้เฉพาะผู้จอง ผู้ลงนาม และผู้ดูแลระบบ)');
  }
  const attachment = readAttachmentFile_(row);
  audit_(user.email, 'attachment.open', 'booking', bookingId, { name: attachment.name });
  return { attachment: attachment, booking: publicBooking_(row, user) };
}

/** เปิดเอกสารแนบด้วยรหัสติดตาม (ผู้จองทั่วไป) */
function trackAttachment_(payload) {
  const row = findByTrackingCode_(payload && payload.code);
  const attachment = readAttachmentFile_(row);
  audit_(String(row.userEmail), 'attachment.open.tracking', 'booking', String(row.bookingId), { name: attachment.name });
  return { attachment: attachment };
}
