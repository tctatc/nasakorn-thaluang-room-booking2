import { describe, expect, it } from 'vitest';
import { adminEditRuleIssues, editConflicts, mergeAdminEdit } from '../domain/admin-booking';
import type { BookingRequest } from '../schemas/booking';
import { DEFAULT_SYSTEM_SETTINGS } from '../schemas/settings';

const existing: BookingRequest = {
  bookerName: 'นายสมชาย ใจดี', title: 'ประชุมแผนก', roomId: 'room-1', dateKey: '2026-11-20', startMin: 540, endMin: 600,
  attendees: 10, department: 'แผนกบัญชี', requesterPosition: 'ครู', requesterPhone: '0812345678', note: '',
  equipment: [], requestedFacilities: [], meetingType: '', extraFurnitureCount: 0, otherFacility: '', termsAccepted: true, customLocation: '',
};
const room = { capacity: 20, equipment: [], status: 'active' as const };
const now = new Date('2026-11-25T03:00:00Z');

describe('ผู้ดูแลแก้คำขอที่ส่งมาแล้ว', () => {
  it('แก้เฉพาะช่องที่ส่งมา รายงานว่าช่องไหนเปลี่ยน และไม่ยอมให้แก้สถานะหรือผู้ส่ง', () => {
    const result = mergeAdminEdit(existing, { bookingId: 'bk-1', title: 'ประชุมครูประจำชั้น', attendees: 15, status: 'confirmed', userEmail: 'x' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.request.title).toBe('ประชุมครูประจำชั้น');
    expect(result.value.request.bookerName).toBe('นายสมชาย ใจดี');
    expect(result.value.changes.map((c) => c.field)).toEqual(['title', 'attendees']);
    expect(result.value.request).not.toHaveProperty('status');
  });

  it('ค่าผิดรูปแบบถูกปฏิเสธ และต้องระบุรายการ', () => {
    expect(mergeAdminEdit(existing, { bookingId: 'bk-1', title: '' }).ok).toBe(false);
    expect(mergeAdminEdit(existing, { title: 'ก' }).ok).toBe(false);
  });

  it('แก้บันทึกของวันที่ผ่านมาแล้วได้ แต่ยังต้องอยู่ในเวลาทำการและไม่เกินความจุ', () => {
    const settings = { ...DEFAULT_SYSTEM_SETTINGS, allowAdminBackdate: false, backdateDays: 0 };
    expect(adminEditRuleIssues(existing, { settings, room, now })).toEqual([]);
    const late = adminEditRuleIssues({ ...existing, startMin: 17 * 60, endMin: 19 * 60 }, { settings, room, now });
    expect(late.map((i) => i.code)).toContain('OUTSIDE_BUSINESS_HOURS');
    const crowded = adminEditRuleIssues({ ...existing, attendees: 50 }, { settings, room, now });
    expect(crowded.map((i) => i.code)).toContain('ATTENDEES_EXCEED_CAPACITY');
  });

  it('ตรวจเวลาชนโดยไม่นับตัวเอง และไม่นับรายการที่ยกเลิก', () => {
    const rows = [
      { bookingId: 'bk-1', roomId: 'room-1', dateKey: '2026-11-20', startMin: 540, endMin: 600, status: 'pending' },
      { bookingId: 'bk-2', roomId: 'room-1', dateKey: '2026-11-20', startMin: 600, endMin: 660, status: 'confirmed' },
      { bookingId: 'bk-3', roomId: 'room-1', dateKey: '2026-11-20', startMin: 660, endMin: 720, status: 'cancelled' },
    ];
    expect(editConflicts(rows, 'bk-1', existing)).toEqual([]);
    expect(editConflicts(rows, 'bk-1', { ...existing, endMin: 630 }).map((r) => r.bookingId)).toEqual(['bk-2']);
    expect(editConflicts(rows, 'bk-1', { ...existing, startMin: 660, endMin: 720 })).toEqual([]);
  });
});
