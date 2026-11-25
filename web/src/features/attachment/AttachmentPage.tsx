import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, Clock3, Download, ExternalLink, MapPin, ShieldCheck, UserRound } from 'lucide-react';
import { formatFileSize, type AttachmentFile } from '@shared/schemas/attachment';
import { BOOKING_STATUS_LABEL_TH } from '@shared/domain/status';
import { useApp } from '../../app/providers/AppProvider';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardBody } from '../../components/ui/Card';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { attachmentIcon, attachmentTypeLabel } from '../../components/ui/AttachmentChip';
import type { DemoBooking } from '../../lib/api/demo';
import { ApiError } from '../../lib/api/types';
import { attachmentObjectUrl, canPreview } from '../../lib/attachment';
import { formatFullDate, formatTimeRange } from '../../lib/format/thai';

const actionClass = 'inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-control px-5 text-base font-medium transition-[filter,background-color] duration-150';

/**
 * หน้าเปิดเอกสารแนบ — ปลายทางของปุ่ม "เปิดเอกสารแนบ" ในการ์ด LINE
 * ต้องเข้าสู่ระบบก่อน (ยังไม่เข้าระบบจะถูกพาไปหน้าเข้าสู่ระบบแล้วกลับมาที่นี่) และ server ตรวจสิทธิ์อีกครั้งก่อนส่งไฟล์
 */
export function AttachmentPage() {
  const { bookingId = '' } = useParams();
  const { api, token } = useApp();
  const [file, setFile] = useState<AttachmentFile | null>(null);
  const [booking, setBooking] = useState<DemoBooking | null>(null);
  const [url, setUrl] = useState('');
  const [roomName, setRoomName] = useState('');
  const [error, setError] = useState<{ title: string; message: string; retry: boolean } | null>(null);

  const load = useCallback(() => {
    setError(null);
    setFile(null);
    api.bookingAttachment(token, bookingId).then((result) => {
      setFile(result.attachment);
      setBooking(result.booking);
      api.rooms(token).then(({ rooms }) => setRoomName(rooms.find((room) => room.roomId === result.booking.roomId)?.name ?? '')).catch(() => {});
    }).catch((e: unknown) => {
      const code = e instanceof ApiError ? e.code : 'INTERNAL';
      const message = e instanceof Error ? e.message : 'เปิดเอกสารไม่สำเร็จ';
      if (code === 'FORBIDDEN') setError({ title: 'ไม่มีสิทธิ์เปิดเอกสารนี้', message, retry: false });
      else if (code === 'NOT_FOUND') setError({ title: 'ไม่พบเอกสาร', message, retry: false });
      else setError({ title: 'เปิดเอกสารไม่สำเร็จ', message, retry: true });
    });
  }, [api, token, bookingId]);
  useEffect(load, [load]);

  // สร้าง object URL ครั้งเดียวต่อไฟล์ และคืนหน่วยความจำเมื่อออกจากหน้า
  useEffect(() => {
    if (!file) return undefined;
    const next = attachmentObjectUrl(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);

  const back = <Link to="/approvals" className="inline-flex min-h-11 items-center gap-2 rounded-control px-3 font-medium text-brand hover:bg-brand-soft"><ArrowLeft className="size-4" aria-hidden="true" />รายการรออนุมัติ</Link>;

  if (error) {
    return (
      <>
        <PageHeader title="เอกสารแนบ" action={back} />
        <Card>{error.retry ? <ErrorState title={error.title} message={error.message} onRetry={load} /> : <ErrorState title={error.title} message={error.message} />}</Card>
      </>
    );
  }
  if (!file || !booking) {
    return (
      <>
        <PageHeader title="เอกสารแนบ" action={back} />
        <Card><LoadingState message="กำลังตรวจสิทธิ์และโหลดเอกสาร" /></Card>
      </>
    );
  }

  const Icon = attachmentIcon(file.mimeType);
  const preview = canPreview(file.mimeType);
  return (
    <>
      <PageHeader title="เอกสารแนบ" description={`ของคำขอ "${booking.title}"`} action={back} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <Card>
          <CardBody className="space-y-5">
            <div className="flex items-center gap-4">
              <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-card bg-brand-soft text-brand">
                <Icon className="size-7" />
              </span>
              <div className="min-w-0">
                <h2 className="break-words text-lg font-semibold text-ink">{file.name}</h2>
                <p className="text-sm text-ink-muted">{attachmentTypeLabel(file.mimeType)} · {formatFileSize(file.size)}</p>
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              {preview && url && (
                <a href={url} target="_blank" rel="noopener" className={`${actionClass} bg-brand-gradient text-ink-inverse shadow-brand hover:brightness-110`}>
                  <ExternalLink className="size-5" aria-hidden="true" />เปิดดูเอกสาร
                </a>
              )}
              {url && (
                <a href={url} download={file.name} className={`${actionClass} ${preview ? 'bg-surface text-ink ring-1 ring-line hover:bg-surface-sunken' : 'bg-brand-gradient text-ink-inverse shadow-brand hover:brightness-110'}`}>
                  <Download className="size-5" aria-hidden="true" />ดาวน์โหลด
                </a>
              )}
            </div>
            {!preview && <p className="text-sm text-ink-muted">ไฟล์ {attachmentTypeLabel(file.mimeType)} เปิดดูในเบราว์เซอร์ไม่ได้ ดาวน์โหลดแล้วเปิดด้วยแอปในเครื่อง</p>}
            {file.mimeType.startsWith('image/') && url && (
              <img src={url} alt={`ภาพตัวอย่างของ ${file.name}`} className="max-h-[70dvh] w-full rounded-control bg-surface-sunken object-contain ring-1 ring-line" />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-3 text-sm">
            <p className="font-medium text-ink">รายละเอียดการจอง</p>
            <p className="inline-flex rounded-pill bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand">{BOOKING_STATUS_LABEL_TH[booking.status]}</p>
            <Detail icon={CalendarDays}>{formatFullDate(booking.dateKey)}</Detail>
            <Detail icon={Clock3}>{formatTimeRange(booking.startMin, booking.endMin)} น.</Detail>
            <Detail icon={UserRound}>{booking.bookerName || booking.userName}{booking.department ? ` · ${booking.department}` : ''}</Detail>
            {(booking.customLocation || roomName) && <Detail icon={MapPin}>{booking.customLocation || roomName}</Detail>}
            <p className="flex gap-2 border-t border-line pt-3 text-xs text-ink-muted">
              <ShieldCheck className="size-4 shrink-0 text-ok" aria-hidden="true" />
              เอกสารนี้เปิดได้เฉพาะผู้จอง ผู้ลงนาม และผู้ดูแลระบบ ทุกครั้งที่เปิดมีบันทึกไว้ กรุณาอย่าส่งต่อไฟล์ให้ผู้ไม่เกี่ยวข้อง
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function Detail({ icon: Icon, children }: { icon: typeof CalendarDays; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2.5 text-ink">
      <Icon className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
