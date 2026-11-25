import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { CheckCircle2, CircleDashed, RefreshCw, Send, Trash2, UsersRound } from 'lucide-react';
import {
  LINE_TARGET_PATTERN, bookingLineMessage, isSafeSiteUrl, lineTargetKind, normalizeSiteUrl,
} from '@shared/domain/line-message';
import { toDateKey } from '@shared/time/bangkok';
import { useApp } from '../../app/providers/AppProvider';
import type { LineStatus } from '../../lib/api/types';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { cn } from '../../lib/cn';
import { FlexPreview } from './FlexPreview';

const inputClass = 'min-h-11 w-full rounded-control border border-line bg-surface px-3 text-base text-ink outline-none transition-colors duration-150 focus:border-brand focus:ring-2 focus:ring-brand/20';
const maskId = (id: string) => `${id.slice(0, 5)}…${id.slice(-4)}`;
const timeOf = (iso: string) => new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(iso));
const currentSiteUrl = () => normalizeSiteUrl(`${window.location.origin}${window.location.pathname}`);

/** ตั้งค่าแจ้งเตือน LINE (ผู้ดูแล) — 3 ขั้น: เชื่อมบัญชี LINE OA → เลือกกลุ่ม → ส่งทดสอบ */
export function LinePanel() {
  const { api, token, user } = useApp();
  const toast = useToast();
  const [status, setStatus] = useState<LineStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [manualId, setManualId] = useState('');
  const [siteUrl, setSiteUrl] = useState('');

  const load = useCallback(() => {
    setError('');
    return api.lineStatus(token).then((next) => { setStatus(next); setSiteUrl(next.siteUrl || currentSiteUrl()); }).catch((e: Error) => setError(e.message));
  }, [api, token]);
  useEffect(() => { void load(); }, [load]);

  const run = async (label: string, task: () => Promise<LineStatus>, done?: string) => {
    setBusy(label);
    try {
      const next = await task();
      setStatus(next);
      if (done) toast.success(done);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ทำรายการไม่สำเร็จ');
    } finally {
      setBusy('');
    }
  };
  const saveTargets = (targets: string[], done: string) => run('save', () => api.lineSave(token, targets, siteUrl), done);

  const sample = useMemo(() => bookingLineMessage({
    bookingId: 'ตัวอย่าง', title: 'ประชุมครูประจำแผนกวิชา ภาคเรียนที่ 2', bookerName: user?.displayName || 'นายสมชาย ใจดี',
    department: user?.department || 'แผนกวิชาช่างยนต์', roomName: 'ห้องประชุม 1 อาคารอำนวยการ', dateKey: toDateKey(new Date()),
    startMin: 9 * 60, endMin: 12 * 60, status: 'pending', approvalStep: 1,
    attachment: { name: 'บันทึกข้อความขอใช้ห้อง.pdf', mimeType: 'application/pdf', size: 245_000 },
    // ตัวอย่างเท่านั้น: เปิดจากเครื่องตัวเอง (http://localhost) ก็ยังเห็นปุ่มในการ์ดเหมือนของจริงบน https
  }, isSafeSiteUrl(normalizeSiteUrl(siteUrl)) ? siteUrl : currentSiteUrl().replace(/^http:/, 'https:')), [siteUrl, user]);

  if (error) return <Card><ErrorState message={error} onRetry={() => void load()} /></Card>;
  if (!status) return <Card><LoadingState message="กำลังโหลดการตั้งค่า LINE" /></Card>;

  const demo = status.demo === true;
  const capturing = status.captureUntil !== '' && new Date(status.captureUntil).getTime() > Date.now();
  const candidates = status.seen.filter((item) => !status.targets.includes(item.id));
  const addManual = (event: FormEvent) => {
    event.preventDefault();
    const id = manualId.trim();
    if (!LINE_TARGET_PATTERN.test(id)) { toast.error('รหัสไม่ถูกรูปแบบ — ขึ้นต้นด้วย U (ผู้ใช้) หรือ C (กลุ่ม) ตามด้วยตัวอักษร 32 ตัว'); return; }
    void saveTargets([...status.targets, id], `เพิ่ม${lineTargetKind(id)}แล้ว`).then(() => setManualId(''));
  };
  const sendTest = async () => {
    setBusy('test');
    try {
      const { result, status: next } = await api.lineTest(token);
      setStatus(next);
      if (result.skipped) toast.error(`ยังส่งไม่ได้: ${result.skipped}`);
      else if (result.failed) toast.error(`ส่งสำเร็จ ${result.sent} ไม่สำเร็จ ${result.failed} — ตรวจว่าบอทยังอยู่ในกลุ่ม และโทเคนถูกต้อง`);
      else toast.success(`ส่งข้อความทดสอบแล้ว ${result.sent} ปลายทาง ลองเปิด LINE ดู`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'ส่งไม่สำเร็จ');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      <div className="space-y-4">
        {demo && (
          <Alert tone="info" title="โหมดทดลองในเบราว์เซอร์ยังส่ง LINE ไม่ได้">
            โทเคนของ LINE ต้องเก็บไว้ฝั่ง Apps Script เท่านั้น เมื่อติดตั้ง Apps Script แล้วหน้านี้จะใช้ได้ทั้ง 3 ขั้น ระหว่างนี้ดูหน้าตาการ์ดได้ในส่วน "ตัวอย่างข้อความ"
          </Alert>
        )}

        <Step n={1} done={status.hasToken} title="เชื่อมบัญชี LINE Official Account">
          {status.hasToken ? (
            <p className="text-sm text-ink-muted">มีโทเคนแล้ว (ระบบไม่แสดงโทเคนในหน้าเว็บ)</p>
          ) : (
            <p className="text-sm text-ink-muted">
              ผู้ติดตั้งสร้าง Messaging API channel ใน LINE Developers แล้วนำ Channel access token ไปใส่ที่ Apps Script
              {' > '}Project Settings{' > '}Script Properties ชื่อ <code className="rounded bg-surface-sunken px-1 text-xs">LINE_CHANNEL_ACCESS_TOKEN</code>
              {' '}(ขั้นตอนเต็มอยู่ในคู่มือ docs/03-แจ้งเตือน-LINE.md)
            </p>
          )}
        </Step>

        <Step n={2} done={status.targets.length > 0} title="เลือกกลุ่ม LINE ที่จะรับแจ้งเตือน">
          {status.targets.length > 0 ? (
            <ul className="mb-3 space-y-2">
              {status.targets.map((id) => (
                <li key={id} className="flex min-h-12 items-center gap-3 rounded-control border border-line px-3">
                  <UsersRound className="size-4 shrink-0 text-ok" aria-hidden="true" />
                  <span className="min-w-0 flex-1 text-sm"><span className="font-medium text-ink">{lineTargetKind(id)}</span> <span className="font-mono text-ink-muted">{maskId(id)}</span></span>
                  <button type="button" disabled={demo || busy !== ''} onClick={() => void saveTargets(status.targets.filter((item) => item !== id), 'เอาออกแล้ว')}
                    aria-label={`เอา${lineTargetKind(id)} ${maskId(id)} ออก`} className="grid size-10 place-items-center rounded-control text-ink-muted hover:bg-danger-soft hover:text-danger disabled:opacity-50">
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-sm text-ink-muted">ยังไม่มีผู้รับ — เชิญบอทของ LINE OA เข้ากลุ่มผู้อนุมัติก่อน แล้วกดปุ่มด้านล่าง</p>
          )}

          {capturing ? (
            <div className="rounded-control bg-brand-soft/60 p-3 text-sm text-ink">
              <p className="font-medium">กำลังรอข้อความจากกลุ่ม ถึง {timeOf(status.captureUntil)}</p>
              <p className="mt-0.5 text-ink-muted">พิมพ์อะไรก็ได้ในกลุ่ม LINE ที่มีบอทอยู่ (บอทจะตอบว่าเห็นแล้ว) จากนั้นกด “ดูรหัสล่าสุด”</p>
              <Button className="mt-2" variant="secondary" size="sm" icon={<RefreshCw className="size-4" aria-hidden="true" />} loading={busy === 'refresh'}
                onClick={() => void run('refresh', () => api.lineStatus(token))}>ดูรหัสล่าสุด</Button>
            </div>
          ) : (
            <Button variant="secondary" disabled={demo || !status.hasToken} loading={busy === 'capture'} onClick={() => void run('capture', () => api.lineCapture(token))}>
              รับรหัสกลุ่ม (เปิด 10 นาที)
            </Button>
          )}

          {candidates.length > 0 && (
            <ul className="mt-3 space-y-2">
              {candidates.map((item) => (
                <li key={item.id} className="flex min-h-12 items-center gap-3 rounded-control border border-dashed border-brand-border px-3">
                  <span className="min-w-0 flex-1 text-sm"><span className="font-medium text-ink">{item.kind}</span> <span className="font-mono text-ink-muted">{maskId(item.id)}</span> <span className="text-xs text-ink-subtle">· {timeOf(item.at)}</span></span>
                  <Button size="sm" disabled={busy !== ''} onClick={() => void saveTargets([...status.targets, item.id], `เพิ่ม${item.kind}แล้ว เริ่มรับแจ้งเตือนทันที`)}>เลือก</Button>
                </li>
              ))}
            </ul>
          )}

          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-ink-muted hover:text-ink">มีรหัสอยู่แล้ว / ส่งหาตัวเองแทนกลุ่ม</summary>
            <form onSubmit={addManual} className="mt-2 flex gap-2">
              <label className="sr-only" htmlFor="line-manual-id">รหัสผู้รับ LINE</label>
              <input id="line-manual-id" className={cn(inputClass, 'font-mono text-sm')} value={manualId} onChange={(e) => setManualId(e.target.value)} placeholder="C… หรือ U… (Your user ID ในหน้า Basic settings)" disabled={demo} />
              <Button type="submit" variant="secondary" disabled={demo || manualId.trim() === ''} loading={busy === 'save'}>เพิ่ม</Button>
            </form>
          </details>
        </Step>

        <Step n={3} done={(status.last?.sent ?? 0) > 0 && (status.last?.failed ?? 0) === 0} title="ส่งข้อความทดสอบ">
          <div className="flex flex-wrap items-center gap-3">
            <Button icon={<Send className="size-4" aria-hidden="true" />} disabled={demo || !status.hasToken || status.targets.length === 0} loading={busy === 'test'} loadingLabel="กำลังส่ง" onClick={() => void sendTest()}>
              ส่งข้อความทดสอบ
            </Button>
            {status.last && (
              <p className={cn('text-sm', status.last.failed ? 'text-danger' : 'text-ink-muted')}>
                ส่งล่าสุด {timeOf(status.last.at)} · สำเร็จ {status.last.sent}{status.last.failed ? ` · ไม่สำเร็จ ${status.last.failed} (รหัส ${status.last.codes.filter((code) => code !== 200).join(', ')})` : ''}
              </p>
            )}
          </div>
          <div className="mt-4">
            <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="line-site-url">ที่อยู่หน้าเว็บสำหรับปุ่มในการ์ด</label>
            <div className="flex gap-2">
              <input id="line-site-url" className={cn(inputClass, 'text-sm')} value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} disabled={demo} inputMode="url" />
              <Button variant="secondary" disabled={demo || !isSafeSiteUrl(normalizeSiteUrl(siteUrl))} loading={busy === 'save'} onClick={() => void saveTargets(status.targets, 'บันทึกที่อยู่หน้าเว็บแล้ว')}>บันทึก</Button>
            </div>
            <p className="mt-1 text-xs text-ink-subtle">ปกติไม่ต้องแก้ ใช้ที่อยู่ของหน้านี้ (ต้องขึ้นต้นด้วย https://)</p>
          </div>
        </Step>
      </div>

      <aside className="space-y-2 lg:sticky lg:top-6">
        <p className="text-sm font-medium text-ink">ตัวอย่างข้อความที่ผู้อนุมัติจะได้รับ</p>
        <FlexPreview message={sample} />
        <p className="text-xs text-ink-muted">ส่งทุกครั้งที่มีการจองสำเร็จ ทั้งผู้ที่เข้าสู่ระบบและผู้จองทั่วไป ปุ่ม “เปิดเอกสารแนบ” ต้องเข้าสู่ระบบก่อน คนที่ได้ข้อความต่อมาโดยไม่มีบัญชีจึงเปิดไฟล์ไม่ได้</p>
      </aside>
    </div>
  );
}

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: ReactNode }) {
  return (
    <Card>
      <CardBody className="p-5">
        <h3 className="mb-3 flex items-center gap-2.5 text-base font-semibold text-ink">
          {done ? <CheckCircle2 className="size-5 shrink-0 text-ok" aria-hidden="true" /> : <CircleDashed className="size-5 shrink-0 text-ink-subtle" aria-hidden="true" />}
          <span>{n}. {title}</span>
          <span className="sr-only">{done ? '(เสร็จแล้ว)' : '(ยังไม่เสร็จ)'}</span>
        </h3>
        {children}
      </CardBody>
    </Card>
  );
}
