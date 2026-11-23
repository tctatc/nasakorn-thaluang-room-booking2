import { useMemo } from 'react';
import { Download } from 'lucide-react';
import { encode } from 'uqr';
import { cn } from '../../lib/cn';

/** ตาราง QR (true = จุดดำ) พร้อมขอบขาวรอบ ๆ ที่เครื่องสแกนต้องใช้ */
function qrMatrix(value: string): boolean[][] {
  return encode(value, { ecc: 'M', border: 2 }).data;
}

/** วาดเป็น path เดียว — คมชัดทุกขนาด พิมพ์ออกมาก็ยังสแกนได้ */
function qrPath(matrix: boolean[][]): string {
  let path = '';
  matrix.forEach((row, y) => row.forEach((dark, x) => { if (dark) path += `M${x} ${y}h1v1h-1z`; }));
  return path;
}

/** บันทึกเป็นไฟล์ PNG ขนาดพอพิมพ์ (ใช้ canvas จึงไม่ต้องมีเซิร์ฟเวอร์) */
export function downloadQrPng(value: string, fileLabel: string, pixels = 720): void {
  const matrix = qrMatrix(value);
  const canvas = document.createElement('canvas');
  canvas.width = pixels;
  canvas.height = pixels;
  const context = canvas.getContext('2d');
  if (!context) return;
  const cell = pixels / matrix.length;
  context.fillStyle = '#fff';
  context.fillRect(0, 0, pixels, pixels);
  context.fillStyle = '#000';
  matrix.forEach((row, y) => row.forEach((dark, x) => { if (dark) context.fillRect(x * cell, y * cell, Math.ceil(cell), Math.ceil(cell)); }));
  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = `${fileLabel.replace(/[\\/:*?"<>|]/g, '-')}.png`;
  document.body.append(link);
  link.click();
  link.remove();
}

/**
 * QR Code สีดำบนพื้นขาวเสมอ (แม้โหมดมืด) — สีกลับด้านบางเครื่องสแกนไม่ได้
 * label เป็นคำอธิบายให้โปรแกรมอ่านหน้าจอ เช่น "QR Code สำหรับติดตามสถานะคำขอ"
 */
export function QrCode({ value, label, className, downloadName }: {
  value: string; label: string; className?: string; downloadName?: string;
}) {
  const matrix = useMemo(() => qrMatrix(value), [value]);
  const path = useMemo(() => qrPath(matrix), [matrix]);
  return (
    <figure className={cn('flex flex-col items-center gap-3', className)}>
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${matrix.length} ${matrix.length}`}
        shapeRendering="crispEdges"
        className="aspect-square w-full max-w-[15rem] rounded-xl bg-white p-1 ring-1 ring-line"
      >
        <path d={path} fill="#000" />
      </svg>
      {downloadName && (
        <button
          type="button"
          onClick={() => downloadQrPng(value, downloadName)}
          className="no-print inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-sm font-medium text-brand ring-1 ring-brand-border transition-colors duration-150 hover:bg-brand-soft"
        >
          <Download className="size-4" aria-hidden="true" />บันทึกรูป QR
        </button>
      )}
    </figure>
  );
}
