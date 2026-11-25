import { afterEach, describe, expect, it } from 'vitest';
import { forgetBookerProfile, readBookerProfile, saveBookerProfile } from '../bookerMemory';

const profile = { namePrefix: 'นาง', bookerName: ' สมศรี ใจดี ', position: 'ครู', department: 'แผนกวิชาการบัญชี', phone: '081-234-5678' };
afterEach(() => window.localStorage.clear());

describe('จำข้อมูลผู้จองไว้ในเครื่อง', () => {
  it('บันทึกแล้วอ่านกลับได้ (ตัดช่องว่างหัวท้าย) และ "ไม่ใช่ฉัน" ลบทิ้ง', () => {
    expect(readBookerProfile()).toBeNull();
    saveBookerProfile(profile);
    expect(readBookerProfile()).toEqual({ ...profile, bookerName: 'สมศรี ใจดี' });
    forgetBookerProfile();
    expect(readBookerProfile()).toBeNull();
  });

  it('จำแค่ข้อมูลผู้จอง ไม่เก็บช่องอื่นที่หลุดมา', () => {
    saveBookerProfile({ ...profile, title: 'ความลับ' } as typeof profile);
    expect(window.localStorage.getItem('mrb.booker.v1')).not.toContain('ความลับ');
  });

  it('ข้อมูลเสียหรือขาดชื่อ/เบอร์ ถือว่าไม่มี (ฟอร์มเปิดให้กรอกปกติ)', () => {
    window.localStorage.setItem('mrb.booker.v1', '{not json');
    expect(readBookerProfile()).toBeNull();
    window.localStorage.setItem('mrb.booker.v1', JSON.stringify({ ...profile, phone: '' }));
    expect(readBookerProfile()).toBeNull();
  });
});
