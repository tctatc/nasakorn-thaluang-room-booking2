import { readLocal, removeLocal, writeLocal } from '../../lib/storage';

/**
 * ข้อมูลผู้จองที่จำไว้ "ในเครื่องนี้" — จองครั้งต่อไปไม่ต้องพิมพ์ชื่อ ตำแหน่ง สาขา เบอร์ซ้ำ
 *
 * เก็บใน localStorage ของเบราว์เซอร์เท่านั้น ไม่ส่งไปไหนจนกว่าผู้ใช้จะกดส่งคำขอเอง
 * เก็บเฉพาะเมื่อผู้ใช้ติ๊ก "จำข้อมูล" และลบได้ทันทีด้วยปุ่ม "ไม่ใช่ฉัน" (กันเครื่องที่ใช้ร่วมกัน)
 * ไม่จำเรื่องที่ประชุม รายละเอียด หรือไฟล์แนบ
 */
export interface BookerProfile {
  namePrefix: string;
  bookerName: string;
  position: string;
  department: string;
  phone: string;
}

const KEY = 'mrb.booker.v1';
const FIELDS: (keyof BookerProfile)[] = ['namePrefix', 'bookerName', 'position', 'department', 'phone'];

export function readBookerProfile(): BookerProfile | null {
  try {
    const raw = JSON.parse(readLocal(KEY) ?? 'null') as unknown;
    if (!raw || typeof raw !== 'object') return null;
    const record = raw as Record<string, unknown>;
    const profile = Object.fromEntries(FIELDS.map((field) => [field, typeof record[field] === 'string' ? String(record[field]).slice(0, 120) : ''])) as unknown as BookerProfile;
    // ชื่อกับเบอร์คือแกนของข้อมูล ถ้าหายไปถือว่าไม่มีข้อมูลที่จำไว้
    return profile.bookerName.trim() && profile.phone.trim() ? profile : null;
  } catch {
    return null;
  }
}

export function saveBookerProfile(profile: BookerProfile): void {
  writeLocal(KEY, JSON.stringify(Object.fromEntries(FIELDS.map((field) => [field, profile[field].trim()]))));
}

export function forgetBookerProfile(): void {
  removeLocal(KEY);
}

/** ค่าเริ่มต้นของช่อง "จำข้อมูล": มือถือ/แท็บเล็ตติ๊กไว้ (มักเป็นเครื่องส่วนตัว) คอมไม่ติ๊ก (อาจเป็นเครื่องส่วนกลาง) */
export function rememberByDefault(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}
