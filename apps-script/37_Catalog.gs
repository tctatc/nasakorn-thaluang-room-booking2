/**
 * ข้อมูลที่ผู้ดูแลแก้เองได้โดยไม่ต้องแก้โค้ด: ห้องประชุม และรายการตั้งต้น (Lookups)
 * ทุกคนอ่านได้ (แบบฟอร์มจองต้องใช้) เฉพาะผู้ดูแลเพิ่ม/แก้/ลบ — ตรวจด้วย requireAdmin_ ที่ 50_Api.gs
 */

function publicLookup_(row) {
  return {
    lookupId: String(row.lookupId), kind: String(row.kind), key: String(row.key), label: String(row.label || ''),
    note: String(row.note || ''), sortOrder: Number(row.sortOrder) || 0, active: String(row.active) !== 'false',
  };
}

/** รายการที่ยังไม่ถูกลบ (รวมที่ปิดใช้ไว้ — การจองเก่ายังต้องแสดงชื่อ) */
function readLookups_() {
  return readAll_(Domain.SHEET_LOOKUPS).objects.filter(function (row) {
    return !row.archivedAt;
  }).map(publicLookup_);
}

function listLookups_() {
  addMissingDepartments_(false);
  return { lookups: Domain.sortLookups(readLookups_()) };
}

/** รุ่นของรายชื่อแผนกตั้งต้น — เปลี่ยนเมื่อแก้รายการใน shared/schemas/lookup.ts เพื่อให้เติมรอบใหม่ */
const DEPARTMENT_SEED_VERSION = '2570.1';
const PROP_DEPARTMENT_SEED = 'DEPARTMENT_SEED';

/**
 * เติมแผนก/ฝ่ายตั้งต้นที่ยังไม่มีในชีต (เทียบด้วยรหัส รวมรายการที่ผู้ดูแลลบไปแล้ว จึงไม่ฟื้นของที่ตั้งใจลบ)
 * ทำครั้งเดียวต่อรุ่นรายชื่อ — ครั้งต่อไปแค่อ่าน Script Property แล้วจบ
 */
function addMissingDepartments_(force) {
  if (!force && getProp_(PROP_DEPARTMENT_SEED) === DEPARTMENT_SEED_VERSION) return 'รายชื่อแผนกเป็นรุ่นล่าสุดแล้ว';
  return withScriptLock_(function () {
    if (!force && getProp_(PROP_DEPARTMENT_SEED) === DEPARTMENT_SEED_VERSION) return 'รายชื่อแผนกเป็นรุ่นล่าสุดแล้ว';
    const rows = readAll_(Domain.SHEET_LOOKUPS).objects;
    const existing = rows.map(function (row) {
      return { kind: String(row.kind), key: String(row.key) };
    });
    // แผนกตั้งต้นที่ผู้ดูแลไม่เคยแก้ (updatedAt = createdAt) เรียงตามลำดับใหม่ (อุตสาหกรรม → ดิจิทัล → พาณิชย์ → สามัญ → ฝ่าย/งาน)
    // รายการที่ผู้ดูแลแก้แล้วอยู่ที่เดิม — ไม่แตะ updatedAt จึงยังนับว่า "ไม่เคยแก้"
    let reordered = 0;
    const defaults = Domain.defaultLookups().filter(function (item) { return item.kind === 'department'; });
    rows.forEach(function (row) {
      if (String(row.kind) !== 'department' || row.archivedAt || String(row.updatedAt) !== String(row.createdAt)) return;
      const target = defaults.filter(function (item) { return item.key === String(row.key); })[0];
      if (target && Number(row.sortOrder) !== target.sortOrder) {
        updateByKey_(Domain.SHEET_LOOKUPS, String(row.lookupId), { sortOrder: target.sortOrder });
        reordered += 1;
      }
    });
    const now = nowIso_();
    const missing = Domain.missingDefaultLookups(existing, 'department').map(function (item) {
      return Object.assign({}, item, { createdAt: now, updatedAt: now, archivedAt: '' });
    });
    if (missing.length > 0) appendObjects_(Domain.SHEET_LOOKUPS, missing);
    if (missing.length > 0 || reordered > 0) bumpDataVersion_();
    scriptProps_().setProperty(PROP_DEPARTMENT_SEED, DEPARTMENT_SEED_VERSION);
    return missing.length > 0
      ? `เพิ่มแผนก/ฝ่ายที่ยังไม่มี ${missing.length} รายการ: ${missing.map(function (item) { return item.label; }).join(', ')}`
      : `มีแผนก/ฝ่ายตั้งต้นครบแล้ว${reordered > 0 ? ` (จัดลำดับใหม่ ${reordered} รายการ)` : ''}`;
  });
}

function saveLookup_(admin, raw) {
  const parsed = Domain.validateLookupInput(raw);
  if (!parsed.ok) throw appError_(ERROR_CODES.VALIDATION, 'ข้อมูลรายการไม่ถูกต้อง', parsed.issues);
  const input = parsed.value;
  return withScriptLock_(function () {
    const items = readLookups_();
    const duplicate = items.some(function (item) {
      return item.kind === input.kind && item.lookupId !== input.lookupId && item.label === input.label;
    });
    if (duplicate) throw appError_(ERROR_CODES.CONFLICT, `มี "${input.label}" อยู่แล้ว`);
    const now = nowIso_();
    if (input.lookupId === '') {
      const created = {
        lookupId: newId_('lk'), kind: input.kind, key: Domain.newLookupKey(input.kind, readAll_(Domain.SHEET_LOOKUPS).objects.map(publicLookup_), Date.now()),
        label: input.label, note: input.note, sortOrder: input.sortOrder, active: input.active,
        createdAt: now, updatedAt: now, archivedAt: '',
      };
      appendObject_(Domain.SHEET_LOOKUPS, created);
      audit_(admin.email, 'lookup.create', 'lookup', created.lookupId, { kind: input.kind, label: input.label });
      bumpDataVersion_();
      return { lookup: publicLookup_(created) };
    }
    const row = findByKey_(Domain.SHEET_LOOKUPS, input.lookupId);
    if (!row || row.archivedAt || String(row.kind) !== input.kind) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบรายการ');
    // รหัส (key) ไม่เปลี่ยน — การจองและห้องที่บันทึกไว้แล้วอ้างรหัสนี้
    const patch = { label: input.label, note: input.note, sortOrder: input.sortOrder, active: input.active, updatedAt: now };
    updateByKey_(Domain.SHEET_LOOKUPS, input.lookupId, patch);
    audit_(admin.email, 'lookup.update', 'lookup', input.lookupId, { label: input.label, active: input.active });
    bumpDataVersion_();
    return { lookup: publicLookup_(Object.assign({}, row, patch)) };
  });
}

/** ลบแบบเก็บประวัติ: หายจากหน้าจัดการและแบบฟอร์ม แต่แถวยังอยู่ให้ตรวจย้อนหลังได้ */
function archiveLookup_(admin, payload) {
  return withScriptLock_(function () {
    const row = findByKey_(Domain.SHEET_LOOKUPS, String(payload.lookupId || ''));
    if (!row || row.archivedAt) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบรายการ');
    const now = nowIso_();
    updateByKey_(Domain.SHEET_LOOKUPS, String(row.lookupId), { archivedAt: now, active: false, updatedAt: now });
    audit_(admin.email, 'lookup.archive', 'lookup', String(row.lookupId), { label: String(row.label) });
    bumpDataVersion_();
    return { ok: true };
  });
}

/** รายการเริ่มต้น — เพิ่มเฉพาะชนิดที่ยังไม่มีสักรายการ ไม่ทับที่ผู้ดูแลแก้ไว้ */
function seedLookups() {
  const existing = readAll_(Domain.SHEET_LOOKUPS).objects;
  const now = nowIso_();
  const missing = Domain.defaultLookups().filter(function (item) {
    return !existing.some(function (row) { return String(row.kind) === item.kind; });
  }).map(function (item) {
    return Object.assign({}, item, { createdAt: now, updatedAt: now, archivedAt: '' });
  });
  if (missing.length === 0) return 'มีรายการตั้งต้นครบทุกชนิดแล้ว';
  appendObjects_(Domain.SHEET_LOOKUPS, missing);
  bumpDataVersion_();
  return `เพิ่มรายการตั้งต้น ${missing.length} รายการ`;
}

/* ---------- ห้องประชุม ---------- */

function saveRoom_(admin, raw) {
  const parsed = Domain.validateRoomInput(raw);
  if (!parsed.ok) throw appError_(ERROR_CODES.VALIDATION, 'ข้อมูลห้องไม่ถูกต้อง', parsed.issues);
  const input = parsed.value;
  const unknown = Domain.unknownLookupKeys(readLookups_(), 'roomEquipment', input.equipment);
  if (unknown.length) throw appError_(ERROR_CODES.VALIDATION, 'มีอุปกรณ์ที่ถูกปิดใช้หรือลบไปแล้ว กรุณาเลือกใหม่');
  return withScriptLock_(function () {
    const rooms = readAll_(Domain.SHEET_ROOMS).objects;
    const sameCode = rooms.some(function (row) {
      return String(row.code).toUpperCase() === input.code.toUpperCase() && String(row.roomId) !== input.roomId;
    });
    if (sameCode) throw appError_(ERROR_CODES.CONFLICT, `รหัสห้อง ${input.code} มีอยู่แล้ว`);
    const now = nowIso_();
    const fields = {
      code: input.code, name: input.name, description: input.description, location: input.location,
      capacity: input.capacity, equipment: Domain.writeList(input.equipment), imageUrl: input.imageUrl || '',
      status: input.status, updatedAt: now,
    };
    if (input.roomId === '') {
      const created = Object.assign({ roomId: newId_('rm'), createdAt: now }, fields);
      appendObject_(Domain.SHEET_ROOMS, created);
      audit_(admin.email, 'room.create', 'room', created.roomId, { code: input.code, name: input.name });
      bumpDataVersion_();
      return { room: publicRoom_(created) };
    }
    const row = findByKey_(Domain.SHEET_ROOMS, input.roomId);
    if (!row) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบห้องประชุม');
    updateByKey_(Domain.SHEET_ROOMS, input.roomId, fields);
    audit_(admin.email, 'room.update', 'room', input.roomId, { code: input.code, status: input.status });
    bumpDataVersion_();
    return { room: publicRoom_(Object.assign({}, row, fields)) };
  });
}

/** ลบได้เฉพาะห้องที่ยังไม่เคยมีการจอง — ห้องที่มีประวัติให้เปลี่ยนสถานะเป็น "ไม่เปิดให้จอง" แทน */
function deleteRoom_(admin, payload) {
  return withScriptLock_(function () {
    const roomId = String(payload.roomId || '');
    const row = findByKey_(Domain.SHEET_ROOMS, roomId);
    if (!row) throw appError_(ERROR_CODES.NOT_FOUND, 'ไม่พบห้องประชุม');
    const used = readHotColumns_(Domain.SHEET_BOOKINGS, 2).objects.some(function (booking) {
      return String(booking.roomId) === roomId;
    });
    if (used) {
      throw appError_(ERROR_CODES.CONFLICT, 'ห้องนี้มีประวัติการจองแล้ว ลบไม่ได้ — เปลี่ยนสถานะเป็น "ไม่เปิดให้จอง" แทน ประวัติจะยังอยู่ครบ');
    }
    deleteByKey_(Domain.SHEET_ROOMS, roomId);
    audit_(admin.email, 'room.delete', 'room', roomId, { code: String(row.code), name: String(row.name) });
    bumpDataVersion_();
    return { ok: true };
  });
}
