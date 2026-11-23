import { describe, expect, it } from 'vitest';
import {
  TRACKING_ALPHABET, formatTrackingCode, guestAccountId, guestRequesterIssues, normalizeTrackingCode,
  trackingCodeFromBytes, validateScheduleRange,
} from '../schemas/guest';
import { freeWindows, publicSlotsBetween } from '../domain/availability';
import { USERNAME_PATTERN } from '../schemas/user';

describe('รหัสติดตาม', () => {
  it('สร้างจากไบต์สุ่ม ได้ 10 ตัวจากชุดตัวอักษรที่อ่านไม่สับสน และทิ้งไบต์ที่ทำให้เอียง', () => {
    const code = trackingCodeFromBytes([255, 250, 248, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(code).toBe('ABCDEFGHJK');
    expect([...code].every((char) => TRACKING_ALPHABET.includes(char))).toBe(true);
    expect(() => trackingCodeFromBytes([255, 255, 1])).toThrow();
  });

  it('รับรหัสที่พิมพ์ตัวเล็ก มีขีดหรือช่องว่าง และปฏิเสธรูปแบบอื่น', () => {
    expect(normalizeTrackingCode(' abcde-fghjk ')).toBe('ABCDEFGHJK');
    expect(normalizeTrackingCode('ABCDE0GHJK')).toBe(''); // มีเลข 0
    expect(normalizeTrackingCode('ABC')).toBe('');
    expect(normalizeTrackingCode("x' OR 1=1")).toBe('');
    expect(formatTrackingCode('ABCDEFGHJK')).toBe('ABCDE-FGHJK');
  });
});

describe('ผู้จองทั่วไป', () => {
  it('รหัสผู้จองไม่มีทางชนกับชื่อผู้ใช้จริง', () => {
    const id = guestAccountId('081-234-5678');
    expect(id).toBe('guest:0812345678');
    expect(USERNAME_PATTERN.test(id)).toBe(false);
  });

  it('ต้องมีชื่อ เบอร์ที่โทรกลับได้ และแผนก', () => {
    expect(guestRequesterIssues({ bookerName: 'นายสมชาย ใจดี', requesterPhone: '081-234-5678', department: 'บัญชี' })).toEqual([]);
    const issues = guestRequesterIssues({ bookerName: ' ', requesterPhone: 'ต่อ 123', department: '' });
    expect(issues.map((issue) => issue.field)).toEqual(['bookerName', 'requesterPhone', 'department']);
  });
});

describe('ปฏิทินสาธารณะ', () => {
  it('จำกัดช่วงวันที่', () => {
    expect(validateScheduleRange({ from: '2026-11-01', to: '2026-12-31' }).ok).toBe(true);
    expect(validateScheduleRange({ from: '2026-11-01', to: '2027-01-15' }).ok).toBe(false);
    expect(validateScheduleRange({ from: '2026-11-10', to: '2026-11-01' }).ok).toBe(false);
    expect(validateScheduleRange({ from: 'x', to: '2026-11-01' }).ok).toBe(false);
  });

  it('ส่งแค่ห้อง วัน เวลา สถานะ — ไม่มีชื่อหรือหัวข้อ และไม่รวมรายการที่ยกเลิก', () => {
    const rows = [
      { bookingId: 'a', roomId: 'r1', dateKey: '2026-11-23', startMin: 540, endMin: 600, status: 'confirmed', title: 'ลับ', userName: 'ใคร' },
      { bookingId: 'b', roomId: 'r1', dateKey: '2026-11-23', startMin: 600, endMin: 660, status: 'pending' },
      { bookingId: 'c', roomId: 'r1', dateKey: '2026-11-23', startMin: 700, endMin: 760, status: 'cancelled' },
      { bookingId: 'd', roomId: 'r2', dateKey: '2026-11-22', startMin: 540, endMin: 600, status: 'completed' },
      { bookingId: 'e', roomId: 'r2', dateKey: '2026-12-30', startMin: 540, endMin: 600, status: 'confirmed' },
    ];
    const slots = publicSlotsBetween(rows, '2026-11-22', '2026-11-30');
    expect(slots).toEqual([
      { roomId: 'r2', dateKey: '2026-11-22', startMin: 540, endMin: 600, status: 'confirmed' },
      { roomId: 'r1', dateKey: '2026-11-23', startMin: 540, endMin: 600, status: 'confirmed' },
      { roomId: 'r1', dateKey: '2026-11-23', startMin: 600, endMin: 660, status: 'pending' },
    ]);
  });

  it('ช่วงว่างของวัน', () => {
    expect(freeWindows([{ startMin: 540, endMin: 600 }, { startMin: 580, endMin: 660 }, { startMin: 900, endMin: 1100 }], 480, 1080))
      .toEqual([{ startMin: 480, endMin: 540 }, { startMin: 660, endMin: 900 }]);
    expect(freeWindows([], 480, 1080)).toEqual([{ startMin: 480, endMin: 1080 }]);
    expect(freeWindows([{ startMin: 400, endMin: 1200 }], 480, 1080)).toEqual([]);
  });
});
