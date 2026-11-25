/**
 * ผู้ดูแลแก้ไข / ลบคำขอที่ส่งมาแล้ว และล้างข้อมูลการจองทั้งหมดเพื่อเริ่มบันทึกใหม่
 *
 * กติกา:
 *  - เรียกได้เฉพาะผู้ดูแล (requireAdmin_ ใน 50_Api.gs) และเขียนภายในล็อกเสมอ
 *  - แก้ไม่ได้: สถานะ ผลการลงนาม ผู้ส่ง รหัสติดตาม (ห้ามปลอมประวัติการอนุมัติ)
 *  - ทุกการแก้/ลบ/ล้าง ลง AuditLogs พร้อมค่าเดิม ตรวจย้อนหลังได้ว่าใครทำอะไร
 *  - ล้างข้อมูล: คัดลอกชีตไว้เป็นชีตสำรองก่อนเสมอ กู้คืนได้ด้วยการคัดลอกแถวกลับ
 */

/** คำขอเดิมในรูปแบบเดียวกับฟอร์มจอง — ใช้เป็นฐานให้ผู้ดูแลแก้ทับ */
function bookingRequestFromRow_(row) {
  const view = publicBooking_(row, 'owner');
  return {
    bookerName: view.bookerName, title: view.title, roomId: view.roomId, dateKey: view.dateKey,
    startMin: view.startMin, endMin: view.endMin, attendees: view.attendees, department: view.department,
    requesterPosition: view.requesterPosition, requesterPhone: view.requesterPhone, note: view.note,
    equipment: view.equipment, requestedFacilities: view.requestedFacilities, meetingType: view.meetingType,
    extraFurnitureCount: view.extraFurnitureCount, otherFacility: view.otherFacility, termsAccepted: true,
    customLocation: view.customLocation,
  };
}

function adminUpdateBooking_(admin, raw) {
  return withScriptLock_(function () {
    const bookingId = String((raw && raw.bookingId) || '');
    const row = findByKey_(Domain.SHEET_BOOKINGS, bookingId);
    if (!row) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบรายการจอง อาจถูกลบไปแล้ว');
    const merged = Domain.mergeAdminEdit(bookingRequestFromRow_(row), raw);
    if (!merged.ok) throw appError_(ERROR_CODES.VALIDATION, merged.issues[0].message, merged.issues);
    const input = merged.value.request;
    if (merged.value.changes.length === 0) return { booking: publicBooking_(row, admin), changed: 0 };

    const roomRow = findByKey_(Domain.SHEET_ROOMS, input.roomId);
    if (!roomRow) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบห้องประชุม');
    const room = publicRoom_(roomRow);
    const issues = Domain.adminEditRuleIssues(input, { settings: readSettings_(), room: room, now: serverNow_() });
    if (issues.length) throw appError_(ERROR_CODES.VALIDATION, issues[0].message, issues);
    const openLocation = Domain.isOpenLocationRoom(room);
    if (openLocation && input.customLocation.trim() === '') {
      throw appError_(ERROR_CODES.VALIDATION, 'กรุณาระบุสถานที่');
    }
    if (!openLocation) {
      const rows = readHotColumns_(Domain.SHEET_BOOKINGS, Domain.BOOKING_HOT_COLUMNS).objects;
      if (Domain.editConflicts(rows, bookingId, input, Domain.normalizeDateKey).length) {
        throw appError_(ERROR_CODES.CONFLICT, 'เวลาใหม่ชนกับการจองอื่นในห้องนี้ กรุณาเลือกเวลาอื่น');
      }
    }
    const patch = {
      roomId: room.roomId, roomCode: room.code, roomName: room.name, dateKey: input.dateKey,
      startMin: input.startMin, endMin: input.endMin, durationMin: input.endMin - input.startMin,
      startAt: Domain.fromDateKeyAndMinutes(input.dateKey, input.startMin).toISOString(),
      endAt: Domain.fromDateKeyAndMinutes(input.dateKey, input.endMin).toISOString(),
      title: input.title, bookerName: input.bookerName, department: input.department,
      requesterPosition: input.requesterPosition, requesterPhone: input.requesterPhone,
      attendees: input.attendees, note: input.note, customLocation: openLocation ? input.customLocation : '',
      updatedBy: admin.email, updatedAt: nowIso_(),
    };
    updateByKey_(Domain.SHEET_BOOKINGS, bookingId, patch);
    audit_(admin.email, 'booking.admin.edit', 'booking', bookingId, { changes: merged.value.changes });
    bumpDataVersion_();
    return { booking: publicBooking_(Object.assign({}, row, patch), admin), changed: merged.value.changes.length };
  });
}

function adminDeleteBooking_(admin, payload) {
  const bookingId = String((payload && payload.bookingId) || '');
  const reason = String((payload && payload.reason) || '').trim().slice(0, 300);
  return withScriptLock_(function () {
    const row = findByKey_(Domain.SHEET_BOOKINGS, bookingId);
    if (!row) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบรายการจอง อาจถูกลบไปแล้ว');
    deleteByKey_(Domain.SHEET_BOOKINGS, bookingId);
    // รีวิวของคำขอนี้ไม่มีความหมายแล้ว (คีย์ของชีต Reviews คือ bookingId)
    deleteByKey_(Domain.SHEET_REVIEWS, bookingId);
    if (row.attachmentFileId) trashAttachmentFile_(String(row.attachmentFileId));
    // เก็บสาระสำคัญไว้ใน audit — ลบจากชีตแล้วยังตรวจย้อนหลังได้ว่าเคยมีคำขอนี้
    audit_(admin.email, 'booking.admin.delete', 'booking', bookingId, {
      reason: reason, title: String(row.title || ''), roomName: String(row.roomName || ''),
      dateKey: Domain.normalizeDateKey(row.dateKey), startMin: Number(row.startMin), endMin: Number(row.endMin),
      bookerName: String(row.bookerName || row.userName || ''), status: String(row.status),
    });
    bumpDataVersion_();
    return { deleted: bookingId };
  });
}

/** ล้างการจองและรีวิวทั้งหมด (ห้อง ผู้ใช้ ค่าตั้งค่า และ AuditLogs คงเดิม) — สำรองชีตไว้ก่อนเสมอ */
function adminResetBookings_(admin, payload) {
  if (String((payload && payload.confirm) || '').trim() !== Domain.RESET_CONFIRM_PHRASE) {
    throw appError_(ERROR_CODES.VALIDATION, `พิมพ์คำว่า "${Domain.RESET_CONFIRM_PHRASE}" ให้ตรงเพื่อยืนยัน`);
  }
  return withScriptLock_(function () {
    const book = openBook_();
    const stamp = Utilities.formatDate(serverNow_(), 'Asia/Bangkok', 'yyyy-MM-dd HHmm');
    const result = { backups: [], cleared: {} };
    [Domain.SHEET_BOOKINGS, Domain.SHEET_REVIEWS].forEach(function (name) {
      const sheet = getSheet_(name);
      const lastRow = sheet.getLastRow();
      result.cleared[name] = Math.max(0, lastRow - 1);
      if (lastRow < 2) return;
      const backupName = `สำรอง ${name} ${stamp}`;
      const copy = sheet.copyTo(book).setName(book.getSheetByName(backupName) ? `${backupName} (${newId_('b').slice(-4)})` : backupName);
      copy.hideSheet();
      result.backups.push(copy.getName());
      // ล้างเนื้อหา ไม่ลบแถว — Sheets ไม่ยอมให้ลบทุกแถวที่ไม่ได้ตรึง และหัวตารางต้องอยู่ครบ
      sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
    });
    clearStoreCache_();
    audit_(admin.email, 'booking.admin.reset', 'system', 'bookings', result);
    bumpDataVersion_();
    return result;
  });
}
