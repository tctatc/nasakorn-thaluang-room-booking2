/**
 * การจองโดยไม่ต้องเข้าสู่ระบบ (ผู้จองทั่วไป) และรหัสติดตามสถานะ
 *
 * ผู้จองทั่วไปไม่มีบัญชี — ใช้เบอร์โทรเป็นตัวระบุ (นับจำนวนคำขอที่ค้างอยู่ต่อคน)
 * และได้ "รหัสติดตาม" สุ่ม 10 ตัวไว้ดูสถานะ พิมพ์แบบฟอร์ม และยกเลิกคำขอของตัวเอง
 * รหัสนี้คือกุญแจของคำขอนั้น ใครมีรหัสก็เห็นคำขอนั้น จึงต้องสุ่มจากแหล่งที่เดาไม่ได้เสมอ
 */

import { Check, asRecord, type FieldIssue, type ValidationResult } from '../validate/check';
import { addDaysToDateKey, countDaysInclusive, DATE_KEY_PATTERN } from '../time/bangkok';

/** ตัวอักษรที่ใช้ในรหัส — ตัด 0 O 1 I L ที่อ่านสับสนเวลาพิมพ์ตามกระดาษ */
export const TRACKING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const TRACKING_CODE_LENGTH = 10;
const TRACKING_PATTERN = new RegExp(`^[${TRACKING_ALPHABET}]{${TRACKING_CODE_LENGTH}}$`);

/** จำกัดคำขอจากผู้จองทั่วไปทั้งระบบต่อชั่วโมง — กันคนยิงคำขอปลอมจนห้องเต็ม */
export const GUEST_BOOKINGS_PER_HOUR = 40;
/** ค้นรหัสติดตามผิดได้กี่ครั้งต่อชั่วโมงทั้งระบบ ก่อนปิดชั่วคราว — กันการไล่เดารหัส */
export const TRACKING_MISSES_PER_HOUR = 300;
/** ปฏิทินสาธารณะขอดูได้ครั้งละไม่เกินกี่วัน */
export const PUBLIC_SCHEDULE_MAX_DAYS = 62;

/**
 * สร้างรหัสจากไบต์สุ่ม (ต้องมาจาก crypto เช่น crypto.getRandomValues หรือ UUID v4 ของ Apps Script)
 * ทิ้งไบต์ที่ ≥ 248 (= 31 × 8) ไม่ให้บางตัวอักษรออกบ่อยกว่าตัวอื่น — ผู้เรียกส่งมาเผื่อ (เช่น 32 ไบต์)
 */
export function trackingCodeFromBytes(bytes: ArrayLike<number>): string {
  const limit = Math.floor(256 / TRACKING_ALPHABET.length) * TRACKING_ALPHABET.length;
  let code = '';
  for (let i = 0; i < bytes.length && code.length < TRACKING_CODE_LENGTH; i += 1) {
    const byte = (bytes[i] ?? 0) & 0xff;
    if (byte < limit) code += TRACKING_ALPHABET[byte % TRACKING_ALPHABET.length];
  }
  if (code.length < TRACKING_CODE_LENGTH) throw new Error('ไบต์สุ่มไม่พอสร้างรหัสติดตาม');
  return code;
}

/** ผู้ใช้พิมพ์เอง: ตัวเล็ก ช่องว่าง ขีด — แปลงให้เป็นรูปแบบเดียว คืน '' ถ้าไม่ใช่รหัส */
export function normalizeTrackingCode(raw: unknown): string {
  const code = String(raw ?? '').toUpperCase().replace(/[\s-]/g, '');
  return TRACKING_PATTERN.test(code) ? code : '';
}

/** แสดงให้อ่านง่าย: ABCDE-FGHJK */
export function formatTrackingCode(code: string): string {
  return code.length === TRACKING_CODE_LENGTH ? `${code.slice(0, 5)}-${code.slice(5)}` : code;
}

/** ตัวเลขล้วนของเบอร์โทร */
export function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

/** รหัสผู้จองทั่วไปในคอลัมน์ userEmail — มี ":" ซึ่งชื่อผู้ใช้จริงใช้ไม่ได้ จึงไม่มีทางชนกับบัญชีใด */
export function guestAccountId(phone: string): string {
  return `guest:${phoneDigits(phone)}`;
}

export function isGuestAccountId(id: string): boolean {
  return id.startsWith('guest:');
}

/**
 * ข้อมูลผู้จองที่ผู้จองทั่วไปต้องกรอกเพิ่มจากการจองปกติ
 * เบอร์ต้องเป็นเบอร์ที่โทรกลับได้จริง (9–10 หลัก) เพราะเป็นทางเดียวที่ผู้อนุมัติติดต่อกลับ
 */
export function guestRequesterIssues(input: { bookerName: string; requesterPhone: string; department: string }): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (input.bookerName.trim().length < 2) issues.push({ field: 'bookerName', message: 'กรุณากรอกชื่อ-นามสกุลผู้จอง' });
  const digits = phoneDigits(input.requesterPhone);
  if (digits.length < 9 || digits.length > 10) {
    issues.push({ field: 'requesterPhone', message: 'กรุณากรอกเบอร์โทรที่ติดต่อกลับได้ 9–10 หลัก เช่น 081-234-5678' });
  }
  if (input.department.trim() === '') issues.push({ field: 'department', message: 'กรุณากรอกแผนก / หน่วยงาน' });
  return issues;
}

export interface ScheduleRange {
  from: string;
  to: string;
}

export function validateScheduleRange(raw: unknown): ValidationResult<ScheduleRange> {
  const input = asRecord(raw);
  const check = new Check();
  const from = check.string('from', input.from, { label: 'วันเริ่ม', pattern: DATE_KEY_PATTERN });
  const to = check.string('to', input.to, { label: 'วันสิ้นสุด', pattern: DATE_KEY_PATTERN });
  if (check.ok) {
    if (to < from) check.fail('to', 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม');
    else if (countDaysInclusive(from, to) > PUBLIC_SCHEDULE_MAX_DAYS) check.fail('to', `ดูได้ครั้งละไม่เกิน ${PUBLIC_SCHEDULE_MAX_DAYS} วัน`);
  }
  return check.result({ from, to });
}

/** ช่วงวันที่ของสัปดาห์ (หรือ N วัน) เริ่มจากวันที่ให้มา */
export function scheduleWindow(from: string, days: number): ScheduleRange {
  return { from, to: addDaysToDateKey(from, Math.max(1, Math.min(days, PUBLIC_SCHEDULE_MAX_DAYS)) - 1) };
}
