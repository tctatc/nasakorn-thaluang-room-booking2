import { describe, expect, it } from 'vitest';
import { validateCredentialChangeInput, validateOwnProfileInput, validateResetPinInput, validateUserAccountInput } from '../schemas/user';
import { defaultLookups, missingDefaultLookups } from '../schemas/lookup';

describe('เปลี่ยนรหัสผ่าน/PIN ของตัวเอง', () => {
  it('ต้องใส่ค่าปัจจุบัน และค่าใหม่ต้องผ่านกฎและไม่ซ้ำของเดิม', () => {
    const missing = validateCredentialChangeInput({ newPassword: 'Mine2026b' }, { password: false, pin: false });
    expect(missing.ok).toBe(false);
    const same = validateCredentialChangeInput({ currentPassword: 'Mine2026b', newPassword: 'Mine2026b' }, { password: false, pin: false });
    expect(same.ok ? [] : same.issues.map((issue) => issue.message)).toContain('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม');
    const easyPin = validateCredentialChangeInput({ currentPin: '582039', newPin: '123456' }, { password: false, pin: false });
    expect(easyPin.ok ? [] : easyPin.issues.map((issue) => issue.message)).toContain('PIN ห้ามเป็นเลขเรียงกัน');
    const ok = validateCredentialChangeInput({ currentPin: '582039', newPin: '691735' }, { password: false, pin: false });
    expect(ok.ok && ok.value).toMatchObject({ changePin: true, changePassword: false });
  });

  it('สิ่งที่ผู้ดูแลบังคับต้องส่งมาครบ — บังคับทั้งคู่แต่ส่งแค่ PIN ไม่ผ่าน', () => {
    const parsed = validateCredentialChangeInput({ currentPin: '582039', newPin: '691735' }, { password: true, pin: true });
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? [] : parsed.issues.map((issue) => issue.field)).toContain('newPassword');
  });

  it('ไม่ส่งอะไรมาเลย ไม่ผ่าน', () => {
    expect(validateCredentialChangeInput({}, { password: false, pin: false }).ok).toBe(false);
  });
});

describe('เบอร์โทรและตัวเลือกบังคับตั้งรหัส', () => {
  it('เบอร์ว่างได้ ถ้ามีต้อง 9–10 หลัก', () => {
    expect(validateOwnProfileInput({ phone: '' }).ok).toBe(true);
    expect(validateOwnProfileInput({ phone: '081-234-5678' }).ok).toBe(true);
    expect(validateOwnProfileInput({ phone: '02 123 4567' }).ok).toBe(true);
    expect(validateOwnProfileInput({ phone: '1234' }).ok).toBe(false);
    expect(validateOwnProfileInput({ phone: '081-234-5678 ต่อ 12' }).ok).toBe(false);
  });

  it('requireChange เป็นค่า false ถ้าไม่ส่ง (server รุ่นเก่า/หน้าเว็บรุ่นเก่ายังทำงานเหมือนเดิม)', () => {
    const account = validateUserAccountInput({ username: 'abc', displayName: 'ทดสอบ', role: 'staff' }, { requirePin: false });
    expect(account.ok && account.value).toMatchObject({ requireChange: false, phone: '' });
    const pin = validateResetPinInput({ username: 'abc', pin: '582039' });
    expect(pin.ok && pin.value.requireChange).toBe(false);
  });
});

describe('รายชื่อแผนกตั้งต้น', () => {
  it('ครอบคลุมทุกสาขาในประกาศรับสมัคร 2570 และรหัสเดิมยังอยู่', () => {
    const labels = defaultLookups().filter((item) => item.kind === 'department').map((item) => item.label);
    for (const field of ['ช่างยนต์', 'ยานยนต์ไฟฟ้า', 'ช่างกลโรงงาน', 'ช่างซ่อมบำรุง', 'ช่างเชื่อมโลหะ', 'ไฟฟ้า', 'อิเล็กทรอนิกส์',
      'เมคคาทรอนิกส์และหุ่นยนต์', 'เทคนิคอุตสาหกรรม', 'เทคโนโลยีคอมพิวเตอร์', 'เทคโนโลยีธุรกิจดิจิทัล', 'เทคโนโลยีสารสนเทศ', 'การบัญชี', 'การตลาด']) {
      expect(labels.some((label) => label.includes(field)), field).toBe(true);
    }
    const keys = defaultLookups().filter((item) => item.kind === 'department').map((item) => item.key);
    expect(keys).toEqual(expect.arrayContaining(['acc', 'dbt', 'mkt', 'auto', 'elec', 'etro', 'mech', 'weld', 'gen', 'digital', 'plan']));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('เติมเฉพาะรหัสที่ยังไม่มี ไม่แตะรายการเดิม', () => {
    const existing = [{ kind: 'department', key: 'acc' }, { kind: 'department', key: 'auto' }, { kind: 'position', key: 'it' }];
    const missing = missingDefaultLookups(existing, 'department');
    expect(missing.map((item) => item.key)).not.toContain('acc');
    expect(missing.map((item) => item.key)).toContain('it');
    expect(missing.every((item) => item.kind === 'department')).toBe(true);
  });
});
