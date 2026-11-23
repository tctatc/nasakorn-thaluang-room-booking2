import { normalizeTrackingCode } from '@shared/schemas/guest';
import { readLocal, writeLocal } from '../../lib/storage';

/**
 * รหัสติดตามที่เครื่องนี้เคยจองไว้ — ให้ผู้จองทั่วไป (ไม่มีบัญชี) กลับมาดูสถานะได้โดยไม่ต้องจดรหัส
 * เก็บแค่รหัสกับข้อมูลที่ใช้แสดงในรายการ (ไม่เก็บชื่อหรือเบอร์โทร) และลบออกจากเครื่องได้เสมอ
 */
const KEY = 'mrb.my-tracking.v1';
const MAX_ITEMS = 30;

export interface RememberedBooking {
  code: string;
  title: string;
  dateKey: string;
  startMin: number;
  endMin: number;
  roomId: string;
}

export function rememberedBookings(): RememberedBooking[] {
  try {
    const parsed: unknown = JSON.parse(readLocal(KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is RememberedBooking =>
      typeof item === 'object' && item !== null && normalizeTrackingCode((item as RememberedBooking).code) !== '',
    );
  } catch {
    return [];
  }
}

export function rememberTracking(item: RememberedBooking): void {
  if (normalizeTrackingCode(item.code) === '') return;
  const rest = rememberedBookings().filter((existing) => existing.code !== item.code);
  writeLocal(KEY, JSON.stringify([item, ...rest].slice(0, MAX_ITEMS)));
}

export function forgetTracking(code: string): void {
  writeLocal(KEY, JSON.stringify(rememberedBookings().filter((item) => item.code !== code)));
}
