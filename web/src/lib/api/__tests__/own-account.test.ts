import { afterEach, describe, expect, it } from 'vitest';
import { createDemoTransport, DEMO_LOGINS } from '../demo';
import type { LoginResult } from '../types';

const secretOf = (username: string) => DEMO_LOGINS.find((item) => item.username === username)!;
async function login(transport: ReturnType<typeof createDemoTransport>, username: string, password = secretOf(username).password) {
  return transport.call<LoginResult>('login', { username, password });
}
afterEach(() => window.localStorage.clear());

const newUser = (overrides: Record<string, unknown> = {}) => ({
  username: 'newbie', displayName: 'นางสาวใหม่ ทดลอง', department: 'แผนกวิชาเทคโนโลยีสารสนเทศ', position: 'ครู',
  phone: '081-000-1111', role: 'staff', status: 'active', allowedRoomIds: [], pin: '582039', password: 'Temp2026a',
  requireChange: true, ...overrides,
});

describe('ไล่หา PIN ของคนอื่นผ่านการเปลี่ยน PIN ไม่ได้', () => {
  it('ได้คำตอบ "PIN มีคนใช้แล้ว" ซ้ำ ๆ จะถูกล็อกเหมือนใส่ผิด', async () => {
    const transport = createDemoTransport();
    const { token } = await login(transport, 'teacher');
    const taken = secretOf('watcharapong').pin;
    for (let i = 0; i < 5; i += 1) {
      await expect(transport.call('changeOwnCredentials', { currentPin: secretOf('teacher').pin, newPin: taken }, token))
        .rejects.toMatchObject({ code: 'CONFLICT' });
    }
    await expect(transport.call('changeOwnCredentials', { currentPin: secretOf('teacher').pin, newPin: '418529' }, token))
      .rejects.toMatchObject({ code: 'BUSY' });
  });
});

describe('บังคับตั้งรหัสเองตอนเข้าครั้งแรก (เรียก API ตรง ไม่ผ่านหน้าเว็บ)', () => {
  it('บัญชีที่ต้องตั้งรหัสใหม่ เรียกคำสั่งอื่นไม่ได้เลยจนกว่าจะตั้งเสร็จ', async () => {
    const transport = createDemoTransport();
    const admin = (await login(transport, 'shoyu')).token;
    await transport.call('createUser', newUser(), admin);

    const first = await login(transport, 'newbie', 'Temp2026a');
    expect(first.user).toMatchObject({ mustChangePassword: true, mustChangePin: true, phone: '081-000-1111' });
    // อ่านตัวเองได้ (หน้าเว็บต้องรู้ว่าต้องพาไปหน้าตั้งรหัส) แต่ทำอย่างอื่นไม่ได้
    await expect(transport.call('bootstrap', {}, first.token)).resolves.toBeDefined();
    for (const action of ['bookings', 'rooms', 'createBooking', 'announcements', 'updateOwnProfile']) {
      await expect(transport.call(action, {}, first.token)).rejects.toMatchObject({ code: 'CHANGE_REQUIRED' });
    }

    // ต้องเปลี่ยนทั้งสองอย่างที่ผู้ดูแลสั่ง — ส่งแค่รหัสผ่านไม่พอ
    await expect(transport.call('changeOwnCredentials', { currentPassword: 'Temp2026a', newPassword: 'Mine2026b' }, first.token))
      .rejects.toMatchObject({ code: 'VALIDATION' });

    const changed = await transport.call<LoginResult>('changeOwnCredentials', {
      currentPassword: 'Temp2026a', newPassword: 'Mine2026b', currentPin: '582039', newPin: '691735',
    }, first.token);
    expect(changed.user).toMatchObject({ mustChangePassword: false, mustChangePin: false });
    // token เก่าใช้ไม่ได้แล้ว ใช้ token ใหม่ได้ทุกคำสั่ง
    await expect(transport.call('bookings', {}, first.token)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(transport.call('bookings', {}, changed.token)).resolves.toBeDefined();

    // รหัสที่ผู้ดูแลรู้ใช้ไม่ได้แล้ว
    await expect(login(transport, 'newbie', 'Temp2026a')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(transport.call('loginPin', { pin: '582039' })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(transport.call('loginPin', { pin: '691735' })).resolves.toMatchObject({ user: { email: 'newbie' } });
  });

  it('ไม่ติ๊ก = ใช้งานได้ทันทีเหมือนเดิม และรีเซ็ตแบบติ๊กบังคับเฉพาะสิ่งที่รีเซ็ต', async () => {
    const transport = createDemoTransport();
    const admin = (await login(transport, 'shoyu')).token;
    await transport.call('createUser', newUser({ requireChange: false }), admin);
    const plain = await login(transport, 'newbie', 'Temp2026a');
    expect(plain.user).toMatchObject({ mustChangePassword: false, mustChangePin: false });
    await expect(transport.call('rooms', {}, plain.token)).resolves.toBeDefined();

    await transport.call('resetUserPin', { username: 'newbie', pin: '730264', requireChange: true }, admin);
    const after = await login(transport, 'newbie', 'Temp2026a');
    expect(after.user).toMatchObject({ mustChangePassword: false, mustChangePin: true });
    // บังคับแค่ PIN: ไม่ต้องส่งรหัสผ่าน
    const done = await transport.call<LoginResult>('changeOwnCredentials', { currentPin: '730264', newPin: '418529' }, after.token);
    expect(done.user.mustChangePin).toBe(false);
  });

  it('เปลี่ยนรหัสของตัวเองต้องใส่ค่าปัจจุบันถูก ผิดซ้ำ ๆ แล้วบัญชีถูกล็อก', async () => {
    const transport = createDemoTransport();
    const { token } = await login(transport, 'teacher');
    await expect(transport.call('changeOwnCredentials', { currentPassword: 'wrong-pass1', newPassword: 'Another2026' }, token))
      .rejects.toMatchObject({ code: 'VALIDATION', message: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
    for (let i = 0; i < 4; i += 1) {
      await transport.call('changeOwnCredentials', { currentPassword: 'wrong-pass1', newPassword: 'Another2026' }, token).catch(() => undefined);
    }
    await expect(transport.call('changeOwnCredentials', { currentPassword: secretOf('teacher').password, newPassword: 'Another2026' }, token))
      .rejects.toMatchObject({ code: 'BUSY' });
  });

  it('PIN ใหม่ต้องไม่ซ้ำกับของคนอื่น และแก้เบอร์ตัวเองได้แค่เบอร์', async () => {
    const transport = createDemoTransport();
    const { token } = await login(transport, 'teacher');
    await expect(transport.call('changeOwnCredentials', { currentPin: secretOf('teacher').pin, newPin: secretOf('watcharapong').pin }, token))
      .rejects.toMatchObject({ code: 'CONFLICT' });

    const result = await transport.call<{ user: { phone: string; role: string; displayName: string } }>(
      'updateOwnProfile', { phone: '089-777-6655', role: 'admin', displayName: 'แฮก' }, token,
    );
    expect(result.user).toMatchObject({ phone: '089-777-6655', role: 'staff' });
    expect(result.user.displayName).not.toBe('แฮก');
    await expect(transport.call('updateOwnProfile', { phone: 'abc' }, token)).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
