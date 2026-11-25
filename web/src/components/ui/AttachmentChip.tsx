import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, FileImage, FileSpreadsheet, FileText, type LucideIcon } from 'lucide-react';
import { formatFileSize, type AttachmentFile, type AttachmentMeta } from '@shared/schemas/attachment';
import { downloadAttachment } from '../../lib/attachment';
import { Spinner } from './Spinner';

export function attachmentIcon(mimeType: string): LucideIcon {
  if (mimeType.startsWith('image/')) return FileImage;
  if (mimeType.includes('spreadsheet')) return FileSpreadsheet;
  return FileText;
}

export function attachmentTypeLabel(mimeType: string): string {
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType.startsWith('image/')) return 'รูปภาพ';
  if (mimeType.includes('spreadsheet')) return 'Excel';
  if (mimeType.includes('wordprocessing')) return 'Word';
  return 'ไฟล์';
}

/**
 * แถวเอกสารแนบ — to: ไปหน้าเปิดเอกสาร (ผู้ใช้ที่เข้าสู่ระบบ) / load: โหลดแล้วดาวน์โหลดทันที (ผู้จองที่ถือรหัสติดตาม)
 */
export function AttachmentChip({ meta, to, load }: { meta: AttachmentMeta; to?: string; load?: () => Promise<AttachmentFile> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const Icon = attachmentIcon(meta.mimeType);
  const body = (
    <>
      <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-control bg-brand-soft text-brand">
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-medium text-ink">{meta.name}</span>
        <span className="block text-xs text-ink-muted">{attachmentTypeLabel(meta.mimeType)} · {formatFileSize(meta.size)}</span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-brand">
        {busy ? <Spinner size="sm" /> : <Download className="size-4" aria-hidden="true" />}
        {to ? 'เปิด' : busy ? 'กำลังโหลด' : 'ดาวน์โหลด'}
      </span>
    </>
  );
  const className = 'flex min-h-14 w-full items-center gap-3 rounded-control border border-line bg-surface px-3 py-2 transition-colors duration-150 hover:border-brand-border hover:bg-brand-soft/40';

  if (to) return <Link to={to} className={className}>{body}</Link>;
  const start = async () => {
    if (!load || busy) return;
    setBusy(true);
    setError('');
    try {
      downloadAttachment(await load());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เปิดเอกสารไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <button type="button" onClick={() => void start()} disabled={busy} aria-busy={busy || undefined} className={className}>{body}</button>
      {error && <p role="alert" className="mt-1.5 text-sm text-danger">{error}</p>}
    </div>
  );
}
