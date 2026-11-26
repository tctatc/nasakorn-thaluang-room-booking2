import { readLocal, writeLocal } from '../storage';
import type { Transport } from './types';

/**
 * ทำให้เว็บเร็วขึ้นโดยไม่ยิงคำขอซ้ำ — ทุกคำขอไป Apps Script ใช้ 1.5–3.5 วินาที
 *
 *  1. คำสั่งอ่านข้อมูลที่แทบไม่เปลี่ยน (ห้อง รายการตั้งต้น ค่าตั้งค่า ...) เก็บไว้ใช้ซ้ำตามอายุใน READ_TTL_MS
 *     หลายส่วนของหน้าเรียกพร้อมกันได้คำขอเดียว เปลี่ยนหน้าไปมาไม่ต้องโหลดใหม่
 *  2. ข้อมูลสาธารณะ (ไม่ต้องเข้าสู่ระบบ) เก็บในเครื่องด้วย เปิดเว็บครั้งหน้าเห็นทันที แล้วโหลดค่าใหม่เบื้องหลัง
 *  3. คำสั่งเขียนทุกตัว (จอง อนุมัติ แก้ห้อง ...) ล้างของที่เก็บไว้ทั้งหมด — หลังแก้จะเห็นค่าใหม่เสมอ
 * รายการจอง ห้องว่าง และสิทธิ์ผู้ใช้ไม่เก็บ ต้องสดทุกครั้ง
 */
const READ_TTL_MS: Record<string, number> = {
  publicBootstrap: 5 * 60_000,
  rooms: 2 * 60_000,
  lookups: 5 * 60_000,
  reviewSummary: 2 * 60_000,
  announcements: 60_000,
  roomSlotsToday: 20_000,
};

/** อ่านอย่างเดียวแต่ต้องสดทุกครั้ง — ไม่เก็บ และไม่ล้างของที่เก็บไว้ */
const FRESH_READS = new Set([
  'ping', 'me', 'bootstrap', 'bookings', 'availability', 'publicSchedule', 'trackBooking', 'trackAttachment',
  'bookingAttachment', 'reviews', 'users', 'lineStatus',
]);

/** เก็บในเครื่อง (localStorage) เฉพาะข้อมูลที่ใครก็อ่านได้โดยไม่ต้องเข้าสู่ระบบ — ไม่มีข้อมูลส่วนตัว */
const PERSISTED = new Set(['publicBootstrap', 'rooms', 'lookups']);
const STORE_KEY = 'mrb.read-cache.v1';
const STORE_MAX_AGE_MS = 7 * 24 * 3_600_000;

type Stored = Record<string, { at: number; value: unknown }>;

function readStore(): Stored {
  try {
    const parsed = JSON.parse(readLocal(STORE_KEY) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Stored) : {};
  } catch {
    return {};
  }
}

export function withReadCache(transport: Transport, options: { persist: boolean }): Transport {
  const memory = new Map<string, { at: number; value: Promise<unknown> }>();
  const stored = options.persist ? readStore() : {};

  function fetchAndRemember(key: string, action: string, payload: unknown, token: string, storeKey: string): Promise<unknown> {
    const value = transport.call(action, payload, token).then((result) => {
      if (storeKey) {
        stored[storeKey] = { at: Date.now(), value: result };
        writeLocal(STORE_KEY, JSON.stringify(stored));
      }
      return result;
    });
    memory.set(key, { at: Date.now(), value });
    // ล้มเหลวไม่เก็บ ครั้งถัดไปลองใหม่
    value.catch(() => { if (memory.get(key)?.value === value) memory.delete(key); });
    return value;
  }

  return {
    kind: transport.kind,
    version: () => transport.version(),
    call<T>(action: string, payload: unknown = {}, token = ''): Promise<T> {
      const ttl = READ_TTL_MS[action];
      if (ttl === undefined) {
        if (FRESH_READS.has(action)) return transport.call<T>(action, payload, token);
        // คำสั่งเขียน: ของที่เก็บไว้อาจไม่ตรงแล้ว ล้างทั้งก่อนและหลัง (กันคำขอที่ค้างอยู่เก็บค่าเก่ากลับมา)
        memory.clear();
        return transport.call<T>(action, payload, token).finally(() => memory.clear());
      }

      const key = `${action}|${token}|${JSON.stringify(payload)}`;
      const hit = memory.get(key);
      if (hit && Date.now() - hit.at < ttl) return hit.value as Promise<T>;

      const storeKey = options.persist && token === '' && PERSISTED.has(action) ? `${action}|${JSON.stringify(payload)}` : '';
      const saved = storeKey ? stored[storeKey] : undefined;
      const fresh = fetchAndRemember(key, action, payload, token, storeKey);
      if (saved && Date.now() - saved.at < STORE_MAX_AGE_MS) {
        // เปิดเว็บใหม่: ตอบด้วยค่าที่เก็บไว้ทันที ค่าใหม่ที่กำลังโหลดจะถูกใช้ตั้งแต่ครั้งถัดไป
        fresh.catch(() => undefined);
        return Promise.resolve(saved.value as T);
      }
      return fresh as Promise<T>;
    },
  };
}
