/**
 * งานของผู้ดูแลกับคำขอที่ส่งมาแล้ว: แก้ไข ลบ และล้างข้อมูลการจองทั้งหมด
 *
 * ฟังก์ชันบริสุทธิ์ ใช้ร่วมกันทั้ง Apps Script (ตัดสินจริงในล็อก) และโหมดทดลองในเบราว์เซอร์
 */

import { type BookingRequest, validateBookingRequest } from '../schemas/booking';
import type { ValidationResult } from '../validate/check';
import { asRecord } from '../validate/check';
import { overlaps } from './overlap';
import {
  type BookingRuleContext,
  type BookingRuleIssue,
  validateBookingRules,
} from './booking-rules';

/** คำที่ผู้ดูแลต้องพิมพ์ให้ตรงก่อนล้างข้อมูลการจองทั้งหมด กันกดพลาด */
export const RESET_CONFIRM_PHRASE = 'ล้างข้อมูล';

/** ช่องที่ผู้ดูแลแก้ได้ — สถานะ ผลอนุมัติ ผู้ส่ง และรหัสติดตามแก้ไม่ได้ (ต้องไม่ปลอมประวัติการลงนาม) */
export const ADMIN_EDITABLE_FIELDS = [
  'roomId', 'dateKey', 'startMin', 'endMin', 'title', 'bookerName', 'department',
  'requesterPosition', 'requesterPhone', 'attendees', 'note', 'customLocation',
] as const;
export type AdminEditableField = (typeof ADMIN_EDITABLE_FIELDS)[number];

export interface AdminBookingEdit {
  bookingId: string;
  request: BookingRequest;
  /** ช่องที่ค่าเปลี่ยนจริง พร้อมค่าเดิม/ค่าใหม่ — ใช้ลง audit log */
  changes: { field: AdminEditableField; from: unknown; to: unknown }[];
}

/**
 * รวมค่าที่ผู้ดูแลแก้เข้ากับคำขอเดิม แล้วตรวจรูปแบบด้วยกติกาเดียวกับการจองใหม่
 * ช่องที่ไม่ได้ส่งมาใช้ค่าเดิม ช่องที่ไม่อยู่ในรายการแก้ได้จะถูกทิ้งเงียบ ๆ
 */
export function mergeAdminEdit(existing: BookingRequest, raw: unknown): ValidationResult<AdminBookingEdit> {
  const input = asRecord(raw);
  const bookingId = typeof input.bookingId === 'string' ? input.bookingId.trim() : '';
  if (bookingId === '') return { ok: false, issues: [{ field: 'bookingId', message: 'ไม่ได้ระบุรายการจอง' }] };

  const merged: Record<string, unknown> = { ...existing, termsAccepted: true };
  for (const field of ADMIN_EDITABLE_FIELDS) {
    if (input[field] !== undefined) merged[field] = input[field];
  }
  const parsed = validateBookingRequest(merged);
  if (!parsed.ok) return parsed;

  const changes = ADMIN_EDITABLE_FIELDS
    .filter((field) => String(existing[field]) !== String(parsed.value[field]))
    .map((field) => ({ field, from: existing[field], to: parsed.value[field] }));
  return { ok: true, value: { bookingId, request: parsed.value, changes } };
}

/**
 * กฎการจองที่ยังใช้กับการแก้ของผู้ดูแล: ช่วงเวลา เวลาทำการ ความจุ ห้องเปิดอยู่
 * ไม่ใช้: ย้อนหลัง/ล่วงหน้า/โควตา — ผู้ดูแลแก้บันทึกของการประชุมที่ผ่านไปแล้วได้
 */
export function adminEditRuleIssues(
  request: BookingRequest,
  context: Omit<BookingRuleContext, 'isAdmin' | 'activeBookingCount'>,
): BookingRuleIssue[] {
  const result = validateBookingRules(request, {
    ...context,
    settings: { ...context.settings, allowAdminBackdate: true },
    isAdmin: true,
    activeBookingCount: 0,
  });
  if (result.ok) return [];
  return result.issues.filter((issue) => !['IN_THE_PAST', 'LEAD_TIME_TOO_SHORT', 'QUOTA_EXCEEDED'].includes(issue.code));
}

/** การจองอื่นที่ชนกับเวลาใหม่ (ไม่นับตัวเอง และนับเฉพาะที่ยังมีผล) */
export function editConflicts<T extends { bookingId: unknown; roomId: unknown; dateKey: unknown; startMin: unknown; endMin: unknown; status: unknown }>(
  rows: readonly T[],
  bookingId: string,
  request: Pick<BookingRequest, 'roomId' | 'dateKey' | 'startMin' | 'endMin'>,
  normalizeDateKey: (value: unknown) => string = (value) => String(value),
): T[] {
  return rows.filter((row) =>
    String(row.bookingId) !== bookingId &&
    String(row.roomId) === request.roomId &&
    normalizeDateKey(row.dateKey) === request.dateKey &&
    ['pending', 'confirmed'].includes(String(row.status)) &&
    overlaps(request, { startMin: Number(row.startMin), endMin: Number(row.endMin) }),
  );
}
