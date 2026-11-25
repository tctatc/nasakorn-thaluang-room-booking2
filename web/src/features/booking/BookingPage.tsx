import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AirVent, CalendarDays, Check, ChevronDown, Clock3, DoorOpen, FileText, History, Pencil, UserRound, MapPin, Mic, Package, Paperclip, Projector, Send, Users, Volume2, Wifi, X, type LucideIcon,
} from 'lucide-react';
import {
  ATTACHMENT_ACCEPT, ATTACHMENT_LOCAL_MAX_BYTES, ATTACHMENT_MAX_BYTES, ATTACHMENT_TYPES_TEXT, formatFileSize, validateAttachmentUpload,
} from '@shared/schemas/attachment';
import { readFileAsBase64 } from '../../lib/attachment';
import { attachmentIcon } from '../../components/ui/AttachmentChip';
import { businessWindow } from '@shared/domain/booking-rules';
import { conflictingSlots, isEndBlocked, isStartBlocked } from '@shared/domain/availability';
import { addDaysToDateKey, dayOfWeekOfDateKey, toDateKey, toMinutesOfDay } from '@shared/time/bangkok';
import { isOpenLocationRoom } from '@shared/schemas/room';
import type { RequestFacility } from '@shared/schemas/booking';
import { useLookups } from '../../lib/hooks/useLookups';
import type { SystemSettings } from '@shared/schemas/settings';
import { useApp } from '../../app/providers/AppProvider';
import { rememberTracking } from '../track/trackingMemory';
import { forgetBookerProfile, readBookerProfile, rememberByDefault, saveBookerProfile } from './bookerMemory';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Alert';
import { TimeSelect } from '../../components/ui/TimeSelect';
import { RoomAvailability } from '../../components/ui/RoomAvailability';
import { DayTimeline } from '../../components/ui/DayTimeline';
import { useRoomAvailability } from '../../lib/hooks/useRoomAvailability';
import { cn } from '../../lib/cn';
import type { DemoRoom } from '../../lib/api/demo';
import { ROOM_BANDS } from './roomBands';
import { FormPreviewDialog } from '../requestForm/FormPreviewDialog';
import { adjustEndTime, asMinute, endTimeOptions, firstFreeStart, startTimeOptions, timeText } from './timeOptions';

const inputClass = 'min-h-11 w-full rounded-control border border-line bg-surface px-3 text-base text-ink outline-none transition-colors duration-150 focus:border-brand focus:ring-2 focus:ring-brand/20';
const labelClass = 'mb-1.5 block text-sm font-medium text-ink';

/** ไอคอนของอุปกรณ์ชุดเริ่มต้น — รายการที่ผู้ดูแลเพิ่มเองใช้ไอคอนกล่อง */
const FACILITY_ICON: Record<string, LucideIcon> = {
  projector: Projector,
  soundSystem: Volume2,
  microphone: Mic,
  airConditioning: AirVent,
  internet: Wifi,
};

/** ปุ่มลัดความยาวการประชุม — ส่วนใหญ่ประชุมกันครึ่งชั่วโมงถึงสองชั่วโมง */
const DURATIONS = [30, 60, 90, 120];
/**
 * อุปกรณ์ที่ขอบ่อยแต่ไม่มีช่องในแบบฟอร์มต้นฉบับ — กดแล้วเติมลงช่อง "อุปกรณ์อื่น ๆ"
 * ตอนพิมพ์จึงไปอยู่ที่ "☐ อื่น ๆ ..." ของแบบฟอร์มตามเดิม
 */
const EXTRA_ITEMS = ['โน้ตบุ๊ก', 'ปลั๊กพ่วง'];
const otherItems = (text: string) => text.split(',').map((item) => item.trim()).filter(Boolean);
const toggleOtherItem = (text: string, item: string) => {
  const items = otherItems(text);
  return (items.includes(item) ? items.filter((value) => value !== item) : [...items, item]).join(', ');
};
/** คำนำหน้าตามแบบคำขอ "ข้าพเจ้า นาย/นาง/นางสาว" ('' = ไม่ระบุ เช่น ใช้ยศหรือตำแหน่งวิชาการในชื่อเอง) */
const NAME_PREFIXES = ['นาย', 'นาง', 'นางสาว', ''];
const durationText = (minutes: number) =>
  minutes < 60 ? `${minutes} นาที` : `${minutes / 60 % 1 === 0 ? minutes / 60 : (minutes / 60).toFixed(1)} ชม.`;

const thaiDate = (key: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('th-TH', { ...options, timeZone: 'Asia/Bangkok' }).format(new Date(`${key}T12:00:00+07:00`));

/** วันที่จองได้ 14 วันถัดไป (ข้ามวันที่ไม่เปิดจอง และข้ามวันนี้ถ้าเลยเวลาที่ยังจองทัน) */
function upcomingBookableDays(today: string, nowMinute: number, settings: SystemSettings, count = 14): string[] {
  const { endMin } = businessWindow(settings);
  const days: string[] = [];
  for (let offset = 0; days.length < count && offset < 31; offset += 1) {
    const key = addDaysToDateKey(today, offset);
    if (!settings.bookableWeekdays.includes(dayOfWeekOfDateKey(key))) continue;
    if (offset === 0 && nowMinute + settings.minBookingMinutes > endMin) continue;
    days.push(key);
  }
  return days;
}

/** วันทำการย้อนหลัง ล่าสุดก่อน (เมื่อวาน, วันก่อน ...) ไม่เกินวันแรกที่ยังบันทึกย้อนหลังได้ */
function recentBookableDays(today: string, earliest: string, settings: SystemSettings): string[] {
  const days: string[] = [];
  for (let offset = 1; offset <= 62; offset += 1) {
    const key = addDaysToDateKey(today, -offset);
    if (key < earliest) break;
    if (settings.bookableWeekdays.includes(dayOfWeekOfDateKey(key))) days.push(key);
  }
  return days;
}

export function BookingPage() {
  const { api, token, settings, user } = useApp();
  const rules = settings!;
  const nav = useNavigate();
  // ลิงก์จากปฏิทิน/หน้าห้อง: ?room=&date=&start=&end= เลือกให้ล่วงหน้า
  const [params] = useSearchParams();
  const isTime = (value: string | null) => value !== null && /^\d{2}:\d{2}$/.test(value);

  const today = toDateKey(new Date());
  const nowMinute = toMinutesOfDay(new Date());
  const days = useMemo(() => upcomingBookableDays(today, nowMinute, rules), [today, rules]);
  // บันทึกย้อนหลัง: ทุกคนได้ตาม backdateDays (ยังต้องอนุมัติ) — ผู้ดูแลที่เปิดสิทธิ์ย้อนได้ไม่จำกัด (ปฏิทินแสดง 14 วัน)
  const adminBackdate = user?.role === 'admin' && rules.allowAdminBackdate;
  const backdateDays = Math.max(0, Math.floor(Number(rules.backdateDays) || 0));
  const earliest = adminBackdate ? addDaysToDateKey(today, -Math.max(backdateDays, 14)) : addDaysToDateKey(today, -backdateDays);
  const pastDays = useMemo(() => recentBookableDays(today, earliest, rules), [today, earliest, rules]);
  const validDate = (key: string | null): key is string =>
    key !== null && /^\d{4}-\d{2}-\d{2}$/.test(key) && (adminBackdate || key >= earliest);

  const [rooms, setRooms] = useState<DemoRoom[]>([]);
  const [roomOrder, setRoomOrder] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [roomId, setRoomId] = useState(() => params.get('room') || '');
  const [dateKey, setDateKey] = useState(() => (validDate(params.get('date')) ? params.get('date')! : days[0] ?? today));
  const [showPast, setShowPast] = useState(() => dateKey < today);
  const [start, setStart] = useState(() => (isTime(params.get('start')) ? params.get('start')! : '09:00'));
  const [end, setEnd] = useState(() => (isTime(params.get('end')) ? params.get('end')! : '10:00'));
  // ช่องดักบอท — ซ่อนจากคนจริง ถ้ามีค่าเซิร์ฟเวอร์จะปฏิเสธ
  const [website, setWebsite] = useState('');
  // ข้อมูลผู้จองที่จำไว้ในเครื่องนี้ (ถ้ามี) — จองครั้งต่อไปไม่ต้องพิมพ์ซ้ำ
  const [savedBooker] = useState(readBookerProfile);
  const [editingBooker, setEditingBooker] = useState(savedBooker === null);
  const [rememberMe, setRememberMe] = useState(() => savedBooker !== null || rememberByDefault());
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [namePrefix, setNamePrefix] = useState(savedBooker?.namePrefix ?? 'นาย');
  const [bookerName, setBookerName] = useState(savedBooker?.bookerName ?? '');
  const [previewOpen, setPreviewOpen] = useState(false);
  const closePreview = useCallback(() => setPreviewOpen(false), []);
  const lookups = useLookups();
  // ตำแหน่งและหน่วยงานเติมจากบัญชีผู้ใช้ — แก้ได้ถ้าจองแทนคนอื่น
  const [position, setPosition] = useState(savedBooker?.position || user?.position || '');
  const [meetingType, setMeetingType] = useState('');
  const [department, setDepartment] = useState(savedBooker?.department || user?.department || '');
  const [phone, setPhone] = useState(savedBooker?.phone ?? '');
  const [title, setTitle] = useState('');
  const [customLocation, setCustomLocation] = useState('');
  const [attendees, setAttendees] = useState('2');
  const [note, setNote] = useState('');
  const [requestedFacilities, setRequestedFacilities] = useState<RequestFacility[]>([]);
  const [extraFurnitureCount, setExtraFurnitureCount] = useState('0');
  const [otherFacility, setOtherFacility] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  // เอกสารแนบ 1 ไฟล์ (ไม่บังคับ) — อ่านและตรวจทันทีที่เลือก ผู้ใช้จะรู้ตั้งแต่ตอนนั้นว่าไฟล์ใช้ได้ไหม
  const [attachment, setAttachment] = useState<{ name: string; dataBase64: string; mimeType: string; size: number } | null>(null);
  const [attachmentError, setAttachmentError] = useState('');
  const [readingFile, setReadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const maxAttachmentBytes = api.mode === 'demo' ? ATTACHMENT_LOCAL_MAX_BYTES : ATTACHMENT_MAX_BYTES;
  const chooseFile = async (file: File | undefined) => {
    setAttachmentError('');
    if (!file) return;
    if (file.size > maxAttachmentBytes) {
      setAttachmentError(`ไฟล์ใหญ่เกิน ${formatFileSize(maxAttachmentBytes)} (ไฟล์นี้ ${formatFileSize(file.size)}) กรุณาย่อไฟล์หรือสแกนให้ความละเอียดต่ำลง`);
      return;
    }
    setReadingFile(true);
    try {
      const parsed = validateAttachmentUpload({ name: file.name, dataBase64: await readFileAsBase64(file) }, maxAttachmentBytes);
      if (!parsed.ok) setAttachmentError(parsed.issues[0]!.message);
      else if (parsed.value) setAttachment({ name: parsed.value.name, dataBase64: parsed.value.dataBase64, mimeType: parsed.value.mimeType, size: parsed.value.size });
    } catch (e) {
      setAttachmentError(e instanceof Error ? e.message : 'อ่านไฟล์ไม่ได้');
    } finally {
      setReadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };
  // ผู้ใช้เลือกเวลาเองแล้ว (หรือมากับลิงก์จากปฏิทิน) ห้ามระบบเลื่อนให้อีก
  const timeTouched = useRef(isTime(params.get('start')) && isTime(params.get('end')));

  useEffect(() => {
    api.rooms(token).then(({ rooms: data }) => {
      setRoomOrder(data.map((r) => r.roomId));
      const active = data.filter((r) => r.status === 'active');
      setRooms(active);
      setRoomId((current) => (active.some((r) => r.roomId === current) ? current : active[0]?.roomId || ''));
    }).catch((e: Error) => setError(e.message));
  }, [api, token]);

  const room = rooms.find((r) => r.roomId === roomId);
  // ห้อง "อื่น ๆ": ผู้ขอระบุสถานที่เอง ไม่มีการตรวจเวลาซ้อน
  const openLocation = isOpenLocationRoom(room);
  const band = (id: string) => ROOM_BANDS[Math.max(roomOrder.indexOf(id), 0) % ROOM_BANDS.length];
  const { busy: busySlots, loading: checkingRoom } = useRoomAvailability(roomId, dateKey);
  const startMin = asMinute(start);
  const endMin = asMinute(end);
  const roomConflict = conflictingSlots({ startMin, endMin }, busySlots).length > 0;

  // เปิดฟอร์มที่เวลาว่างแรกของวัน (และไม่ย้อนหลังถ้าเป็นวันนี้) แทนเวลาตายตัวที่อาจชนอยู่แล้ว
  useEffect(() => {
    if (timeTouched.current || checkingRoom || roomId === '') return;
    const first = firstFreeStart(rules, busySlots, dateKey === today ? nowMinute : 0);
    if (first === undefined) return;
    setStart(timeText(first));
    setEnd(timeText(adjustEndTime(rules, first, first + 60, busySlots)));
  }, [busySlots, checkingRoom, roomId, dateKey]);

  const chooseTime = (startValue: number, endValue: number) => {
    timeTouched.current = true;
    setStart(timeText(startValue));
    setEnd(timeText(endValue));
  };
  const changeStart = (value: string) => chooseTime(asMinute(value), adjustEndTime(rules, asMinute(value), endMin, busySlots));
  const durationAvailable = (minutes: number) =>
    endTimeOptions(rules, startMin).includes(startMin + minutes) && !isEndBlocked(startMin, startMin + minutes, busySlots);

  const capacity = room?.capacity ?? 0;
  const attendeeCount = Number(attendees) || 0;
  const overCapacity = room !== undefined && !openLocation && attendeeCount > capacity;
  const dayClosed = !rules.bookableWeekdays.includes(dayOfWeekOfDateKey(dateKey));
  const backdated = dateKey < today || (dateKey === today && startMin < nowMinute);
  const tooOld = !adminBackdate && dateKey < earliest;

  const missing = [
    roomId === '' && 'เลือกห้อง',
    openLocation && customLocation.trim() === '' && 'ระบุสถานที่',
    roomConflict && 'เลือกเวลาที่ห้องว่าง',
    tooOld && 'เลือกวันที่ใหม่',
    bookerName.trim() === '' && 'กรอกชื่อผู้จอง',
    position.trim() === '' && 'ตำแหน่ง',
    department.trim() === '' && 'หน่วยงาน',
    phone.trim() === '' && 'เบอร์โทร',
    title.trim() === '' && 'เรื่องที่ใช้ห้อง',
    !termsAccepted && 'ติ๊กยอมรับเงื่อนไข',
  ].filter((item): item is string => typeof item === 'string');
  // บอกบนแถบที่พับไว้ว่ากรอกอะไรไปแล้ว — ไม่ต้องเปิดดูก็รู้
  const extrasPicked = [
    ...requestedFacilities.map((key) => lookups.label('facility', key)),
    ...((Number(extraFurnitureCount) || 0) > 0 ? [`โต๊ะ/เก้าอี้ ${extraFurnitureCount} ตัว`] : []),
    ...otherItems(otherFacility),
    ...(meetingType ? [lookups.label('meetingType', meetingType)] : []),
    ...(note.trim() ? ['รายละเอียด'] : []),
    ...(attachment ? ['ไฟล์แนบ'] : []),
  ];
  const extrasSummary = extrasPicked.length ? `เลือกไว้: ${extrasPicked.join(', ')}` : 'อุปกรณ์ที่ขอ ประเภทการประชุม รายละเอียด เอกสารแนบ';
  const done = {
    room: roomId !== '' && (!openLocation || customLocation.trim() !== ''),
    time: !roomConflict && !dayClosed && !tooOld,
    booker: [bookerName, position, department, phone].every((value) => value.trim() !== ''),
    meeting: title.trim() !== '' && attendeeCount > 0 && !overCapacity && termsAccepted,
  };

  // ชื่อเต็มตามแบบฟอร์ม: คำนำหน้าติดชื่อ (เช่น นายสมชาย ใจดี)
  const fullName = `${namePrefix}${bookerName.trim()}`;
  const formData = {
    bookerName: fullName, requesterPosition: position, department, requesterPhone: phone, roomId,
    customLocation: openLocation ? customLocation : '', title, dateKey, startMin, endMin, attendees: attendeeCount,
    requestedFacilities, extraFurnitureCount: Number(extraFurnitureCount) || 0, otherFacility, meetingType,
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const request = {
        bookerName: fullName, title, roomId, dateKey, startMin, endMin, attendees: attendeeCount,
        department, requesterPosition: position, requesterPhone: phone, note, equipment: [], customLocation: openLocation ? customLocation : '',
        requestedFacilities, extraFurnitureCount: Number(extraFurnitureCount), otherFacility, termsAccepted, meetingType,
        ...(attachment ? { attachment: { name: attachment.name, dataBase64: attachment.dataBase64 } } : {}),
      };
      // ไม่ได้เข้าสู่ระบบ = ผู้จองทั่วไป (กรอกชื่อ เบอร์ แผนก) ได้รหัสติดตามไว้ดูสถานะ
      const { trackingCode } = user ? await api.createBooking(token, request) : await api.guestBooking({ ...request, website });
      rememberTracking({ code: trackingCode, title, dateKey, startMin, endMin, roomId });
      if (rememberMe) saveBookerProfile({ namePrefix, bookerName, position, department, phone });
      else forgetBookerProfile();
      nav(`/track/${trackingCode}`, { state: { justBooked: true } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="จองห้องประชุม" description="เลือกห้อง วัน และเวลา ระบบเช็กให้ทันทีว่าห้องว่างไหม" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <form id="booking-form" className="enter-stagger min-w-0 space-y-5" onSubmit={submit}>
          {error && <Alert tone="danger" title="จองไม่สำเร็จ">{error}</Alert>}
          {!user && !savedBooker && (
            <Alert tone="info" title="จองได้เลย ไม่ต้องเข้าสู่ระบบ">
              กรอกชื่อ เบอร์โทร และแผนกให้ครบ ส่งแล้วจะได้รหัสติดตามกับ QR Code ไว้ดูผลอนุมัติและพิมพ์แบบฟอร์ม
            </Alert>
          )}
          {/* ช่องดักบอท: ซ่อนจากสายตาและโปรแกรมอ่านหน้าจอ คนจริงจะไม่กรอก */}
          {!user && (
            <div aria-hidden="true" className="absolute -left-[9999px] size-px overflow-hidden">
              <label htmlFor="booking-website">เว็บไซต์</label>
              <input id="booking-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>
          )}

          <Section step={1} title="เลือกห้อง" hint="แตะการ์ดห้องที่ต้องการ" done={done.room}>
            <fieldset className="min-w-0">
              <legend className="sr-only">ห้องประชุม</legend>
              <div className="-mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-3">
                {rooms.map((item) => (
                  <label
                    key={item.roomId}
                    className="group relative flex w-[15.5rem] shrink-0 snap-start cursor-pointer flex-col overflow-hidden rounded-card border border-line bg-surface transition-[border-color,box-shadow,transform] duration-150 hover:border-brand-border active:scale-[0.98] has-[:checked]:border-brand has-[:checked]:shadow-raised has-[:checked]:ring-1 has-[:checked]:ring-brand has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand sm:w-auto"
                  >
                    <input type="radio" name="room" value={item.roomId} checked={roomId === item.roomId} onChange={() => setRoomId(item.roomId)} className="sr-only" />
                    <span aria-hidden="true" className={`h-1.5 bg-gradient-to-r ${band(item.roomId)}`} />
                    <span className="flex items-start gap-3 p-3.5">
                      <span aria-hidden="true" className={`grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-ink-inverse ${band(item.roomId)}`}>
                        <DoorOpen className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-ink">{item.name}</span>
                        {item.location && <span className="block truncate text-xs text-ink-muted">{item.location}</span>}
                      </span>
                      <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-full border border-line text-transparent transition-colors duration-150 group-has-[:checked]:border-brand group-has-[:checked]:bg-brand group-has-[:checked]:text-ink-inverse">
                        <Check className="size-3.5" strokeWidth={3} />
                      </span>
                    </span>
                    <span className="mt-auto flex items-center gap-1.5 px-3.5 pb-3 text-xs text-ink-muted">
                      {isOpenLocationRoom(item) ? <><MapPin className="size-3.5 shrink-0" aria-hidden="true" /><span>พิมพ์สถานที่ที่ต้องการเอง</span></> : <><Users className="size-3.5 shrink-0" aria-hidden="true" /><span className="shrink-0">รองรับประมาณ {item.capacity} คน</span></>}
                      {item.equipment.length > 0 && <span className="min-w-0 truncate">· มี{item.equipment.map((key) => lookups.label('roomEquipment', key)).join(', ')}</span>}
                    </span>
                  </label>
                ))}
              </div>
              {rooms.length === 0 && !error && <p className="py-6 text-center text-sm text-ink-muted">กำลังโหลดห้องประชุม…</p>}
            </fieldset>
            {openLocation && (
              <div className="mt-4">
                <label className={labelClass} htmlFor="custom-location">ระบุสถานที่</label>
                <input className={inputClass} id="custom-location" required maxLength={200} value={customLocation} onChange={(e) => setCustomLocation(e.target.value)} placeholder="เช่น ลานกิจกรรมหน้าอาคาร 2" />
                <p className="mt-1 text-xs text-ink-subtle">สถานที่อื่นไม่มีตารางในระบบ จึงไม่ตรวจเวลาซ้อนให้ ผู้อนุมัติจะตรวจสอบอีกครั้ง</p>
              </div>
            )}
          </Section>

          <Section step={2} title="วันและเวลา" hint={thaiDate(dateKey, { dateStyle: 'full' })} done={done.time}>
            <div className="flex items-baseline justify-between gap-3">
              <label className={labelClass} htmlFor="date">วันที่</label>
            </div>
            <div className="-mx-5 flex snap-x gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
              {pastDays.length > 0 && (
                <button
                  type="button"
                  aria-pressed={showPast}
                  onClick={() => setShowPast((value) => !value)}
                  className={cn(
                    'flex w-16 shrink-0 snap-start flex-col items-center justify-center gap-0.5 rounded-2xl py-2 text-xs font-medium ring-1 ring-inset transition-colors duration-150',
                    showPast ? 'bg-warn-soft text-warn ring-warn/40' : 'bg-surface text-ink-muted ring-line hover:text-brand hover:ring-brand-border',
                  )}
                >
                  <History className="size-5" aria-hidden="true" />
                  {showPast ? 'ซ่อน' : 'ย้อนหลัง'}
                </button>
              )}
              {[...(showPast ? [...pastDays].reverse() : []), ...days].map((key) => {
                const selected = key === dateKey;
                const label = key === today ? 'วันนี้' : key === addDaysToDateKey(today, 1) ? 'พรุ่งนี้' : key === addDaysToDateKey(today, -1) ? 'เมื่อวาน' : thaiDate(key, { weekday: 'short' });
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={selected}
                    aria-label={thaiDate(key, { dateStyle: 'full' })}
                    onClick={() => setDateKey(key)}
                    className={cn(
                      'flex w-16 shrink-0 snap-start flex-col items-center rounded-2xl py-2 transition-[background-color,box-shadow,transform] duration-150 active:scale-95',
                      selected ? 'bg-brand-gradient text-ink-inverse shadow-brand' : 'bg-surface text-ink ring-1 ring-inset ring-line hover:ring-brand-border',
                    )}
                  >
                    <span className={cn('text-xs', selected ? 'text-ink-inverse/85' : 'text-ink-muted')}>{label}</span>
                    <span className="text-xl font-semibold leading-7 tabular-nums">{thaiDate(key, { day: 'numeric' })}</span>
                    <span className={cn('text-xs', selected ? 'text-ink-inverse/85' : 'text-ink-subtle')}>{thaiDate(key, { month: 'short' })}</span>
                  </button>
                );
              })}
              <span
                className={cn(
                  'relative flex shrink-0 items-center gap-2 rounded-2xl px-3 ring-1 ring-inset transition-colors duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand',
                  days.includes(dateKey) || (showPast && pastDays.includes(dateKey)) ? 'ring-line text-ink-muted' : 'bg-brand-soft text-brand ring-brand',
                )}
              >
                <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
                <input
                  id="date"
                  type="date"
                  required
                  {...(adminBackdate ? {} : { min: earliest })}
                  value={dateKey}
                  onChange={(e) => e.target.value && setDateKey(e.target.value)}
                  className="min-h-11 w-[8.5rem] bg-transparent text-sm text-inherit outline-none"
                />
              </span>
            </div>
            {dayClosed && (
              <p className="mt-2 text-sm font-medium text-warn">วันนี้ไม่เปิดให้จอง เลือกวันทำการอื่น</p>
            )}
            {tooOld ? (
              <p role="alert" className="mt-2 text-sm font-medium text-danger">
                {backdateDays > 0 ? `จองย้อนหลังได้ไม่เกิน ${backdateDays} วัน` : 'ระบบไม่เปิดให้จองย้อนหลัง'} เลือกวันใหม่
              </p>
            ) : backdated && !dayClosed && (
              <p className="mt-3 flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2.5 text-sm text-warn">
                <History className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>บันทึกการใช้ห้องย้อนหลัง คำขอนี้ยังต้องผ่านการอนุมัติเหมือนการจองปกติ</span>
              </p>
            )}

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor="start">เริ่ม</label>
                <TimeSelect className={inputClass} id="start" value={start} options={startTimeOptions(rules)} isDisabled={(minute) => isStartBlocked(minute, rules.minBookingMinutes, busySlots)} onChange={changeStart} />
              </div>
              <div>
                <label className={labelClass} htmlFor="end">สิ้นสุด</label>
                <TimeSelect className={inputClass} id="end" value={end} options={endTimeOptions(rules, startMin)} isDisabled={(minute) => isEndBlocked(startMin, minute, busySlots)} onChange={(value) => chooseTime(startMin, asMinute(value))} />
              </div>
            </div>
            <div role="group" aria-label="ความยาวการประชุม" className="mt-3 flex flex-wrap gap-2">
              {DURATIONS.map((minutes) => {
                const active = endMin - startMin === minutes;
                return (
                  <button
                    key={minutes}
                    type="button"
                    aria-pressed={active}
                    disabled={!durationAvailable(minutes)}
                    onClick={() => chooseTime(startMin, startMin + minutes)}
                    className={cn(
                      'min-h-9 rounded-pill px-3.5 text-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40',
                      active ? 'bg-brand text-ink-inverse' : 'bg-surface-sunken text-ink-muted ring-1 ring-inset ring-line hover:text-brand hover:ring-brand-border',
                    )}
                  >
                    {durationText(minutes)}
                  </button>
                );
              })}
            </div>

            {!openLocation && <><div className="mt-5">
              <DayTimeline
                busy={busySlots}
                startMin={startMin}
                endMin={endMin}
                settings={rules}
                conflict={roomConflict}
                onPickStart={(minute) => {
                  if (isStartBlocked(minute, rules.minBookingMinutes, busySlots)) return;
                  chooseTime(minute, adjustEndTime(rules, minute, minute + (endMin - startMin), busySlots));
                }}
              />
            </div>
            <div className="mt-4">
              <RoomAvailability busy={busySlots} loading={checkingRoom} startMin={startMin} endMin={endMin} settings={rules} onPick={chooseTime} />
            </div></>}
          </Section>

          <Section step={3} title="ผู้จอง" hint={savedBooker && !editingBooker ? 'ใช้ข้อมูลที่จำไว้ในเครื่องนี้' : 'ชื่อและเบอร์ที่ผู้อนุมัติติดต่อกลับได้'} done={done.booker}>
            {savedBooker && !editingBooker ? (
              <div className="flex flex-wrap items-center gap-3 rounded-control bg-surface-sunken px-3.5 py-3 ring-1 ring-inset ring-line">
                <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
                  <UserRound className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{fullName}</p>
                  <p className="truncate text-sm text-ink-muted">{[position, department].filter(Boolean).join(' · ')}</p>
                  <p className="text-sm tabular-nums text-ink-muted">{phone}</p>
                </div>
                <div className="flex w-full gap-2 sm:w-auto">
                  <button type="button" onClick={() => setEditingBooker(true)} className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-control bg-surface px-3 text-sm font-medium text-brand ring-1 ring-inset ring-brand-border transition-colors duration-150 hover:bg-brand-soft sm:flex-none">
                    <Pencil className="size-4" aria-hidden="true" />แก้ไข
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      forgetBookerProfile();
                      setNamePrefix('นาย'); setBookerName(''); setPhone('');
                      setPosition(user?.position ?? ''); setDepartment(user?.department ?? '');
                      setRememberMe(false); setEditingBooker(true);
                    }}
                    className="inline-flex min-h-11 flex-1 items-center justify-center rounded-control bg-surface px-3 text-sm font-medium text-ink-muted ring-1 ring-inset ring-line transition-colors duration-150 hover:text-ink sm:flex-none"
                  >
                    ไม่ใช่ฉัน
                  </button>
                </div>
              </div>
            ) : (
              <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass} htmlFor="booker-name">ชื่อผู้จอง</label>
                <div className="flex gap-2">
                  <label htmlFor="name-prefix" className="sr-only">คำนำหน้าชื่อ</label>
                  {/* max-w ไม่ใช่ w: inputClass มี w-full อยู่แล้ว และ cn ไม่ได้ตัด class ที่ชนกันทิ้ง */}
                  <select id="name-prefix" className={cn(inputClass, 'max-w-[6.5rem] shrink-0 px-2')} value={namePrefix} onChange={(e) => setNamePrefix(e.target.value)}>
                    {NAME_PREFIXES.map((prefix) => <option key={prefix || 'none'} value={prefix}>{prefix || 'ไม่ระบุ'}</option>)}
                  </select>
                  <input className={cn(inputClass, 'min-w-0 flex-1')} id="booker-name" required maxLength={90} autoComplete="name" value={bookerName} onChange={(e) => setBookerName(e.target.value)} placeholder="ชื่อ-นามสกุล" />
                </div>
              </div>
              <div>
                <label className={labelClass} htmlFor="position">ตำแหน่ง</label>
                <input className={inputClass} id="position" list="position-options" required maxLength={100} autoComplete="organization-title" value={position} onChange={(e) => setPosition(e.target.value)} placeholder="เลือกหรือพิมพ์ เช่น ครู" />
                <datalist id="position-options">{lookups.active('position').map((item) => <option key={item.lookupId} value={item.label} />)}</datalist>
              </div>
              <div>
                <label className={labelClass} htmlFor="department">หน่วยงาน / สาขาวิชา</label>
                <input className={inputClass} id="department" list="department-options" required maxLength={100} value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="เลือกหรือพิมพ์ เช่น แผนกวิชาการบัญชี" />
                <datalist id="department-options">{lookups.active('department').map((item) => <option key={item.lookupId} value={item.label} />)}</datalist>
              </div>
              <div>
                <label className={labelClass} htmlFor="phone">หมายเลขโทรศัพท์</label>
                <input className={inputClass} id="phone" type="tel" inputMode="tel" required maxLength={30} autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="เช่น 081-234-5678" />
              </div>
            </div>
                <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink">
                  <input type="checkbox" className="size-5 shrink-0 accent-brand" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
                  <span>จำข้อมูลของฉันไว้ในเครื่องนี้ <span className="text-ink-subtle">(ครั้งหน้าไม่ต้องพิมพ์ใหม่)</span></span>
                </label>
              </>
            )}
          </Section>

          <Section step={4} title="เรื่องที่ประชุม" hint="ใช้พิมพ์ลงแบบคำขอ" done={done.meeting}>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
              <div>
                <label className={labelClass} htmlFor="title">เพื่อใช้ในการดำเนินงาน เรื่อง</label>
                <input className={inputClass} id="title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="เช่น ประชุมครูประจำแผนกวิชา" />
              </div>
              <div>
                <label className={labelClass} htmlFor="attendees">ผู้เข้าร่วม (คน)</label>
                <input className={cn(inputClass, overCapacity && 'border-warn')} id="attendees" type="number" inputMode="numeric" required min="1" max={capacity || 1000} value={attendees} onChange={(e) => setAttendees(e.target.value)} aria-describedby="attendees-hint" />
                <p id="attendees-hint" className={cn('mt-1 text-xs', overCapacity ? 'font-medium text-warn' : 'text-ink-subtle')}>
                  {room && !openLocation ? (overCapacity ? `เกินความจุห้อง (${capacity} คน)` : `ห้องนี้รับได้ประมาณ ${capacity} คน`) : 'จำนวนโดยประมาณ'}
                </p>
              </div>
            </div>
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-control border border-line p-3.5 text-sm leading-6 text-ink-muted transition-colors duration-150 has-[:checked]:border-ok-border has-[:checked]:bg-ok-soft has-[:checked]:font-medium has-[:checked]:text-ok">
              <input className="mt-1" type="checkbox" required checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} />
              <span>ข้าพเจ้าขอรับรองว่าจะดูแลรักษาทรัพย์สินของทางราชการ และปฏิบัติตามระเบียบของวิทยาลัยโดยเคร่งครัด</span>
            </label>
          </Section>

          <details
            open={extrasOpen}
            onToggle={(e) => setExtrasOpen(e.currentTarget.open)}
            className="group rounded-card border border-line bg-surface shadow-card"
          >
            <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 rounded-card px-5 py-4 sm:px-6 [&::-webkit-details-marker]:hidden focus-visible:ring-2 focus-visible:ring-brand">
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-ink">ข้อมูลเพิ่มเติม <span className="font-normal text-ink-subtle">(ไม่บังคับ)</span></p>
                <p className="text-sm text-ink-muted">{extrasSummary}</p>
              </div>
              <ChevronDown className="size-5 shrink-0 text-ink-muted transition-transform duration-200 group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="space-y-4 border-t border-line px-5 pb-5 pt-4 sm:px-6 sm:pb-6">
              <div>
                <p className={labelClass}>อุปกรณ์ที่ต้องการให้เตรียม</p>
            <fieldset className="min-w-0">
              <legend className="sr-only">ครุภัณฑ์/อุปกรณ์/สิ่งอำนวยความสะดวกที่ขอใช้</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {lookups.active('facility').map(({ key, label }) => {
                  const Icon = FACILITY_ICON[key] ?? Package;
                  return (
                    <label key={key} className="flex min-h-12 cursor-pointer items-center gap-2.5 rounded-control border border-line px-3 text-sm text-ink transition-colors duration-150 hover:border-ok-border has-[:checked]:border-ok-border has-[:checked]:bg-ok-soft has-[:checked]:font-medium has-[:checked]:text-ok has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ok">
                      <input type="checkbox" className="sr-only" checked={requestedFacilities.includes(key)} onChange={() => setRequestedFacilities((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]))} />
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 flex-1 leading-tight">{label}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
              </div>
            <div className="grid gap-4 sm:grid-cols-[11rem_minmax(0,1fr)]">
              <div>
                <label className={labelClass} htmlFor="extra-furniture">โต๊ะ/เก้าอี้เพิ่ม (ตัว)</label>
                <input className={inputClass} id="extra-furniture" type="number" inputMode="numeric" min="0" max="500" value={extraFurnitureCount} onChange={(e) => setExtraFurnitureCount(e.target.value)} />
              </div>
              <div>
                <label className={labelClass} htmlFor="other-facility">อุปกรณ์อื่น ๆ</label>
                <input className={inputClass} id="other-facility" maxLength={300} value={otherFacility} onChange={(e) => setOtherFacility(e.target.value)} placeholder="ระบุเพิ่มเติมถ้ามี" />
                <div role="group" aria-label="เพิ่มอุปกรณ์อื่นที่ขอบ่อย" className="mt-2 flex flex-wrap gap-2">
                  {EXTRA_ITEMS.map((item) => {
                    const on = otherItems(otherFacility).includes(item);
                    return (
                      <button
                        key={item}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setOtherFacility(toggleOtherItem(otherFacility, item))}
                        className={cn('min-h-9 rounded-pill px-3 text-sm ring-1 ring-inset transition-colors duration-150', on ? 'bg-ok-soft font-medium text-ok ring-ok-border' : 'bg-surface text-ink-muted ring-line hover:text-ink')}
                      >
                        {on ? '✓ ' : '+ '}{item}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
              <div>
                <label className={labelClass} htmlFor="meeting-type">ประเภทการประชุม <span className="font-normal text-ink-subtle">(ถ้ามี)</span></label>
                <select className={inputClass} id="meeting-type" value={meetingType} onChange={(e) => setMeetingType(e.target.value)}>
                  <option value="">ไม่ระบุ</option>
                  {lookups.active('meetingType').map((item) => <option key={item.lookupId} value={item.key}>{item.label}</option>)}
                </select>
              </div>
            <div>
              <label className={labelClass} htmlFor="note">รายละเอียดเพิ่มเติม <span className="font-normal text-ink-subtle">(ถ้ามี)</span></label>
              <textarea className={cn(inputClass, 'min-h-24 py-2.5')} id="note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="วาระการประชุมหรือข้อมูลที่ต้องแจ้งผู้ดูแล" />
            </div>
            <div>
              <p className={labelClass}>เอกสารแนบ <span className="font-normal text-ink-subtle">(ถ้ามี เช่น บันทึกข้อความ วาระการประชุม)</span></p>
              {attachment ? (
                <div className="flex min-h-14 items-center gap-3 rounded-control border border-ok-border bg-ok-soft px-3 py-2">
                  {(() => { const Icon = attachmentIcon(attachment.mimeType); return <Icon className="size-5 shrink-0 text-ok" aria-hidden="true" />; })()}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{attachment.name}</span>
                    <span className="block text-xs text-ink-muted">{formatFileSize(attachment.size)} · แนบไปกับคำขอ ผู้อนุมัติเปิดได้จาก LINE</span>
                  </span>
                  <button type="button" onClick={() => setAttachment(null)} aria-label={`เอาไฟล์ ${attachment.name} ออก`} className="grid size-10 shrink-0 place-items-center rounded-control text-ink-muted hover:bg-surface hover:text-danger">
                    <X className="size-5" aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <label htmlFor="attachment" className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-control border border-dashed border-line-strong px-3 text-sm font-medium text-ink-muted transition-colors duration-150 hover:border-brand-border hover:bg-brand-soft/40 hover:text-brand has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand">
                  <input ref={fileInputRef} id="attachment" type="file" accept={ATTACHMENT_ACCEPT} className="sr-only" aria-describedby="attachment-hint" onChange={(e) => void chooseFile(e.target.files?.[0])} />
                  <Paperclip className="size-4" aria-hidden="true" />
                  {readingFile ? 'กำลังอ่านไฟล์…' : 'เลือกไฟล์แนบ'}
                </label>
              )}
              <p id="attachment-hint" className={cn('mt-1 text-xs', attachmentError ? 'font-medium text-danger' : 'text-ink-subtle')} role={attachmentError ? 'alert' : undefined}>
                {attachmentError || `${ATTACHMENT_TYPES_TEXT} 1 ไฟล์ ไม่เกิน ${formatFileSize(maxAttachmentBytes)} · เปิดดูได้เฉพาะผู้จอง ผู้อนุมัติ และผู้ดูแลระบบ`}
              </p>
            </div>
            </div>
          </details>

          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-card border border-dashed border-brand-border bg-brand-soft/60 px-4 text-base font-medium text-brand transition-colors hover:bg-brand-soft"
          >
            <FileText className="size-5" aria-hidden="true" />
            ดูตัวอย่างแบบฟอร์มคำขอที่จะพิมพ์ออกมา
          </button>
        </form>
        {previewOpen && <FormPreviewDialog data={formData} roomCode={room?.code ?? ''} roomName={room?.name} onClose={closePreview} />}

        <aside
          aria-label="สรุปการจอง"
          className="sticky bottom-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom))] z-10 -mx-4 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur lg:top-6 lg:bottom-auto lg:mx-0 lg:overflow-hidden lg:rounded-card lg:border lg:bg-surface lg:p-0 lg:shadow-raised lg:backdrop-blur-none"
        >
          <div className="hidden lg:block">
            <div className={`relative overflow-hidden bg-gradient-to-br px-5 py-4 text-ink-inverse ${room ? band(room.roomId) : 'from-blue-700 to-blue-950'}`}>
              <span aria-hidden="true" className="absolute -right-8 -top-10 size-32 rounded-full bg-white/10" />
              <p className="text-sm text-ink-inverse/80">สรุปการจอง</p>
              <p className="mt-0.5 text-lg font-semibold leading-snug">{openLocation ? customLocation.trim() || 'สถานที่อื่น (ยังไม่ระบุ)' : room?.name ?? 'ยังไม่ได้เลือกห้อง'}</p>
              {title.trim() && <p className="mt-0.5 line-clamp-2 text-sm text-ink-inverse/85">เรื่อง {title.trim()}</p>}
            </div>
            <dl className="space-y-3 px-5 py-4 text-sm">
              <SummaryRow icon={CalendarDays} label="วันที่">{thaiDate(dateKey, { dateStyle: 'long' })}</SummaryRow>
              <SummaryRow icon={Clock3} label="เวลา">
                <span className={cn(roomConflict && 'text-danger')}>{start}–{end} น.</span>
                <span className="text-ink-muted"> ({durationText(endMin - startMin)})</span>
              </SummaryRow>
              <SummaryRow icon={Users} label="ผู้เข้าร่วม">
                <span className={cn(overCapacity && 'text-warn')}>{attendeeCount} คน</span>
                {room && !openLocation && <span className="text-ink-muted"> จาก {capacity} ที่นั่ง</span>}
              </SummaryRow>
              {requestedFacilities.length > 0 && (
                <SummaryRow icon={Projector} label="ขอใช้">
                  {requestedFacilities.map((key) => lookups.label('facility', key)).join(', ')}
                </SummaryRow>
              )}
            </dl>
          </div>

          <p className="truncate text-sm font-medium text-ink lg:hidden">
            {room?.name ?? 'เลือกห้อง'} · {thaiDate(dateKey, { day: 'numeric', month: 'short' })} · <span className={cn(roomConflict && 'text-danger')}>{start}–{end} น.</span>
          </p>
          <p className={cn('mt-0.5 text-xs lg:mt-0 lg:border-t lg:border-line lg:px-5 lg:py-3', missing.length ? 'text-warn' : 'text-ok')}>
            {missing.length ? `ยังขาด: ${missing.join(' · ')}` : rules.approvalRequired ? (user ? 'พร้อมส่ง คำขอจะผ่านการอนุมัติ 3 ขั้น ติดตามได้ที่รายการจองของฉัน' : 'พร้อมส่ง ส่งแล้วได้ QR ไว้ติดตามผลอนุมัติ') : 'พร้อมส่ง ส่งแล้วได้ห้องทันที'}
          </p>
          <div className="mt-2 flex gap-3 lg:mt-0 lg:flex-col-reverse lg:gap-2 lg:px-5 lg:pb-5">
            <Button variant="secondary" onClick={() => nav(-1)}>กลับ</Button>
            <Button form="booking-form" className="flex-1" type="submit" icon={<Send className="size-4" aria-hidden="true" />} loading={busy} loadingLabel="กำลังบันทึก" disabled={!roomId || !termsAccepted || roomConflict || readingFile}>
              ส่งคำขอจอง
            </Button>
          </div>
        </aside>
      </div>
    </>
  );
}

function Section({ step, title, hint, done, children }: { step: number; title: string; hint?: string; done: boolean; children: ReactNode }) {
  const id = `booking-step-${step}`;
  return (
    <section aria-labelledby={id} className="rounded-card border border-line bg-surface p-5 shadow-card sm:p-6">
      <header className="mb-4 flex items-center gap-3">
        <span
          aria-hidden="true"
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold transition-colors duration-200',
            done ? 'bg-ok text-ink-inverse' : 'bg-brand-soft text-brand',
          )}
        >
          {done ? <Check className="size-4" strokeWidth={3} /> : step}
        </span>
        <div className="min-w-0">
          <h2 id={id} className="text-base font-semibold text-ink">
            {title}
            {done && <span className="sr-only"> (เรียบร้อย)</span>}
          </h2>
          {hint && <p className="truncate text-sm text-ink-muted">{hint}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

function SummaryRow({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
      <div className="min-w-0">
        <dt className="text-xs text-ink-subtle">{label}</dt>
        <dd className="font-medium text-ink">{children}</dd>
      </div>
    </div>
  );
}
