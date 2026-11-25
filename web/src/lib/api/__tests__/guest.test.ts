import { afterEach, describe, expect, it } from 'vitest';
import { addDaysToDateKey, dayOfWeekOfDateKey, toDateKey } from '@shared/time/bangkok';
import { GUEST_BOOKINGS_PER_HOUR } from '@shared/schemas/guest';
import { createDemoTransport, DEMO_LOGINS } from '../demo';
import type { DemoBooking } from '../demo';

/** วันทำการในอนาคตที่ไม่ชนข้อมูลตั้งต้น */
function futureWeekday(offset = 30): string {
  let key = addDaysToDateKey(toDateKey(new Date()), offset);
  while ([0, 6].includes(dayOfWeekOfDateKey(key))) key = addDaysToDateKey(key, 1);
  return key;
}

const request = (overrides: Record<string, unknown> = {}) => ({
  bookerName: 'นายผู้จอง ทั่วไป', title: 'ประชุมผู้ปกครอง', roomId: 'demo-room-2', dateKey: futureWeekday(), startMin: 13 * 60, endMin: 14 * 60,
  attendees: 10, department: 'แผนกวิชาการบัญชี', requesterPosition: 'ครู', requesterPhone: '089-111-2222', note: '', equipment: [],
  requestedFacilities: [], extraFurnitureCount: 0, otherFacility: '', customLocation: '', termsAccepted: true, meetingType: '', ...overrides,
});

async function login(transport: ReturnType<typeof createDemoTransport>, username: string): Promise<string> {
  const secret = DEMO_LOGINS.find((item) => item.username === username)!;
  return (await transport.call<{ token: string }>('login', { username, password: secret.password })).token;
}

afterEach(() => window.localStorage.clear());

describe('การจองโดยไม่เข้าสู่ระบบ (เรียก API ตรง ไม่ผ่านหน้าเว็บ)', () => {
  it('จองได้ ได้รหัสติดตาม และดูคำขอด้วยรหัสได้ — ยังต้องรออนุมัติ 3 ขั้น', async () => {
    const transport = createDemoTransport();
    const { booking, trackingCode } = await transport.call<{ booking: DemoBooking; trackingCode: string }>('guestBooking', request());
    expect(trackingCode).toMatch(/^[A-HJKMNP-Z2-9]{10}$/);
    expect(booking.status).toBe('pending');
    expect(booking.userEmail).toBe('guest:0891112222');
    const tracked = await transport.call<{ booking: DemoBooking }>('trackBooking', { code: trackingCode.toLowerCase() });
    expect(tracked.booking.title).toBe('ประชุมผู้ปกครอง');
  });

  it('จองทับเวลาที่มีคนจองไว้ไม่ได้ ถึงจะไม่ได้เข้าสู่ระบบ', async () => {
    const transport = createDemoTransport();
    await transport.call('guestBooking', request());
    await expect(transport.call('guestBooking', request({ requesterPhone: '089-333-4444', startMin: 13 * 60 + 30, endMin: 15 * 60 })))
      .rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('ต้องมีเบอร์ที่โทรกลับได้ และช่องดักบอทต้องว่าง', async () => {
    const transport = createDemoTransport();
    await expect(transport.call('guestBooking', request({ requesterPhone: 'ต่อ 123' }))).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(transport.call('guestBooking', request({ website: 'http://spam' }))).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('ผู้ลงนามเห็นคำขอของผู้จองทั่วไป แต่ไม่ได้รหัสติดตามของคนอื่น ผู้ดูแลได้', async () => {
    const transport = createDemoTransport();
    const { trackingCode } = await transport.call<{ trackingCode: string }>('guestBooking', request());
    const inspector = await login(transport, 'watcharapong');
    const seen = await transport.call<{ bookings: DemoBooking[] }>('bookings', {}, inspector);
    const guestRow = seen.bookings.find((item) => item.userEmail === 'guest:0891112222');
    expect(guestRow).toBeDefined();
    expect(guestRow!.trackingCode).toBe('');
    const admin = await login(transport, 'shoyu');
    const adminView = await transport.call<{ bookings: DemoBooking[] }>('bookings', {}, admin);
    expect(adminView.bookings.find((item) => item.userEmail === 'guest:0891112222')!.trackingCode).toBe(trackingCode);
  });

  it('ปฏิทินสาธารณะไม่มีชื่อ หัวข้อ หรือเบอร์ของใคร และจำกัดช่วงวัน', async () => {
    const transport = createDemoTransport();
    await transport.call('guestBooking', request());
    const today = toDateKey(new Date());
    const { slots } = await transport.call<{ slots: Record<string, unknown>[] }>('publicSchedule', { from: today, to: addDaysToDateKey(today, 60) });
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) expect(Object.keys(slot).sort()).toEqual(['dateKey', 'endMin', 'roomId', 'startMin', 'status']);
    await expect(transport.call('publicSchedule', { from: today, to: addDaysToDateKey(today, 400) })).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('ไม่เข้าสู่ระบบได้รายการตัวเลือกแต่ไม่ได้หมายเหตุ (เช่นชื่อหัวหน้าแผนก)', async () => {
    const transport = createDemoTransport();
    const { lookups } = await transport.call<{ lookups: { note: string }[] }>('lookups', {});
    expect(lookups.length).toBeGreaterThan(0);
    expect(lookups.every((item) => item.note === '')).toBe(true);
  });

  it('รหัสผิดหาไม่เจอ ยกเลิกด้วยรหัสได้ และยกเลิกซ้ำไม่ได้', async () => {
    const transport = createDemoTransport();
    await expect(transport.call('trackBooking', { code: 'ABCDEFGHJK' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const { trackingCode } = await transport.call<{ trackingCode: string }>('guestBooking', request());
    const cancelled = await transport.call<{ booking: DemoBooking }>('trackCancel', { code: trackingCode, reason: 'เลื่อนประชุม' });
    expect(cancelled.booking.status).toBe('cancelled');
    await expect(transport.call('trackCancel', { code: trackingCode })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('จำกัดจำนวนคำขอจากผู้จองทั่วไปต่อชั่วโมง กันคนยิงคำขอปลอมจนห้องเต็ม', async () => {
    const transport = createDemoTransport();
    // วันทำการไม่ซ้ำกัน + คนละเบอร์ จะได้ไม่ชนเวลาหรือโควตาต่อคน
    const days: string[] = [];
    for (let offset = 3; days.length < GUEST_BOOKINGS_PER_HOUR; offset += 1) {
      const key = addDaysToDateKey(toDateKey(new Date()), offset);
      if (![0, 6].includes(dayOfWeekOfDateKey(key))) days.push(key);
    }
    for (const [i, dateKey] of days.entries()) {
      await transport.call('guestBooking', request({ dateKey, requesterPhone: `08${10000000 + i}` }));
    }
    await expect(transport.call('guestBooking', request({ dateKey: futureWeekday(200), requesterPhone: '0899999999' })))
      .rejects.toMatchObject({ code: 'BUSY' });
  }, 30_000);

  it('บันทึกการใช้ห้องย้อนหลังได้ภายใน 7 วัน (ยังรออนุมัติ) เกินกว่านั้นไม่ได้', async () => {
    const transport = createDemoTransport();
    const pastWeekday = (from: number) => {
      let key = addDaysToDateKey(toDateKey(new Date()), -from);
      while ([0, 6].includes(dayOfWeekOfDateKey(key))) key = addDaysToDateKey(key, -1);
      return key;
    };
    const recent = pastWeekday(1);
    const { booking } = await transport.call<{ booking: DemoBooking }>('guestBooking', request({ dateKey: recent, startMin: 16 * 60, endMin: 17 * 60 }));
    expect(booking.status).toBe('pending');
    await expect(transport.call('guestBooking', request({ dateKey: pastWeekday(10), requesterPhone: '089-555-6666' })))
      .rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
