import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { CalendarPlus, Copy, Printer, Search, Share2, Trash2, XCircle } from 'lucide-react';
import { APPROVAL_STEPS, currentApprovalStep } from '@shared/domain/approval';
import { formatTrackingCode, normalizeTrackingCode } from '@shared/schemas/guest';
import { fromDateKeyAndMinutes } from '@shared/time/bangkok';
import { useApp } from '../../app/providers/AppProvider';
import { PageHeader } from '../../components/layout/PageHeader';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { QrCode } from '../../components/ui/QrCode';
import { LoadingState } from '../../components/ui/States';
import type { DemoBooking, DemoRoom } from '../../lib/api/demo';
import { useLiveRefresh } from '../../lib/hooks/useLiveRefresh';
import { formatFullDate, formatTimeRange } from '../../lib/format/thai';
import { cn } from '../../lib/cn';
import { ApprovalProgress } from '../approvals/ApprovalProgress';
import { RequestFormSheet } from '../requestForm/RequestFormSheet';
import { ScaledSheet } from '../requestForm/ScaledSheet';
import { forgetTracking, rememberTracking, rememberedBookings } from './trackingMemory';

/** ลิงก์เต็มของหน้าติดตาม (ใช้ใน QR) — HashRouter จึงต่อ #/track/รหัส */
export function trackUrl(code: string): string {
  return `${window.location.origin}${window.location.pathname}#/track/${code}`;
}

const ended = (booking: DemoBooking) => fromDateKeyAndMinutes(booking.dateKey, booking.endMin).getTime() <= Date.now();

function statusView(booking: DemoBooking): { label: string; detail: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' } {
  if (booking.status === 'pending') {
    const step = currentApprovalStep(booking);
    return { label: APPROVAL_STEPS[step - 1]?.waiting ?? 'รออนุมัติ', detail: `อยู่ขั้นที่ ${step} จาก 3 — ผลเปลี่ยนเมื่อไรหน้านี้อัปเดตเอง`, tone: 'warn' };
  }
  if (booking.status === 'rejected') {
    const reason = booking.approvalLog?.find((entry) => entry.decision === 'reject')?.reason;
    return { label: 'ไม่อนุมัติ', detail: reason ? `เหตุผล: ${reason}` : 'ติดต่อเจ้าหน้าที่หากต้องการสอบถาม', tone: 'danger' };
  }
  if (booking.status === 'cancelled') return { label: 'ยกเลิกแล้ว', detail: 'คำขอนี้ไม่ได้ใช้ห้องแล้ว', tone: 'neutral' };
  if (ended(booking)) return { label: 'ประชุมเสร็จแล้ว', detail: 'ขอบคุณที่ใช้บริการ', tone: 'neutral' };
  return { label: 'อนุมัติแล้ว ใช้ห้องได้', detail: 'ผ่านการอนุมัติครบ 3 ขั้น', tone: 'ok' };
}

const TONE = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-neutral-soft text-ink-muted',
} as const;

/** หน้าติดตามคำขอด้วยรหัส — ไม่ต้องเข้าสู่ระบบ ใช้ได้ทั้งจากลิงก์ QR และพิมพ์รหัสเอง */
export function TrackPage() {
  const { code: rawCode = '' } = useParams();
  const code = normalizeTrackingCode(rawCode);
  const { api } = useApp();
  const location = useLocation();
  const justBooked = (location.state as { justBooked?: boolean } | null)?.justBooked === true;
  const [booking, setBooking] = useState<DemoBooking | null>(null);
  const [room, setRoom] = useState<DemoRoom | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const load = useCallback(() => {
    if (code === '') { setError('รหัสติดตามไม่ถูกต้อง (10 ตัว เช่น ABCDE-FGHJK)'); return Promise.resolve(); }
    return api.trackBooking(code)
      .then((result) => {
        setBooking(result.booking);
        setRoom(result.room);
        setError('');
        rememberTracking({ code, title: result.booking.title, dateKey: result.booking.dateKey, startMin: result.booking.startMin, endMin: result.booking.endMin, roomId: result.booking.roomId });
      })
      .catch((e: Error) => setError(e.message));
  }, [api, code]);
  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(load);

  // เบราว์เซอร์ในแอป (LINE, Facebook) มักคัดลอกอัตโนมัติไม่ได้ — ถ้าไม่สำเร็จ แสดงลิงก์ให้กดค้างคัดลอกเอง
  const [showLink, setShowLink] = useState(false);
  const copyLink = () => {
    const done = () => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); };
    if (!navigator.clipboard) { setShowLink(true); return; }
    navigator.clipboard.writeText(trackUrl(code)).then(done, () => setShowLink(true));
  };
  const canShare = typeof navigator.share === 'function';
  const share = () => {
    void navigator.share({ title: 'คำขอใช้ห้องประชุม', text: `ติดตามสถานะคำขอ รหัส ${formatTrackingCode(code)}`, url: trackUrl(code) }).catch(() => undefined);
  };

  if (error && !booking) {
    return <>
      <PageHeader title="ติดตามสถานะคำขอ" />
      <Alert tone="danger" title="ไม่พบคำขอ">{error}</Alert>
      <TrackLookupForm className="mt-5" />
    </>;
  }
  if (!booking) return <LoadingState message="กำลังโหลดคำขอ" />;

  const status = statusView(booking);
  const placeName = booking.customLocation || room?.name || 'ห้องประชุม';
  const cancellable = ['pending', 'confirmed'].includes(booking.status) && !ended(booking);

  return <div className="mx-auto max-w-3xl">
    <div className="no-print">
      <PageHeader title="ติดตามสถานะคำขอ" description={`รหัส ${formatTrackingCode(code)}`} />
      {justBooked && (
        <Alert tone="ok" title="ส่งคำขอจองเรียบร้อยแล้ว" className="mb-5">
          เก็บรหัสหรือบันทึกรูป QR ด้านล่างไว้ ใช้เปิดดูผลอนุมัติ พิมพ์แบบฟอร์ม หรือยกเลิกคำขอได้ทุกเมื่อ เครื่องนี้จำรายการไว้ให้แล้วด้วย
        </Alert>
      )}
      {error && <Alert tone="warn" title="อัปเดตสถานะไม่สำเร็จ" className="mb-5">{error}</Alert>}

      <Card className="mb-5"><CardBody className="space-y-4 p-5 sm:p-6">
        <div>
          <span className={cn('inline-block rounded-full px-3 py-1.5 text-base font-semibold', TONE[status.tone])}>{status.label}</span>
          <p className="mt-2 text-sm text-ink-muted">{status.detail}</p>
        </div>
        <div>
          <h2 className="text-xl font-semibold text-ink">{booking.title}</h2>
          <p className="mt-1 text-base text-ink">{placeName}</p>
          <p className="text-base text-ink-muted">{formatFullDate(booking.dateKey)} · {formatTimeRange(booking.startMin, booking.endMin)} น.</p>
          <p className="mt-1 text-sm text-ink-muted">ผู้ขอ {booking.bookerName || booking.userName} · {booking.department} · {booking.attendees} คน</p>
        </div>
        <ApprovalProgress booking={booking} />
      </CardBody></Card>

      <Card className="mb-5">
        <CardHeader title="QR Code ติดตามสถานะ" description="สแกนหรือเปิดลิงก์นี้เพื่อดูสถานะได้ทุกเมื่อ ไม่ต้องเข้าสู่ระบบ" />
        <CardBody className="grid items-center gap-5 p-5 sm:grid-cols-[15rem_minmax(0,1fr)] sm:p-6">
          <QrCode value={trackUrl(code)} label={`QR Code ติดตามสถานะคำขอ รหัส ${formatTrackingCode(code)}`} downloadName={`QR คำขอห้องประชุม ${formatTrackingCode(code)}`} />
          <div className="space-y-3">
            <p className="text-sm text-ink-muted">รหัสติดตาม</p>
            <p className="text-3xl font-semibold tracking-wider text-ink tabular-nums">{formatTrackingCode(code)}</p>
            <p className="text-sm text-ink-muted">ใครมีรหัสนี้ก็เห็นคำขอนี้ได้ อย่าส่งต่อให้คนที่ไม่เกี่ยวข้อง</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" icon={<Copy className="size-4" aria-hidden="true" />} onClick={copyLink}>{copied ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์'}</Button>
              {canShare && <Button variant="secondary" icon={<Share2 className="size-4" aria-hidden="true" />} onClick={share}>แชร์</Button>}
              <Button icon={<Printer className="size-4" aria-hidden="true" />} onClick={() => window.print()}>พิมพ์แบบฟอร์มคำขอ</Button>
            </div>
            {showLink && (
              <div>
                <label htmlFor="track-link" className="mb-1 block text-sm text-ink-muted">คัดลอกอัตโนมัติไม่ได้ในแอปนี้ — กดค้างที่ลิงก์เพื่อคัดลอก</label>
                <input id="track-link" readOnly value={trackUrl(code)} onFocus={(e) => e.currentTarget.select()} autoFocus
                  className="min-h-11 w-full rounded-control border border-line bg-surface-sunken px-3 text-sm text-ink" />
              </div>
            )}
            {cancellable && (
              <button type="button" onClick={() => setCancelOpen(true)} className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-danger hover:underline">
                <XCircle className="size-4" aria-hidden="true" />ยกเลิกคำขอนี้
              </button>
            )}
          </div>
        </CardBody>
      </Card>

      <h2 className="mb-3 text-base font-semibold text-ink">แบบฟอร์มคำขอ (พร้อมพิมพ์)</h2>
    </div>
    <div className="rounded-card bg-surface-sunken p-2 ring-1 ring-inset ring-line sm:p-6 print:bg-transparent print:p-0 print:ring-0">
      <ScaledSheet>
        <RequestFormSheet className="shadow-raised print:shadow-none" roomCode={room?.code ?? ''} roomName={room?.name} data={{ ...booking, bookerName: booking.bookerName || booking.userName }} />
      </ScaledSheet>
    </div>

    {cancelOpen && <CancelDialog code={code} onClose={() => setCancelOpen(false)} onDone={(updated) => { setBooking(updated); setCancelOpen(false); }} />}
  </div>;
}

function CancelDialog({ code, onClose, onDone }: { code: string; onClose: () => void; onDone: (booking: DemoBooking) => void }) {
  const { api } = useApp();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);
  const confirm = () => {
    setBusy(true);
    api.trackCancel(code, reason).then(({ booking }) => onDone(booking)).catch((e: Error) => { setError(e.message); setBusy(false); });
  };
  return (
    <Dialog labelId="track-cancel-title" title="ยกเลิกคำขอนี้?" description="ยกเลิกแล้วกู้คืนไม่ได้ เวลานี้จะว่างให้คนอื่นจองทันที" onClose={close}
      footer={<>
        <Button variant="secondary" onClick={close} disabled={busy} data-autofocus>ไม่ยกเลิก</Button>
        <Button variant="danger" loading={busy} loadingLabel="กำลังยกเลิก" onClick={confirm}>ยืนยันยกเลิก</Button>
      </>}>
      {error && <Alert tone="danger" title="ยกเลิกไม่สำเร็จ" className="mb-3">{error}</Alert>}
      <label htmlFor="track-cancel-reason" className="mb-1.5 block text-sm font-medium text-ink">เหตุผล (ถ้ามี)</label>
      <textarea id="track-cancel-reason" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)}
        className="w-full rounded-control border border-line bg-surface px-3 py-2 text-base text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
    </Dialog>
  );
}

/** ช่องกรอกรหัสติดตาม */
export function TrackLookupForm({ className = "" }: { className?: string }) {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const code = normalizeTrackingCode(value);
    if (code === '') { setError('รหัสต้องมี 10 ตัว (ตัวอักษรและตัวเลข) เช่น ABCDE-FGHJK'); return; }
    navigate(`/track/${code}`);
  };
  return (
    <Card className={className}><CardBody className="p-5">
      <form onSubmit={submit} noValidate>
        <label htmlFor="track-code" className="mb-1.5 block text-base font-medium text-ink">รหัสติดตาม</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input id="track-code" value={value} onChange={(e) => { setValue(e.target.value); setError(''); }} autoComplete="off" autoCapitalize="characters" spellCheck={false}
            placeholder="ABCDE-FGHJK" aria-invalid={error !== ''} aria-describedby={error ? 'track-code-error' : undefined}
            className="min-h-12 min-w-0 flex-1 rounded-control border border-line bg-surface px-4 text-lg tracking-wider text-ink uppercase outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
          <Button type="submit" size="lg" icon={<Search className="size-5" aria-hidden="true" />}>ดูสถานะ</Button>
        </div>
        {error && <p id="track-code-error" role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      </form>
    </CardBody></Card>
  );
}

/** /track — กรอกรหัส หรือเลือกจากรายการที่เครื่องนี้เคยจอง */
export function TrackLookupPage() {
  const [items, setItems] = useState(rememberedBookings);
  return <div className="mx-auto max-w-3xl">
    <PageHeader title="ติดตามสถานะคำขอ" description="ใส่รหัสติดตามที่ได้ตอนจอง หรือสแกน QR Code ของคำขอ" />
    <TrackLookupForm className="mb-6" />
    <h2 className="mb-3 text-base font-semibold text-ink">คำขอที่จองจากเครื่องนี้</h2>
    {items.length === 0 ? (
      <Card><CardBody className="py-10 text-center">
        <p className="text-base text-ink">ยังไม่มีคำขอที่จองจากเครื่องนี้</p>
        <Link to="/book" className="mt-4 inline-flex min-h-12 items-center gap-2 rounded-control bg-brand-gradient px-5 text-base font-semibold text-ink-inverse shadow-brand"><CalendarPlus className="size-5" aria-hidden="true" />จองห้องประชุม</Link>
      </CardBody></Card>
    ) : (
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.code}>
            <Card><CardBody className="flex items-center gap-3 p-4">
              <Link to={`/track/${item.code}`} className="min-w-0 flex-1 rounded-control focus-visible:outline-2 focus-visible:outline-brand">
                <span className="block truncate text-base font-semibold text-ink">{item.title || 'คำขอใช้ห้อง'}</span>
                <span className="block text-sm text-ink-muted">{formatFullDate(item.dateKey)} · {formatTimeRange(item.startMin, item.endMin)} น. · {formatTrackingCode(item.code)}</span>
              </Link>
              <button type="button" aria-label={`ลบ ${item.title} ออกจากเครื่องนี้`} title="ลบออกจากเครื่องนี้ (คำขอไม่ถูกยกเลิก)"
                onClick={() => { forgetTracking(item.code); setItems(rememberedBookings()); }}
                className="grid size-11 shrink-0 place-items-center rounded-control text-ink-subtle hover:bg-neutral-soft hover:text-ink">
                <Trash2 className="size-5" aria-hidden="true" />
              </button>
            </CardBody></Card>
          </li>
        ))}
      </ul>
    )}
    <p className="mt-4 text-sm text-ink-muted">รายการนี้เก็บไว้ในเบราว์เซอร์เครื่องนี้เท่านั้น ถ้าใช้เครื่องสาธารณะ กดถังขยะเพื่อลบออกได้ (คำขอไม่ถูกยกเลิก)</p>
  </div>;
}
