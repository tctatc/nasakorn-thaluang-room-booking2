/** API สำหรับรายการห้องและการจอง — การตัดสินพร้อมเขียนทำภายใน Script Lock */

function publicRoom_(row) {
  return {
    roomId: String(row.roomId), code: String(row.code), name: String(row.name),
    description: String(row.description || ''), location: String(row.location || ''),
    capacity: Number(row.capacity) || 0, equipment: Domain.readList(row, 'equipment'),
    imageUrl: String(row.imageUrl || '') || null, status: String(row.status),
  };
}

/** ผู้ใช้ที่ผู้ดูแลจำกัดห้องไว้ เห็นเฉพาะห้องที่ได้รับสิทธิ์ (ผู้ดูแลเห็นทุกห้อง) */
function listRooms_(user) {
  return { rooms: readAll_(Domain.SHEET_ROOMS).objects.map(publicRoom_).filter(function (room) {
    return Domain.canUseRoom(user, room.roomId);
  }) };
}

/**
 * viewer: ผู้ที่จะเห็นข้อมูลนี้ — รหัสติดตามเป็นกุญแจของคำขอ ส่งให้เฉพาะเจ้าของและผู้ดูแลเท่านั้น
 * (ผู้ลงนามเห็นรายการทุกคนแต่ไม่ต้องได้รหัสของคนอื่น)
 */
function publicBooking_(row, viewer) {
  const ownsCode = viewer === 'owner' || (viewer && (viewer.role === 'admin' || viewer.email === String(row.userEmail)));
  return {
    trackingCode: ownsCode ? String(row.trackingCode || '') : '',
    bookingId: String(row.bookingId), roomId: String(row.roomId), dateKey: Domain.normalizeDateKey(row.dateKey),
    startMin: Number(row.startMin), endMin: Number(row.endMin), status: String(row.status),
    title: String(row.title || ''), bookerName: String(row.bookerName || row.userName),
    userEmail: String(row.userEmail), userName: String(row.userName),
    department: String(row.department || ''), attendees: Number(row.attendees) || 0,
    equipment: Domain.readList(row, 'equipment'), note: String(row.note || ''),
    requesterPosition: String(row.requesterPosition || ''), requesterPhone: String(row.requesterPhone || ''),
    requestedFacilities: Domain.readList(row, 'requestedFacilities'),
    extraFurnitureCount: Number(row.extraFurnitureCount) || 0, otherFacility: String(row.otherFacility || ''),
    termsAccepted: String(row.termsAccepted) === 'true',
    customLocation: String(row.customLocation || ''),
    meetingType: String(row.meetingType || ''),
    createdAt: String(row.createdAt || ''),
    approvalStep: Domain.currentApprovalStep({ status: String(row.status), approvalStep: row.approvalStep }),
    approvalLog: Domain.parseApprovalLog(row.approvalLog),
    // ชื่อ/ชนิด/ขนาดไฟล์เท่านั้น — ตัวไฟล์ต้องขอผ่าน bookingAttachment ซึ่งตรวจสิทธิ์อีกชั้น
    attachment: Domain.attachmentMetaFromRow(row),
  };
}

function listBookings_(user, payload) {
  const rows = readAll_(Domain.SHEET_BOOKINGS).objects;
  const from = typeof payload.from === 'string' ? payload.from : '';
  const to = typeof payload.to === 'string' ? payload.to : '';
  return { bookings: rows.filter(function (row) {
    return (Domain.canSeeAllBookings(user.role) || String(row.userEmail) === user.email) &&
      (!from || Domain.normalizeDateKey(row.dateKey) >= from) && (!to || Domain.normalizeDateKey(row.dateKey) <= to);
  }).map(function (row) { return publicBooking_(row, user); }) };
}

/**
 * ช่วงเวลาที่ห้องถูกจองไว้ในวันนั้น — ให้ฟอร์มจองบอกผู้ใช้ตั้งแต่ตอนกรอก
 * ทุกคนที่ล็อกอินเรียกได้ เพราะส่งกลับแค่ช่วงเวลาและสถานะ ไม่มีชื่อหรือหัวข้อของใคร
 * การตัดสินจริงยังอยู่ที่ createBooking_ ซึ่งตรวจซ้ำในล็อกเสมอ
 */
function roomAvailability_(user, raw) {
  const parsed = Domain.validateAvailabilityInput(raw);
  if (!parsed.ok) throw appError_(ERROR_CODES.VALIDATION, 'ข้อมูลไม่ถูกต้อง', parsed.issues);
  // ห้อง "อื่น ๆ" แต่ละรายการเป็นคนละสถานที่ ไม่มีช่วงที่ชนกัน
  if (Domain.isOpenLocationRoom(findByKey_(Domain.SHEET_ROOMS, parsed.value.roomId))) return { busy: [] };
  const rows = readHotColumns_(Domain.SHEET_BOOKINGS, Domain.BOOKING_HOT_COLUMNS).objects;
  return { busy: Domain.busySlotsFor(rows, parsed.value.roomId, parsed.value.dateKey) };
}

function createBooking_(user, raw) {
  const parsed = Domain.validateBookingRequest(raw);
  if (!parsed.ok) throw appError_(ERROR_CODES.VALIDATION, 'ข้อมูลการจองไม่ถูกต้อง', parsed.issues);
  return createBookingAs_(user, parsed.value, parseAttachment_(raw));
}

/**
 * บันทึกการจองในนามของ actor — ผู้ใช้ที่ล็อกอิน หรือผู้จองทั่วไป (role 'guest', ดู 65_Public.gs)
 * ตัดสินห้องว่าง/กฎการจองภายในล็อกเสมอ ไม่ว่าใครจอง
 */
function createBookingAs_(user, input, attachment) {
  if (!input.termsAccepted) throw appError_(ERROR_CODES.VALIDATION, 'กรุณายอมรับเงื่อนไขการใช้ห้องประชุม');
  const lookups = readLookups_();
  if (Domain.unknownLookupKeys(lookups, 'facility', input.requestedFacilities).length > 0) {
    throw appError_(ERROR_CODES.VALIDATION, 'มีอุปกรณ์ที่ถูกปิดใช้ไปแล้ว กรุณาเลือกใหม่');
  }
  if (input.meetingType !== '' && Domain.unknownLookupKeys(lookups, 'meetingType', [input.meetingType]).length > 0) {
    throw appError_(ERROR_CODES.VALIDATION, 'ประเภทการประชุมนี้ถูกปิดใช้ไปแล้ว กรุณาเลือกใหม่');
  }
  const saved = withScriptLock_(function () {
    const roomRow = findByKey_(Domain.SHEET_ROOMS, input.roomId);
    if (!roomRow) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบห้องประชุม');
    const room = publicRoom_(roomRow);
    if (!Domain.canUseRoom(user, room.roomId)) {
      throw appError_(ERROR_CODES.FORBIDDEN, 'บัญชีของคุณยังไม่ได้รับสิทธิ์จองห้องนี้ กรุณาติดต่อผู้ดูแลระบบ');
    }
    const bookingRows = readAll_(Domain.SHEET_BOOKINGS).objects;
    const activeCount = bookingRows.filter(function (row) {
      return String(row.userEmail) === user.email && ['pending', 'confirmed'].indexOf(String(row.status)) >= 0;
    }).length;
    const ruleResult = Domain.validateBookingRules(input, {
      settings: readSettings_(), room: room, now: serverNow_(), isAdmin: user.role === 'admin',
      activeBookingCount: activeCount,
    });
    if (!ruleResult.ok) throw appError_(ERROR_CODES.VALIDATION, 'ไม่ผ่านเงื่อนไขการจอง', ruleResult.issues);
    const openLocation = Domain.isOpenLocationRoom(room);
    if (openLocation && input.customLocation.trim() === '') {
      throw appError_(ERROR_CODES.VALIDATION, 'กรุณาระบุสถานที่ที่ต้องการใช้');
    }
    const conflicts = openLocation ? [] : bookingRows.filter(function (row) {
      return String(row.roomId) === room.roomId && Domain.normalizeDateKey(row.dateKey) === input.dateKey &&
        ['pending', 'confirmed'].indexOf(String(row.status)) >= 0 &&
        Domain.overlaps(input, { startMin: Number(row.startMin), endMin: Number(row.endMin) });
    });
    if (conflicts.length) throw appError_(ERROR_CODES.CONFLICT, 'ช่วงเวลานี้มีผู้จองแล้ว กรุณาเลือกเวลาใหม่');
    const now = nowIso_();
    const needsApproval = readSettings_().approvalRequired;
    const bookingId = newId_('bk');
    // บันทึกไฟล์หลังผ่านทุกเงื่อนไขแล้วเท่านั้น จองไม่สำเร็จจะได้ไม่มีไฟล์ค้างใน Drive
    const file = attachment ? saveAttachmentFile_(bookingId, attachment) : null;
    const booking = {
      bookingId: bookingId, roomId: room.roomId, dateKey: input.dateKey,
      startMin: input.startMin, endMin: input.endMin,
      status: needsApproval ? 'pending' : 'confirmed', title: input.title,
      approvalStep: needsApproval ? 1 : 0, approvalLog: '[]', customLocation: openLocation ? input.customLocation : '',
      bookerName: input.bookerName,
      roomCode: room.code, roomName: room.name, userEmail: user.email, userName: user.displayName,
      department: input.department || user.department, attendees: input.attendees,
      equipment: Domain.writeList(input.equipment), note: input.note,
      requesterPosition: input.requesterPosition, requesterPhone: input.requesterPhone,
      requestedFacilities: Domain.writeList(input.requestedFacilities), meetingType: input.meetingType,
      extraFurnitureCount: input.extraFurnitureCount, otherFacility: input.otherFacility,
      termsAccepted: input.termsAccepted, termsAcceptedAt: input.termsAccepted ? now : '',
      durationMin: input.endMin - input.startMin,
      startAt: Domain.fromDateKeyAndMinutes(input.dateKey, input.startMin).toISOString(),
      endAt: Domain.fromDateKeyAndMinutes(input.dateKey, input.endMin).toISOString(),
      createdBy: user.email, createdAt: now, updatedBy: user.email, updatedAt: now,
      trackingCode: newTrackingCode_(),
      attachmentFileId: file ? file.fileId : '', attachmentName: attachment ? attachment.name : '',
      attachmentMime: attachment ? attachment.mimeType : '', attachmentSize: attachment ? attachment.size : '',
    };
    try {
      appendObject_(Domain.SHEET_BOOKINGS, booking);
    } catch (error) {
      if (file) trashAttachmentFile_(file.fileId);
      throw error;
    }
    audit_(user.email, 'booking.create', 'booking', booking.bookingId, {
      roomId: room.roomId, dateKey: input.dateKey, attachment: attachment ? attachment.name : '',
    });
    bumpDataVersion_();
    return booking;
  });
  // แจ้ง LINE นอกล็อก (ใช้เวลาเรียกเครือข่าย) — ส่งไม่สำเร็จไม่กระทบการจองที่บันทึกแล้ว
  notifyBookingCreated_(saved);
  return { booking: publicBooking_(saved, 'owner'), trackingCode: saved.trackingCode };
}

function cancelBooking_(user, payload) {
  return withScriptLock_(function () {
    const row = findByKey_(Domain.SHEET_BOOKINGS, payload.bookingId);
    if (!row) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบรายการจอง');
    if (user.role !== 'admin' && String(row.userEmail) !== user.email) {
      throw appError_(ERROR_CODES.FORBIDDEN, 'ไม่มีสิทธิ์ยกเลิกรายการนี้');
    }
    if (['pending', 'confirmed'].indexOf(String(row.status)) < 0) {
      throw appError_(ERROR_CODES.CONFLICT, 'รายการนี้ยกเลิกไม่ได้');
    }
    const settings = readSettings_();
    const cancelRule = Domain.canCancelBooking({
      startInstant: Domain.fromDateKeyAndMinutes(Domain.normalizeDateKey(row.dateKey), Number(row.startMin)),
      now: serverNow_(), settings: settings, isAdmin: user.role === 'admin',
    });
    if (!cancelRule.ok) throw appError_(ERROR_CODES.FORBIDDEN, cancelRule.message);
    const now = nowIso_();
    updateByKey_(Domain.SHEET_BOOKINGS, payload.bookingId, {
      status: 'cancelled', cancelReason: String(payload.reason || ''), updatedBy: user.email, updatedAt: now,
    });
    audit_(user.email, 'booking.cancel', 'booking', payload.bookingId, { reason: String(payload.reason || '') });
    bumpDataVersion_();
    return { booking: publicBooking_(Object.assign({}, row, { status: 'cancelled' }), user) };
  });
}

/**
 * ลงนามขั้นปัจจุบันของการอนุมัติ 3 ขั้น — กฎทั้งหมดอยู่ใน Domain.decideApprovalStep
 * (ใครลงนามขั้นไหนได้ ห้ามบัญชีเดียวลงนามซ้ำ ไม่อนุมัติต้องมีเหตุผล)
 */
function decideBooking_(user, raw) {
  const parsed = Domain.validateDecideBookingInput(raw);
  if (!parsed.ok) throw appError_(ERROR_CODES.VALIDATION, 'ข้อมูลการพิจารณาไม่ถูกต้อง', parsed.issues);
  const input = parsed.value;
  // PIN แทนลายเซ็น: ตรวจนอกล็อก เพราะไม่ได้เขียนข้อมูลการจอง
  verifyActorPin_(user, raw && raw.pin);
  return withScriptLock_(function () {
    const row = findByKey_(Domain.SHEET_BOOKINGS, input.bookingId);
    if (!row) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบรายการจอง');
    const now = nowIso_();
    const state = {
      status: String(row.status),
      approvalStep: Domain.currentApprovalStep({ status: String(row.status), approvalStep: row.approvalStep }),
      approvalLog: Domain.parseApprovalLog(row.approvalLog),
    };
    const result = Domain.decideApprovalStep(state, user, input.decision, input.reason, now);
    if (!result.ok) throw appError_(ERROR_CODES[result.code], result.message);
    const patch = {
      status: result.next.status, approvalStep: result.next.approvalStep,
      approvalLog: JSON.stringify(result.next.approvalLog),
      updatedBy: user.email, updatedAt: now,
    };
    if (result.finished) {
      patch.decidedBy = user.email;
      patch.decidedAt = now;
    }
    if (input.decision === 'reject') {
      patch.note = `${String(row.note || '')}${row.note ? '\n' : ''}ผลพิจารณา: ${input.reason}`;
    }
    updateByKey_(Domain.SHEET_BOOKINGS, input.bookingId, patch);
    audit_(user.email, `booking.step${state.approvalStep}.${input.decision}`, 'booking', input.bookingId, { reason: input.reason });
    bumpDataVersion_();
    return { booking: publicBooking_(Object.assign({}, row, patch), user), nextStep: result.nextStep };
  });
}

/**
 * ช่วงเวลาที่อนุมัติแล้วของทุกห้องในวันนี้ — ให้หน้าภาพรวมบอกว่าห้องไหนกำลังใช้/ว่าง
 * มีแค่ห้องกับเวลา (ไม่มีชื่อหรือหัวข้อ) ทุกคนที่ล็อกอินดูได้ อ่านแค่คอลัมน์ hot จึงเร็ว
 */
function roomSlotsToday_() {
  const dateKey = Domain.toDateKey(serverNow_());
  const rows = readHotColumns_(Domain.SHEET_BOOKINGS, Domain.BOOKING_HOT_COLUMNS).objects;
  return { dateKey: dateKey, slots: Domain.approvedSlotsOn(rows, dateKey) };
}

