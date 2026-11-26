/**
 * ผู้ใช้จัดการบัญชีของตัวเอง (หน้า "ของฉัน")
 *
 *  - เปลี่ยนรหัสผ่าน / PIN: ต้องใส่ค่าปัจจุบันเสมอ ผิดนับรวมกับตัวนับล็อกบัญชี (5 ครั้ง ล็อก 15 นาที)
 *    สำเร็จแล้ว session เก่าทุกเครื่องหลุด เครื่องนี้ได้ token ใหม่ต่อเลย
 *  - แก้ข้อมูลตัวเองได้แค่เบอร์โทร ชื่อ สาขา ตำแหน่ง สิทธิ์ เป็นของผู้ดูแล
 */

function changeOwnCredentials_(sessionUser, raw) {
  const username = sessionUser.email;
  assertNotLocked_(username);
  let failed = '';
  const row = withScriptLock_(function () {
    const current = findByKey_(Domain.SHEET_USERS, username);
    if (current === null) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบบัญชีผู้ใช้');
    const parsed = Domain.validateCredentialChangeInput(raw, {
      password: Domain.readBoolean(current, 'mustChangePassword', false),
      pin: Domain.readBoolean(current, 'mustChangePin', false),
    });
    if (!parsed.ok) throw appError_(ERROR_CODES.VALIDATION, 'ข้อมูลไม่ถูกต้อง', parsed.issues);
    const input = parsed.value;

    if (input.changePassword && !passwordMatches_(current, input.currentPassword)) {
      failed = 'รหัสผ่านปัจจุบันไม่ถูกต้อง';
      return null;
    }
    if (input.changePin && !pinMatches_(current, input.currentPin)) {
      failed = 'PIN ปัจจุบันไม่ถูกต้อง';
      return null;
    }
    if (input.changePin) {
      const taken = readAll_(Domain.SHEET_USERS).objects.some(function (other) {
        return String(other.username) !== username && pinMatches_(other, input.newPin);
      });
      // "PIN นี้มีคนใช้แล้ว" บอกใบ้ว่ามีบัญชีที่ใช้ PIN นี้ (เข้าด้วย PIN อย่างเดียวได้)
      // จึงนับเป็นการใส่ผิด ลองสุ่มไล่หา PIN คนอื่นได้ไม่เกิน 5 ครั้งก่อนบัญชีถูกล็อก
      if (taken) {
        failed = Domain.PIN_TAKEN_MESSAGE;
        return null;
      }
    }

    const patch = { tokenVersion: (Number(current.tokenVersion) || 1) + 1, updatedAt: nowIso_() };
    if (input.changePassword) Object.assign(patch, newPasswordCredential_(username, input.newPassword), { mustChangePassword: false });
    if (input.changePin) Object.assign(patch, newPinCredential_(username, input.newPin), { mustChangePin: false });
    updateByKey_(Domain.SHEET_USERS, username, patch);
    audit_(username, 'user.changeOwnCredentials', 'user', username, { password: input.changePassword, pin: input.changePin });
    return Object.assign({}, current, patch);
  });

  if (row === null) {
    // นับนอกล็อก แล้วตอบเหมือนการเข้าสู่ระบบผิด — ใส่ผิดซ้ำ ๆ จะโดนล็อกบัญชี
    recordPinFailure_(username);
    if (failed === Domain.PIN_TAKEN_MESSAGE) throw appError_(ERROR_CODES.CONFLICT, failed, [{ field: 'newPin', message: failed }]);
    throw appError_(ERROR_CODES.VALIDATION, failed, [{ field: failed.indexOf('PIN') === 0 ? 'currentPin' : 'currentPassword', message: failed }]);
  }
  return issueSession_(row);
}

function updateOwnProfile_(sessionUser, raw) {
  const parsed = Domain.validateOwnProfileInput(raw);
  if (!parsed.ok) throw appError_(ERROR_CODES.VALIDATION, 'ข้อมูลไม่ถูกต้อง', parsed.issues);
  return withScriptLock_(function () {
    const row = findByKey_(Domain.SHEET_USERS, sessionUser.email);
    if (row === null) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบบัญชีผู้ใช้');
    const patch = { phone: parsed.value.phone, updatedAt: nowIso_() };
    updateByKey_(Domain.SHEET_USERS, sessionUser.email, patch);
    audit_(sessionUser.email, 'user.updateOwnProfile', 'user', sessionUser.email, {});
    return { user: publicUser_(Object.assign({}, row, patch)) };
  });
}
