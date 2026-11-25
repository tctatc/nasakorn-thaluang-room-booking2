/**
 * เอกสารแนบของคำขอจอง (1 ไฟล์ต่อการจอง)
 *
 * กติกาความปลอดภัย:
 *  - ไม่เชื่อนามสกุลหรือ Content-Type ที่เบราว์เซอร์ส่งมา — ตัดสินชนิดไฟล์จากไบต์แรกของไฟล์จริง (magic bytes)
 *    แล้วต้องตรงกับนามสกุลด้วย จึงส่งไฟล์ .exe ที่เปลี่ยนชื่อเป็น .pdf เข้ามาไม่ได้
 *  - ชื่อไฟล์ถูกล้างอักขระที่ใช้ไต่โฟลเดอร์หรืออักขระควบคุม ก่อนเก็บและก่อนแสดง
 *  - ไฟล์เก็บแบบส่วนตัวใน Google Drive ของผู้ติดตั้ง ไม่แชร์ลิงก์ — ดาวน์โหลดผ่าน API ที่ตรวจสิทธิ์เท่านั้น
 */

import { Check, type ValidationResult, asRecord } from '../validate/check';

/** ขนาดสูงสุดเมื่อต่อ Apps Script (Drive) */
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
/** โหมดในเบราว์เซอร์เก็บใน localStorage ซึ่งจุได้ราว 5 MB ทั้งหมด จึงจำกัดให้เล็กกว่า */
export const ATTACHMENT_LOCAL_MAX_BYTES = 1024 * 1024;

export const ATTACHMENT_KINDS = ['pdf', 'jpg', 'png', 'docx', 'xlsx'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const ATTACHMENT_MIME: Record<AttachmentKind, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  png: 'image/png',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const EXTENSION_KIND: Record<string, AttachmentKind> = {
  pdf: 'pdf', jpg: 'jpg', jpeg: 'jpg', png: 'png', docx: 'docx', xlsx: 'xlsx',
};

/** ค่า accept ของ <input type="file"> — แค่ช่วยกรองในหน้าต่างเลือกไฟล์ ตัวตัดสินจริงคือ validateAttachmentUpload */
export const ATTACHMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.docx,.xlsx';
export const ATTACHMENT_TYPES_TEXT = 'PDF, รูป JPG/PNG, Word (.docx), Excel (.xlsx)';

/** ข้อมูลไฟล์ที่ส่งให้หน้าเว็บ (ไม่มีรหัสไฟล์ใน Drive) */
export interface AttachmentMeta {
  name: string;
  mimeType: string;
  size: number;
}

/** สิ่งที่หน้าเว็บส่งมาตอนจอง */
export interface AttachmentUpload extends AttachmentMeta {
  kind: AttachmentKind;
  dataBase64: string;
}

/** ไฟล์ที่ดาวน์โหลดผ่าน API (หลังตรวจสิทธิ์แล้ว) */
export interface AttachmentFile extends AttachmentMeta {
  dataBase64: string;
}

/** ตัดส่วน path ทิ้ง เหลือแค่ชื่อไฟล์ ไม่มีอักขระควบคุมหรืออักขระต้องห้ามของระบบไฟล์ ยาวไม่เกิน 120 ตัว (คงนามสกุลไว้) */
export function cleanAttachmentName(raw: unknown): string {
  const base = String(raw ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/\s+/g, ' ').replace(/^[.\s]+/, '').trim();
  if (cleaned.length <= 120) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const ext = dot > 0 && cleaned.length - dot <= 6 ? cleaned.slice(dot) : '';
  return cleaned.slice(0, 120 - ext.length) + ext;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** ถอด base64 เฉพาะต้นไฟล์ (พอสำหรับดู magic bytes) — ไม่พึ่ง atob/Buffer เพราะต้องรันบน Apps Script ได้ */
export function base64Head(dataBase64: string, byteCount = 8): number[] {
  const chars = dataBase64.slice(0, Math.ceil(byteCount / 3) * 4);
  const bytes: number[] = [];
  for (let i = 0; i + 3 < chars.length; i += 4) {
    const n = [0, 1, 2, 3].map((k) => BASE64_CHARS.indexOf(chars[i + k]!));
    bytes.push((n[0]! << 2) | (n[1]! >> 4));
    if (n[2]! >= 0) bytes.push(((n[1]! & 15) << 4) | (n[2]! >> 2));
    if (n[3]! >= 0) bytes.push(((n[2]! & 3) << 6) | n[3]!);
  }
  return bytes.slice(0, byteCount);
}

/** ขนาดไฟล์จริงจากความยาว base64 */
export function base64ByteLength(dataBase64: string): number {
  const padding = dataBase64.endsWith('==') ? 2 : dataBase64.endsWith('=') ? 1 : 0;
  return Math.max(0, (dataBase64.length / 4) * 3 - padding);
}

const startsWith = (bytes: number[], signature: number[]) => signature.every((value, index) => bytes[index] === value);

/** ชนิดไฟล์จากไบต์แรก ร่วมกับนามสกุล (docx/xlsx เป็น zip เหมือนกัน แยกได้ด้วยนามสกุลเท่านั้น) */
export function sniffAttachmentKind(head: number[], fileName: string): AttachmentKind | null {
  const byExtension = EXTENSION_KIND[extensionOf(fileName)];
  if (byExtension === undefined) return null;
  const actual: AttachmentKind[] = startsWith(head, [0x25, 0x50, 0x44, 0x46]) ? ['pdf'] // %PDF
    : startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? ['png']
      : startsWith(head, [0xff, 0xd8, 0xff]) ? ['jpg']
        : startsWith(head, [0x50, 0x4b, 0x03, 0x04]) ? ['docx', 'xlsx'] // zip (Office Open XML)
          : [];
  return actual.includes(byExtension) ? byExtension : null;
}

/**
 * ตรวจไฟล์ที่ส่งมาตอนจอง — ไม่ส่ง attachment มา = ไม่มีไฟล์แนบ (value = null)
 * maxBytes: ATTACHMENT_MAX_BYTES (server) หรือ ATTACHMENT_LOCAL_MAX_BYTES (โหมดเบราว์เซอร์)
 */
export function validateAttachmentUpload(raw: unknown, maxBytes: number = ATTACHMENT_MAX_BYTES): ValidationResult<AttachmentUpload | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  const input = asRecord(raw);
  const check = new Check();
  const name = cleanAttachmentName(input.name);
  const dataBase64 = typeof input.dataBase64 === 'string' ? input.dataBase64 : '';
  const empty = { name, mimeType: '', size: 0, kind: 'pdf' as AttachmentKind, dataBase64: '' };

  if (name === '' || extensionOf(name) === '') {
    check.fail('attachment', 'ไม่พบชื่อไฟล์แนบ กรุณาเลือกไฟล์ใหม่');
    return check.result(empty);
  }
  if (dataBase64 === '' || dataBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(dataBase64)) {
    check.fail('attachment', 'อ่านไฟล์แนบไม่ได้ กรุณาเลือกไฟล์ใหม่');
    return check.result(empty);
  }
  const size = base64ByteLength(dataBase64);
  if (size > maxBytes) {
    check.fail('attachment', `ไฟล์แนบใหญ่เกิน ${formatFileSize(maxBytes)} (ไฟล์นี้ ${formatFileSize(size)}) กรุณาย่อไฟล์หรือสแกนให้ความละเอียดต่ำลง`);
    return check.result(empty);
  }
  const kind = sniffAttachmentKind(base64Head(dataBase64), name);
  if (kind === null) {
    check.fail('attachment', `แนบได้เฉพาะ ${ATTACHMENT_TYPES_TEXT} และเนื้อไฟล์ต้องตรงกับนามสกุล`);
    return check.result(empty);
  }
  return check.result({ name, mimeType: ATTACHMENT_MIME[kind], size, kind, dataBase64 });
}

/** "240 KB" / "1.2 MB" */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ไบต์`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

/** อ่านข้อมูลไฟล์แนบจากแถวในชีต Bookings — ไม่มีไฟล์ = null */
export function attachmentMetaFromRow(row: Record<string, unknown>): AttachmentMeta | null {
  const name = String(row.attachmentName ?? '');
  if (name === '' || String(row.attachmentFileId ?? '') === '') return null;
  return { name, mimeType: String(row.attachmentMime ?? ''), size: Number(row.attachmentSize) || 0 };
}
