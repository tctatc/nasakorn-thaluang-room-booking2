import { afterEach, describe, expect, it, vi } from 'vitest';
import { withReadCache } from '../readCache';
import type { Transport } from '../types';

function fakeTransport() {
  let n = 0;
  const call = vi.fn(async (action: string) => {
    n += 1;
    if (action === 'broken') throw new Error('ล่ม');
    return { action, n };
  });
  const transport: Transport = { kind: 'http', call: call as Transport['call'], version: async () => ({ dataVersion: 1, serverTime: '' }) };
  return { transport, call };
}
afterEach(() => { window.localStorage.clear(); vi.useRealTimers(); });

describe('เก็บผลคำสั่งอ่านไว้ใช้ซ้ำ (ลดคำขอไป Apps Script)', () => {
  it('หลายส่วนของหน้าขอพร้อมกันได้คำขอเดียว และขอซ้ำในเวลาอายุไม่ยิงใหม่', async () => {
    const { transport, call } = fakeTransport();
    const cached = withReadCache(transport, { persist: false });
    const [a, b] = await Promise.all([cached.call('rooms', {}, 't'), cached.call('rooms', {}, 't')]);
    expect(a).toEqual(b);
    await cached.call('rooms', {}, 't');
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('คนละ token ไม่ใช้ผลร่วมกัน (ห้องที่จองได้ต่างกันตามสิทธิ์)', async () => {
    const { transport, call } = fakeTransport();
    const cached = withReadCache(transport, { persist: false });
    await cached.call('rooms', {}, 'user-a');
    await cached.call('rooms', {}, 'user-b');
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('คำสั่งเขียน (เช่นแก้ห้อง) ล้างของที่เก็บไว้ ครั้งต่อไปโหลดใหม่', async () => {
    const { transport, call } = fakeTransport();
    const cached = withReadCache(transport, { persist: false });
    await cached.call('rooms', {}, 't');
    await cached.call('saveRoom', { name: 'x' }, 't');
    await cached.call('rooms', {}, 't');
    expect(call.mock.calls.map((args) => args[0])).toEqual(['rooms', 'saveRoom', 'rooms']);
  });

  it('รายการจองและห้องว่างสดทุกครั้ง และไม่ล้างของที่เก็บไว้', async () => {
    const { transport, call } = fakeTransport();
    const cached = withReadCache(transport, { persist: false });
    await cached.call('rooms', {}, 't');
    await cached.call('bookings', {}, 't');
    await cached.call('bookings', {}, 't');
    await cached.call('rooms', {}, 't');
    expect(call.mock.calls.map((args) => args[0])).toEqual(['rooms', 'bookings', 'bookings']);
  });

  it('หมดอายุแล้วโหลดใหม่ และคำขอที่ล้มเหลวไม่ถูกเก็บ', async () => {
    vi.useFakeTimers();
    const { transport, call } = fakeTransport();
    const cached = withReadCache(transport, { persist: false });
    await cached.call('roomSlotsToday', {}, 't');
    vi.advanceTimersByTime(25_000);
    await cached.call('roomSlotsToday', {}, 't');
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('ข้อมูลสาธารณะเก็บในเครื่อง: เปิดเว็บใหม่ได้ค่าทันที แล้วโหลดค่าใหม่เบื้องหลัง', async () => {
    const first = fakeTransport();
    await withReadCache(first.transport, { persist: true }).call('publicBootstrap');
    expect(window.localStorage.getItem('mrb.read-cache.v1')).toContain('publicBootstrap');

    const second = fakeTransport();
    const reopened = withReadCache(second.transport, { persist: true });
    await expect(reopened.call('publicBootstrap')).resolves.toEqual({ action: 'publicBootstrap', n: 1 });
    expect(second.call).toHaveBeenCalledTimes(1); // โหลดใหม่เบื้องหลังแล้ว
  });

  it('ข้อมูลที่ต้องเข้าสู่ระบบไม่ถูกเก็บลงเครื่อง', async () => {
    const { transport } = fakeTransport();
    await withReadCache(transport, { persist: true }).call('lookups', {}, 'secret-token');
    expect(window.localStorage.getItem('mrb.read-cache.v1')).toBeNull();
  });
});
