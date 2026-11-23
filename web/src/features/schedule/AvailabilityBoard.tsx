import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck2, CalendarX2, ChevronLeft, ChevronRight, Users } from 'lucide-react';
import { conflictingSlots, freeWindows, type PublicSlot } from '@shared/domain/availability';
import { businessWindow } from '@shared/domain/booking-rules';
import { scheduleWindow } from '@shared/schemas/guest';
import { isOpenLocationRoom } from '@shared/schemas/room';
import type { SystemSettings } from '@shared/schemas/settings';
import { addDaysToDateKey, dayOfWeekOfDateKey, formatTimeOfDay, toDateKey } from '@shared/time/bangkok';
import { useApp } from '../../app/providers/AppProvider';
import { Card, CardBody } from '../../components/ui/Card';
import { TimeSelect } from '../../components/ui/TimeSelect';
import type { DemoRoom } from '../../lib/api/demo';
import { BOOKINGS_CHANGED_EVENT } from '../../lib/api/client';
import { cn } from '../../lib/cn';
import { endTimeOptions, startTimeOptions } from '../booking/timeOptions';

const DAYS = 14;
const thai = (key: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('th-TH', { ...options, timeZone: 'Asia/Bangkok' }).format(new Date(`${key}T12:00:00+07:00`));
const hhmm = (minutes: number) => formatTimeOfDay(minutes);

/**
 * กระดานห้องว่างรายวัน — เลือกวัน แล้วเห็นทุกห้องว่าว่างช่วงไหน (มีแค่ห้องกับเวลา ไม่มีชื่อใคร)
 * เลือก "ช่วงเวลาที่ต้องการ" ครั้งเดียว ระบบบอกทุกห้องว่าชนกับการจองที่มีอยู่หรือไม่ (ตรวจการจองซ้ำ)
 * เรียงแนวตั้งเป็นหลัก: มือถือและจอคอมแนวตั้งอ่านได้โดยไม่ต้องเลื่อนซ้ายขวา
 */
export function AvailabilityBoard({ rooms, settings }: { rooms: DemoRoom[]; settings: SystemSettings }) {
  const { api } = useApp();
  const today = toDateKey(new Date());
  const [windowStart, setWindowStart] = useState(today);
  const [day, setDay] = useState(today);
  const [slots, setSlots] = useState<PublicSlot[] | null>(null);
  const [error, setError] = useState('');
  const [want, setWant] = useState<{ start: number; end: number } | null>(null);
  const { startMin: open, endMin: close } = businessWindow(settings);

  const range = scheduleWindow(windowStart, DAYS);
  const load = useCallback(() => {
    api.publicSchedule(range.from, range.to)
      .then((result) => { setSlots(result.slots); setError(''); })
      .catch((e: Error) => setError(e.message));
  }, [api, range.from, range.to]);
  useEffect(() => {
    load();
    window.addEventListener(BOOKINGS_CHANGED_EVENT, load);
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60_000);
    return () => { window.removeEventListener(BOOKINGS_CHANGED_EVENT, load); window.clearInterval(timer); };
  }, [load]);

  const days = useMemo(() => Array.from({ length: DAYS }, (_v, i) => addDaysToDateKey(windowStart, i)), [windowStart]);
  const bookable = (key: string) => settings.bookableWeekdays.includes(dayOfWeekOfDateKey(key));
  const boardRooms = rooms.filter((room) => !isOpenLocationRoom(room));
  const daySlots = (slots ?? []).filter((slot) => slot.dateKey === day);
  const shift = (amount: number) => {
    const next = addDaysToDateKey(windowStart, amount);
    const start = next < today ? today : next;
    setWindowStart(start);
    setDay(start);
  };
  const startOptions = startTimeOptions(settings);
  const toMinute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  /** เวลาสิ้นสุดที่ใช้ได้กับเวลาเริ่มนี้ — คงค่าเดิมถ้ายังใช้ได้ ไม่งั้นเลือก 1 ชั่วโมงหลังเริ่ม (หรือใกล้สุด) */
  const pickEnd = (start: number, current: number) => {
    const options = endTimeOptions(settings, start);
    if (options.includes(current)) return current;
    return options.find((minute) => minute >= start + 60) ?? options[options.length - 1] ?? start + settings.minBookingMinutes;
  };
  const wantStart = want?.start ?? startOptions[0] ?? open;
  const wantEnd = want?.end ?? pickEnd(wantStart, wantStart + 60);
  const wantText = want ? `${hhmm(want.start)}–${hhmm(want.end)} น.` : '';

  return (
    <section aria-labelledby="board-title" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="board-title" className="text-xl font-semibold text-ink">ปฏิทินห้องว่าง</h2>
          <p className="text-sm text-ink-muted">เลือกวัน ดูว่าห้องไหนว่างช่วงไหน แล้วกดจองได้เลย</p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => shift(-DAYS)} disabled={windowStart <= today} aria-label="ช่วงก่อนหน้า"
            className="grid size-11 place-items-center rounded-control text-ink-muted ring-1 ring-line hover:bg-surface-sunken disabled:opacity-40"><ChevronLeft className="size-5" aria-hidden="true" /></button>
          <button type="button" onClick={() => { setWindowStart(today); setDay(today); }}
            className="min-h-11 rounded-control px-4 text-sm font-medium text-ink ring-1 ring-line hover:bg-surface-sunken">วันนี้</button>
          <button type="button" onClick={() => shift(DAYS)} aria-label="ช่วงถัดไป"
            className="grid size-11 place-items-center rounded-control text-ink-muted ring-1 ring-line hover:bg-surface-sunken"><ChevronRight className="size-5" aria-hidden="true" /></button>
        </div>
      </div>

      {/* แถบเลือกวัน: เลื่อนแนวนอนได้บนมือถือ ตัวเลขใต้วันคือจำนวนการจองวันนั้น */}
      <div role="radiogroup" aria-label="เลือกวัน" className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-7 sm:overflow-visible sm:px-0">
        {days.map((key) => {
          const count = (slots ?? []).filter((slot) => slot.dateKey === key).length;
          const selected = key === day;
          return (
            <button key={key} type="button" role="radio" aria-checked={selected} onClick={() => setDay(key)}
              aria-label={`${thai(key, { dateStyle: 'full' })}${bookable(key) ? ` มี ${count} รายการจอง` : ' ไม่เปิดให้จอง'}`}
              className={cn(
                'flex min-h-16 w-16 shrink-0 snap-start flex-col items-center justify-center rounded-card border text-center transition-colors duration-150 sm:w-auto',
                selected ? 'border-brand bg-brand text-ink-inverse shadow-brand' : 'border-line bg-surface text-ink hover:border-brand-border',
                !bookable(key) && !selected && 'bg-surface-sunken text-ink-subtle',
              )}>
              <span className="text-xs">{key === today ? 'วันนี้' : thai(key, { weekday: 'short' })}</span>
              <span className="text-lg font-semibold leading-tight tabular-nums">{thai(key, { day: 'numeric' })}</span>
              <span className={cn('text-xs', selected ? 'text-white/85' : 'text-ink-muted')}>{bookable(key) ? (count ? `${count} จอง` : 'ว่าง') : 'ปิด'}</span>
            </button>
          );
        })}
      </div>

      {/* ตรวจการจองซ้ำ: เลือกช่วงเวลาที่อยากใช้ แล้วดูทุกห้องพร้อมกันว่าชนไหม */}
      <Card><CardBody className="p-4 sm:p-5">
        <fieldset>
          <legend className="text-base font-semibold text-ink">ตรวจว่าช่วงเวลาที่ต้องการชนกับการจองอื่นไหม</legend>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:flex sm:items-end">
            <div className="sm:w-40">
              <label htmlFor="board-start" className="mb-1.5 block text-sm font-medium text-ink">เริ่ม</label>
              <TimeSelect id="board-start" className="min-h-12 w-full rounded-control border border-line bg-surface px-3 text-base text-ink"
                value={hhmm(wantStart)} options={startOptions}
                onChange={(value) => { const start = toMinute(value); setWant({ start, end: pickEnd(start, wantEnd) }); }} />
            </div>
            <div className="sm:w-40">
              <label htmlFor="board-end" className="mb-1.5 block text-sm font-medium text-ink">สิ้นสุด</label>
              <TimeSelect id="board-end" className="min-h-12 w-full rounded-control border border-line bg-surface px-3 text-base text-ink"
                value={hhmm(wantEnd)} options={endTimeOptions(settings, wantStart)}
                onChange={(value) => setWant({ start: wantStart, end: toMinute(value) })} />
            </div>
            {want && <button type="button" onClick={() => setWant(null)} className="col-span-2 min-h-12 rounded-control px-4 text-sm font-medium text-ink-muted ring-1 ring-line hover:bg-surface-sunken sm:col-span-1">ล้างช่วงเวลา</button>}
          </div>
          <p className="mt-2 text-sm text-ink-muted" aria-live="polite">
            {want ? `ผลการตรวจช่วง ${wantText} ของวันที่ ${thai(day, { day: "numeric", month: "long", year: "numeric" })} แสดงที่แต่ละห้องด้านล่าง` : 'ยังไม่เลือกช่วงเวลา — ด้านล่างแสดงช่วงว่างของแต่ละห้อง'}
          </p>
        </fieldset>
      </CardBody></Card>

      {error && <p role="alert" className="rounded-card bg-danger-soft p-4 text-sm text-danger">โหลดปฏิทินไม่สำเร็จ: {error}</p>}
      {!bookable(day) && <p className="rounded-card bg-surface-sunken p-4 text-base text-ink-muted">{thai(day, { dateStyle: 'full' })} ไม่เปิดให้จองห้อง</p>}

      <ul className="space-y-3" aria-busy={slots === null}>
        {boardRooms.map((room) => {
          const busy = daySlots.filter((slot) => slot.roomId === room.roomId);
          const free = freeWindows(busy, open, close);
          const clash = want ? conflictingSlots({ startMin: want.start, endMin: want.end }, busy) : [];
          const closed = room.status !== 'active' || !bookable(day);
          const bookHref = `/book?room=${encodeURIComponent(room.roomId)}&date=${day}${want && clash.length === 0 ? `&start=${hhmm(want.start)}&end=${hhmm(want.end)}` : ''}`;
          return (
            <li key={room.roomId}>
              <Card><CardBody className="space-y-3 p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold text-ink">{room.name}</h3>
                    <p className="flex items-center gap-1.5 text-sm text-ink-muted"><Users className="size-4 shrink-0" aria-hidden="true" />{room.code} · รองรับ {room.capacity} คน</p>
                  </div>
                  {want && !closed && (
                    clash.length === 0
                      ? <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ok-soft px-3 py-1.5 text-sm font-semibold text-ok"><CalendarCheck2 className="size-4" aria-hidden="true" />ว่าง จองได้</span>
                      : <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-danger-soft px-3 py-1.5 text-sm font-semibold text-danger"><CalendarX2 className="size-4" aria-hidden="true" />ชน</span>
                  )}
                </div>

                <Timeline busy={busy} open={open} close={close} want={closed ? null : want} clash={clash.length > 0} />

                {closed ? (
                  <p className="text-base text-ink-muted">{room.status !== 'active' ? 'ปิดปรับปรุง / ไม่เปิดให้จอง' : 'วันนี้ไม่เปิดให้จอง'}</p>
                ) : (
                  <>
                    {want && clash.length > 0 && (
                      <p className="text-base text-danger">ชนกับการจอง {clash.map((slot) => `${hhmm(slot.startMin)}–${hhmm(slot.endMin)} น.${slot.status === 'pending' ? ' (รออนุมัติ)' : ''}`).join(', ')}</p>
                    )}
                    <p className="text-base text-ink">
                      {free.length === 0 ? 'ไม่ว่างตลอดวัน' : busy.length === 0 ? `ว่างทั้งวัน (${hhmm(open)}–${hhmm(close)} น.)` : `ว่าง ${free.map((w) => `${hhmm(w.startMin)}–${hhmm(w.endMin)}`).join(', ')} น.`}
                    </p>
                    {free.length > 0 && (
                      <Link to={bookHref} className="flex min-h-12 items-center justify-center rounded-control bg-brand-gradient px-4 text-base font-semibold text-ink-inverse shadow-brand transition-[filter] duration-150 hover:brightness-110 sm:inline-flex">
                        {want && clash.length === 0 ? `จองห้องนี้ ${wantText}` : 'จองห้องนี้'}
                      </Link>
                    )}
                  </>
                )}
              </CardBody></Card>
            </li>
          );
        })}
      </ul>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted" aria-label="คำอธิบายสี">
        <li className="flex items-center gap-1.5"><span className="size-3.5 rounded-sm bg-ok-soft ring-1 ring-inset ring-ok-border" aria-hidden="true" />ว่าง</li>
        <li className="flex items-center gap-1.5"><span className="slot-busy size-3.5 rounded-sm" aria-hidden="true" />อนุมัติแล้ว</li>
        <li className="flex items-center gap-1.5"><span className="slot-pending size-3.5 rounded-sm" aria-hidden="true" />รออนุมัติ (จองทับไม่ได้)</li>
        <li className="flex items-center gap-1.5"><span className="size-3.5 rounded-sm ring-2 ring-inset ring-brand" aria-hidden="true" />ช่วงที่ตรวจ</li>
      </ul>
    </section>
  );
}

/** แถบเวลาทั้งวัน (ภาพประกอบ — ข้อมูลเดียวกันมีเป็นข้อความด้านล่างแล้ว จึงซ่อนจากโปรแกรมอ่านหน้าจอ) */
function Timeline({ busy, open, close, want, clash }: {
  busy: PublicSlot[]; open: number; close: number; want: { start: number; end: number } | null; clash: boolean;
}) {
  const span = close - open;
  const pos = (from: number, to: number) => {
    const clamp = (minute: number) => Math.min(Math.max(minute, open), close);
    return { left: `${((clamp(from) - open) / span) * 100}%`, width: `${((clamp(to) - clamp(from)) / span) * 100}%` };
  };
  const ticks: number[] = [];
  for (let minute = Math.ceil(open / 60) * 60; minute <= close; minute += span > 8 * 60 ? 120 : 60) ticks.push(minute);
  return (
    <div aria-hidden="true">
      <div className="relative h-9 overflow-hidden rounded-lg bg-ok-soft ring-1 ring-inset ring-ok-border">
        {busy.map((slot) => <span key={`${slot.startMin}-${slot.endMin}`} className={cn('absolute inset-y-0', slot.status === 'pending' ? 'slot-pending' : 'slot-busy')} style={pos(slot.startMin, slot.endMin)} />)}
        {want && <span className={cn('absolute inset-y-0.5 rounded-md ring-2 ring-inset', clash ? 'bg-danger/20 ring-danger' : 'bg-brand/15 ring-brand')} style={pos(want.start, want.end)} />}
      </div>
      <div className="relative mt-1 h-4 text-xs tabular-nums text-ink-subtle">
        {ticks.map((minute, index) => (
          <span key={minute} className="absolute top-0" style={{ left: `${((minute - open) / span) * 100}%`, transform: index === 0 ? 'none' : minute === close ? 'translateX(-100%)' : 'translateX(-50%)' }}>
            {String(minute / 60).padStart(2, '0')}
          </span>
        ))}
      </div>
    </div>
  );
}
