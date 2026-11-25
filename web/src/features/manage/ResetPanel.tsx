import { useState, type FormEvent } from 'react';
import { DatabaseBackup, Trash2 } from 'lucide-react';
import { RESET_CONFIRM_PHRASE } from '@shared/domain/admin-booking';
import { useApp } from '../../app/providers/AppProvider';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, CardBody } from '../../components/ui/Card';

/**
 * ล้างการจองทั้งหมดเพื่อเริ่มบันทึกจริง — ห้อง ผู้ใช้ ค่าตั้งค่า และรายการตั้งต้นอยู่ครบ
 * ต้องพิมพ์คำยืนยันให้ตรง และ server สำรองชีตไว้ก่อนล้างทุกครั้ง
 */
export function ResetPanel() {
  const { api, token } = useApp();
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ backups: string[]; cleared: Record<string, number> } | null>(null);
  const ready = phrase.trim() === RESET_CONFIRM_PHRASE;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      setResult(await api.adminResetBookings(token, phrase.trim()));
      setPhrase('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ล้างข้อมูลไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-4">
      {result && (
        <Alert tone="ok" title="ล้างข้อมูลเรียบร้อย เริ่มบันทึกใหม่ได้เลย">
          ลบคำขอ {result.cleared.Bookings ?? 0} รายการ และรีวิว {result.cleared.Reviews ?? 0} รายการ
          {result.backups.length > 0 && <> · สำรองไว้ที่: {result.backups.join(', ')}</>}
        </Alert>
      )}
      <Card>
        <CardBody className="space-y-4 p-5">
          <div>
            <h2 className="text-lg font-semibold text-ink">ล้างข้อมูลการจองทั้งหมด</h2>
            <p className="mt-1 text-base text-ink-muted">ใช้ครั้งเดียวก่อนเริ่มใช้งานจริง ตัวเลขในหน้าภาพรวม ปฏิทิน และรายงานจะกลับเป็น 0</p>
          </div>
          <ul className="space-y-1.5 text-sm text-ink">
            <li><span className="font-medium text-danger">ลบ:</span> คำขอจองทุกสถานะ และรีวิวห้อง</li>
            <li><span className="font-medium text-ok">คงไว้:</span> ห้องประชุม บัญชีผู้ใช้และ PIN ค่าตั้งค่า รายการตัวเลือก และประวัติการใช้งาน (AuditLogs)</li>
          </ul>
          <p className="flex items-start gap-2 rounded-xl bg-surface-sunken px-3 py-2.5 text-sm text-ink-muted">
            <DatabaseBackup className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>ระบบคัดลอกข้อมูลเดิมไว้ในชีตซ่อนชื่อ "สำรอง Bookings วันที่ เวลา" ก่อนล้าง ถ้ากดพลาด คัดลอกแถวจากชีตนั้นกลับมาได้</span>
          </p>
          <form onSubmit={submit} className="space-y-3">
            {error && <Alert tone="danger" title="ล้างข้อมูลไม่สำเร็จ"><span role="alert">{error}</span></Alert>}
            <div>
              <label htmlFor="reset-phrase" className="mb-1.5 block text-sm font-medium text-ink">พิมพ์คำว่า <span className="font-semibold text-danger">{RESET_CONFIRM_PHRASE}</span> เพื่อยืนยัน</label>
              <input
                id="reset-phrase" autoComplete="off" value={phrase} onChange={(e) => setPhrase(e.target.value)}
                className="min-h-11 w-full rounded-control border border-line bg-surface px-3 text-base text-ink outline-none transition-colors duration-150 focus:border-danger focus:ring-2 focus:ring-danger/20"
              />
            </div>
            <Button type="submit" variant="danger" disabled={!ready} loading={busy} loadingLabel="กำลังล้างข้อมูล" icon={<Trash2 className="size-4" aria-hidden="true" />}>
              ล้างข้อมูลการจองทั้งหมด
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
