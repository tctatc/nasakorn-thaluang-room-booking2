import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, CalendarPlus, ChevronRight, ClipboardList, KeyRound, LockKeyhole, Pencil, Phone } from 'lucide-react';
import { USER_ROLE_LABEL_TH, validateOwnProfileInput } from '@shared/schemas/user';
import { formatTimeOfDay } from '@shared/time/bangkok';
import { useApp, useCurrentUser } from '../../app/providers/AppProvider';
import type { DemoBooking, DemoRoom } from '../../lib/api/demo';
import { useLiveRefresh } from '../../lib/hooks/useLiveRefresh';
import { formatShortDate, nameInitial } from '../../lib/format/thai';
import { Alert } from '../../components/ui/Alert';
import { Badge, BookingStatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { useToast } from '../../components/ui/Toast';
import { ApprovalProgress } from '../approvals/ApprovalProgress';
import { AnnouncementsPanel } from '../dashboard/AnnouncementsPanel';
import { RoomStatusNow } from '../dashboard/RoomStatusNow';
import { CredentialForm } from './CredentialForm';
import { cn } from '../../lib/cn';

const inputClass = 'min-h-11 w-full rounded-control border border-line bg-surface px-3 text-base text-ink outline-none transition-colors duration-150 focus:border-brand focus:ring-2 focus:ring-brand/20';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
const ACTIVE = new Set(['pending', 'confirmed']);

/**
 * หน้าของฉัน — ที่เดียวสำหรับผู้ใช้: ข้อมูลของตัวเอง จองห้อง ติดตามคำขอ และตั้งรหัสผ่าน/PIN
 * ผู้ใช้งานทั่วไปเห็นเป็นหน้าแรก ผู้ลงนามและผู้ดูแลเปิดจากเมนูโปรไฟล์ (บัญชีของฉัน)
 */
export function MyPage({ asHome = false }: { asHome?: boolean }) {
  const { api, token } = useApp();
  const user = useCurrentUser();
  const [bookings, setBookings] = useState<DemoBooking[] | null>(null);
  const [rooms, setRooms] = useState<DemoRoom[]>([]);
  const [loadError, setLoadError] = useState('');
  const [editingPhone, setEditingPhone] = useState(false);
  const [changing, setChanging] = useState<'password' | 'pin' | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(() => Promise.all([api.bookings(token), api.rooms(token)])
    .then(([bookingResult, roomResult]) => {
      // ผู้ลงนาม/ผู้ดูแลได้ทุกรายการจาก server — หน้านี้แสดงเฉพาะของตัวเอง
      setBookings(bookingResult.bookings.filter((booking) => booking.userEmail === user.email));
      setRooms(roomResult.rooms);
      setLoadError('');
      setRefreshKey((key) => key + 1);
    })
    .catch((cause: unknown) => setLoadError(cause instanceof Error ? cause.message : 'โหลดคำขอไม่สำเร็จ')), [api, token, user.email]);
  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(load);

  const mine = bookings ?? [];
  const now = today();
  const pending = mine.filter((booking) => booking.status === 'pending');
  const upcoming = mine.filter((booking) => booking.status === 'confirmed' && booking.dateKey >= now);
  const declined = mine.filter((booking) => booking.status === 'rejected');
  // ที่กำลังดำเนินการก่อน (ใกล้วันใช้ห้องก่อน) แล้วตามด้วยรายการล่าสุดที่จบแล้ว
  const shown = [
    ...mine.filter((booking) => ACTIVE.has(booking.status) && booking.dateKey >= now)
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.startMin - b.startMin),
    ...mine.filter((booking) => !(ACTIVE.has(booking.status) && booking.dateKey >= now))
      .sort((a, b) => b.dateKey.localeCompare(a.dateKey) || b.startMin - a.startMin),
  ].slice(0, 5);
  const roomName = (booking: DemoBooking) => booking.customLocation || rooms.find((room) => room.roomId === booking.roomId)?.name || 'ห้องประชุม';
  const initial = nameInitial(user.displayName);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {/* ใครกำลังใช้งาน */}
      <section aria-labelledby="me-name" className="enter rounded-card bg-surface p-5 shadow-card ring-1 ring-line/70 sm:p-6">
        <div className="flex items-start gap-4">
          <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-full bg-brand-soft text-2xl font-semibold text-brand">{initial}</span>
          <div className="min-w-0 flex-1">
            <h1 id="me-name" className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{user.displayName}</h1>
            <p className="mt-0.5 text-base text-ink-muted">{[user.position, user.department].filter(Boolean).join(' · ') || 'ยังไม่ได้ระบุตำแหน่งและแผนก'}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone={user.role === 'staff' ? 'neutral' : 'brand'}>{USER_ROLE_LABEL_TH[user.role]}</Badge>
              <span className="text-sm text-ink-subtle">ชื่อผู้ใช้ {user.email}</span>
            </div>
          </div>
        </div>

        <div className="mt-4 border-t border-line pt-4">
          {editingPhone ? (
            <PhoneForm onClose={() => setEditingPhone(false)} />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Phone className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
              <p className="min-w-0 flex-1 text-base">
                <span className="text-ink-muted">เบอร์โทร </span>
                {user.phone ? <span className="tabular-nums text-ink">{user.phone}</span> : <span className="text-warn">ยังไม่ได้ใส่ ใส่ไว้แล้วฟอร์มจองจะเติมให้เอง</span>}
              </p>
              <Button size="sm" variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEditingPhone(true)}>{user.phone ? 'แก้ไข' : 'ใส่เบอร์'}</Button>
            </div>
          )}
          <p className="mt-2 text-sm text-ink-subtle">ชื่อ ตำแหน่ง และแผนก ผู้ดูแลระบบเป็นผู้กำหนด ถ้าไม่ถูกต้องให้แจ้งผู้ดูแล</p>
        </div>
      </section>

      {/* ทำอะไรได้บ้าง */}
      <nav aria-label="ทางลัด" className="grid gap-3 sm:grid-cols-3">
        <Link to="/book" className="flex min-h-14 items-center gap-3 rounded-card bg-brand-gradient px-4 font-semibold text-ink-inverse shadow-brand transition-[filter] hover:brightness-110">
          <CalendarPlus className="size-5 shrink-0" aria-hidden="true" />จองห้องประชุม
        </Link>
        <Link to="/calendar" className="flex min-h-14 items-center gap-3 rounded-card bg-surface px-4 font-medium text-ink shadow-card ring-1 ring-line/70 transition-colors hover:bg-surface-sunken">
          <CalendarDays className="size-5 shrink-0 text-brand" aria-hidden="true" />ดูห้องว่าง / ปฏิทิน
        </Link>
        <Link to="/my-bookings" className="flex min-h-14 items-center gap-3 rounded-card bg-surface px-4 font-medium text-ink shadow-card ring-1 ring-line/70 transition-colors hover:bg-surface-sunken">
          <ClipboardList className="size-5 shrink-0 text-brand" aria-hidden="true" />คำขอทั้งหมดของฉัน
        </Link>
      </nav>

      {/* คำขอของฉัน */}
      <section aria-labelledby="my-requests" className="rounded-card bg-surface shadow-card ring-1 ring-line/70">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5 sm:px-6">
          <h2 id="my-requests" className="text-lg font-semibold text-ink">คำขอของฉัน</h2>
          <Link to="/my-bookings" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand hover:underline">ดูทั้งหมด<ChevronRight className="size-4" aria-hidden="true" /></Link>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 px-5 sm:px-6">
          {[
            { label: 'รออนุมัติ', value: pending.length, tone: 'text-warn' },
            { label: 'อนุมัติแล้ว รอใช้ห้อง', value: upcoming.length, tone: 'text-ok' },
            { label: 'ไม่อนุมัติ', value: declined.length, tone: 'text-danger' },
          ].map((item) => (
            <div key={item.label} className="rounded-control bg-surface-sunken px-3 py-3">
              <dt className="text-xs text-ink-muted sm:text-sm">{item.label}</dt>
              <dd className={cn('mt-0.5 text-2xl font-semibold tabular-nums', bookings === null ? 'text-ink-subtle' : item.tone)}>{bookings === null ? '–' : item.value}</dd>
            </div>
          ))}
        </dl>

        {loadError && <Alert tone="danger" title="โหลดคำขอไม่สำเร็จ" className="mx-5 mt-4 sm:mx-6">{loadError}</Alert>}

        {bookings !== null && shown.length === 0 ? (
          <div className="px-5 py-10 text-center sm:px-6">
            <p className="text-base text-ink">ยังไม่มีคำขอใช้ห้อง</p>
            <p className="mt-1 text-sm text-ink-muted">จองห้องแล้วติดตามผลอนุมัติ 3 ขั้นได้ที่นี่</p>
            <Link to="/book" className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-control bg-brand-gradient px-4 font-medium text-ink-inverse shadow-brand hover:brightness-110">
              <CalendarPlus className="size-4" aria-hidden="true" />จองห้องแรก
            </Link>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {shown.map((booking) => (
              <li key={booking.bookingId} className="px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{booking.title || 'คำขอใช้ห้อง'}</p>
                    <p className="text-sm text-ink-muted">
                      {roomName(booking)} · {formatShortDate(booking.dateKey)} · {formatTimeOfDay(booking.startMin)}–{formatTimeOfDay(booking.endMin)} น.
                    </p>
                  </div>
                  <BookingStatusBadge status={booking.status} />
                </div>
                {booking.status === 'pending' && <ApprovalProgress booking={booking} className="mt-3" />}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* หน้าแรกของผู้ใช้งาน: ดูได้ทันทีว่าห้องไหนว่างตอนนี้ (เหมือนหน้าภาพรวมของเจ้าหน้าที่) — อยู่ใต้คำขอของตัวเอง */}
      {asHome && <RoomStatusNow rooms={rooms} refreshKey={refreshKey} narrow />}

      {/* บัญชีและความปลอดภัย */}
      <section aria-labelledby="my-security" className="rounded-card bg-surface p-5 shadow-card ring-1 ring-line/70 sm:p-6">
        <h2 id="my-security" className="text-lg font-semibold text-ink">รหัสผ่านและ PIN</h2>
        <p className="mt-1 text-sm text-ink-muted">เปลี่ยนแล้วเครื่องอื่นที่เข้าสู่ระบบค้างไว้จะถูกออกจากระบบ ส่วนเครื่องนี้ใช้งานต่อได้เลย</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => setChanging('password')} className="flex min-h-14 items-center gap-3 rounded-control px-4 text-left ring-1 ring-line transition-colors hover:bg-surface-sunken">
            <LockKeyhole className="size-5 shrink-0 text-brand" aria-hidden="true" />
            <span className="min-w-0 flex-1"><span className="block font-medium text-ink">เปลี่ยนรหัสผ่าน</span><span className="block text-sm text-ink-muted">ใช้คู่กับชื่อผู้ใช้</span></span>
            <ChevronRight className="size-4 text-ink-subtle" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setChanging('pin')} className="flex min-h-14 items-center gap-3 rounded-control px-4 text-left ring-1 ring-line transition-colors hover:bg-surface-sunken">
            <KeyRound className="size-5 shrink-0 text-brand" aria-hidden="true" />
            <span className="min-w-0 flex-1"><span className="block font-medium text-ink">เปลี่ยน PIN</span><span className="block text-sm text-ink-muted">เข้าสู่ระบบแบบเร็ว และยืนยันตอนลงนาม</span></span>
            <ChevronRight className="size-4 text-ink-subtle" aria-hidden="true" />
          </button>
        </div>
      </section>

      {asHome && <AnnouncementsPanel refreshKey={refreshKey} />}

      {changing !== null && <ChangeDialog what={changing} onClose={() => setChanging(null)} />}
    </div>
  );
}

function PhoneForm({ onClose }: { onClose: () => void }) {
  const { api, token, replaceUser } = useApp();
  const user = useCurrentUser();
  const toast = useToast();
  const [phone, setPhone] = useState(user.phone ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = validateOwnProfileInput({ phone });
    if (!parsed.ok) { setError(parsed.issues[0]?.message ?? 'เบอร์โทรไม่ถูกต้อง'); return; }
    setBusy(true);
    api.updateOwnProfile(token, parsed.value)
      .then((result) => { replaceUser(result.user); toast.success('บันทึกเบอร์โทรแล้ว'); onClose(); })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'บันทึกไม่สำเร็จ'))
      .finally(() => setBusy(false));
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-start gap-2">
      <div className="min-w-0 flex-1 basis-56">
        <label htmlFor="me-phone" className="mb-1.5 block text-sm font-medium text-ink">เบอร์โทร</label>
        <input
          id="me-phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={30} className={inputClass}
          value={phone} onChange={(event) => { setPhone(event.target.value); setError(''); }} placeholder="081-234-5678"
          aria-invalid={error ? true : undefined} aria-describedby={error ? 'me-phone-error' : undefined}
        />
        {error && <p id="me-phone-error" className="mt-1 text-sm font-medium text-danger">{error}</p>}
      </div>
      <div className="flex gap-2 sm:mt-7">
        <Button type="submit" loading={busy} loadingLabel="กำลังบันทึก">บันทึก</Button>
        <Button variant="secondary" disabled={busy} onClick={onClose}>ยกเลิก</Button>
      </div>
    </form>
  );
}

const CHANGE_TEXT = {
  password: { title: 'เปลี่ยนรหัสผ่าน', hint: 'ใส่รหัสผ่านปัจจุบันก่อน แล้วตั้งรหัสใหม่สองครั้งให้ตรงกัน', save: 'บันทึกรหัสผ่านใหม่', done: 'เปลี่ยนรหัสผ่านแล้ว' },
  pin: { title: 'เปลี่ยน PIN', hint: 'ใส่ PIN ปัจจุบันก่อน แล้วตั้ง PIN ใหม่สองครั้งให้ตรงกัน', save: 'บันทึก PIN ใหม่', done: 'เปลี่ยน PIN แล้ว' },
} as const;

function ChangeDialog({ what, onClose }: { what: 'password' | 'pin'; onClose: () => void }) {
  const toast = useToast();
  const text = CHANGE_TEXT[what];
  return (
    <Dialog
      labelId="change-credential-title"
      title={text.title}
      description={text.hint}
      onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={onClose}>ยกเลิก</Button>
        <Button type="submit" form="change-credential">{text.save}</Button>
      </>}
    >
      <CredentialForm
        formId="change-credential"
        password={what === 'password'}
        pin={what === 'pin'}
        hideSubmit
        onDone={() => { toast.success(text.done); onClose(); }}
      />
    </Dialog>
  );
}
