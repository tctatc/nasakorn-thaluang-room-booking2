import { afterEach, describe, expect, it } from 'vitest';
import { addDaysToDateKey, dayOfWeekOfDateKey, toDateKey } from '@shared/time/bangkok';
import { createDemoTransport, DEMO_LOGINS } from '../demo';
import type { DemoBooking } from '../demo';

function futureWeekday(offset = 40): string {
  let key = addDaysToDateKey(toDateKey(new Date()), offset);
  while ([0, 6].includes(dayOfWeekOfDateKey(key))) key = addDaysToDateKey(key, 1);
  return key;
}
const request = (overrides: Record<string, unknown> = {}) => ({
  bookerName: 'นายผู้จอง ทดสอบ', title: 'ประชุมทดสอบ', roomId: 'demo-room-2', dateKey: futureWeekday(), startMin: 13 * 60, endMin: 14 * 60,
  attendees: 10, department: 'แผนกวิชาการบัญชี', requesterPosition: 'ครู', requesterPhone: '089-111-2222', note: '', equipment: [],
  requestedFacilities: [], extraFurnitureCount: 0, otherFacility: '', customLocation: '', termsAccepted: true, meetingType: '', ...overrides,
});
async function login(transport: ReturnType<typeof createDemoTransport>, username: string): Promise<string> {
  const secret = DEMO_LOGINS.find((item) => item.username === username)!;
  return (await transport.call<{ token: string }>('login', { username, password: secret.password })).token;
}
afterEach(() => window.localStorage.clear());

describe('ผู้ดูแลแก้ไข ลบ และล้างข้อมูลการจอง (เรียก API ตรง)', () => {
  it('คนที่ไม่ใช่ผู้ดูแลเรียกไม่ได้ทั้งสามคำสั่ง แม้เรียก API ตรง', async () => {
    const transport = createDemoTransport();
    const { booking } = await transport.call<{ booking: DemoBooking }>('guestBooking', request());
    const signer = await login(transport, 'watcharapong');
    await expect(transport.call('adminUpdateBooking', { bookingId: booking.bookingId, title: 'แก้' }, signer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(transport.call('adminDeleteBooking', { bookingId: booking.bookingId }, signer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(transport.call('adminResetBookings', { confirm: 'ล้างข้อมูล' }, signer)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(transport.call('adminResetBookings', { confirm: 'ล้างข้อมูล' })).rejects.toBeDefined();
  });

  it('แก้เรื่องและเวลาได้ สถานะไม่เปลี่ยน และย้ายไปทับการจองอื่นไม่ได้', async () => {
    const transport = createDemoTransport();
    const admin = await login(transport, 'shoyu');
    const { booking } = await transport.call<{ booking: DemoBooking }>('guestBooking', request());
    await transport.call('guestBooking', request({ requesterPhone: '089-333-4444', startMin: 15 * 60, endMin: 16 * 60 }));
    const edited = await transport.call<{ booking: DemoBooking; changed: number }>('adminUpdateBooking', {
      bookingId: booking.bookingId, title: 'ประชุมผู้ปกครอง', startMin: 9 * 60, endMin: 10 * 60, status: 'confirmed',
    }, admin);
    expect(edited.changed).toBe(3);
    expect(edited.booking.title).toBe('ประชุมผู้ปกครอง');
    expect(edited.booking.status).toBe('pending');
    await expect(transport.call('adminUpdateBooking', { bookingId: booking.bookingId, startMin: 15 * 60 + 30, endMin: 16 * 60 + 30 }, admin))
      .rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('ลบคำขอได้ หายจากรายการ และเวลานั้นว่างให้จองใหม่', async () => {
    const transport = createDemoTransport();
    const admin = await login(transport, 'shoyu');
    const { booking } = await transport.call<{ booking: DemoBooking }>('guestBooking', request());
    await transport.call('adminDeleteBooking', { bookingId: booking.bookingId }, admin);
    const { bookings } = await transport.call<{ bookings: DemoBooking[] }>('bookings', {}, admin);
    expect(bookings.some((item) => item.bookingId === booking.bookingId)).toBe(false);
    await expect(transport.call('guestBooking', request({ requesterPhone: '089-555-6666' }))).resolves.toBeDefined();
    await expect(transport.call('adminDeleteBooking', { bookingId: booking.bookingId }, admin)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('ล้างข้อมูลต้องพิมพ์คำยืนยันตรง แล้วการจองเหลือ 0 แต่ห้องและผู้ใช้อยู่ครบ', async () => {
    const transport = createDemoTransport();
    const admin = await login(transport, 'shoyu');
    await expect(transport.call('adminResetBookings', { confirm: 'ล้าง' }, admin)).rejects.toMatchObject({ code: 'VALIDATION' });
    const before = await transport.call<{ bookings: DemoBooking[] }>('bookings', {}, admin);
    expect(before.bookings.length).toBeGreaterThan(0);
    const result = await transport.call<{ cleared: Record<string, number> }>('adminResetBookings', { confirm: ' ล้างข้อมูล ' }, admin);
    expect(result.cleared.Bookings).toBe(before.bookings.length);
    expect((await transport.call<{ bookings: DemoBooking[] }>('bookings', {}, admin)).bookings).toEqual([]);
    expect((await transport.call<{ rooms: unknown[] }>('rooms', {}, admin)).rooms.length).toBeGreaterThan(0);
    // ผู้ใช้เดิมยังเข้าสู่ระบบได้
    await expect(login(transport, 'watcharapong')).resolves.toBeTruthy();
  });
});
