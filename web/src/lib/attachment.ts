/** อ่าน/เปิดเอกสารแนบฝั่งเบราว์เซอร์ */

import { ATTACHMENT_MIME, type AttachmentFile } from '@shared/schemas/attachment';

/** อ่านไฟล์ที่ผู้ใช้เลือกเป็น base64 (ไม่มีส่วนหัว data:) */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('อ่านไฟล์ไม่ได้ กรุณาเลือกไฟล์ใหม่'));
    reader.readAsDataURL(file);
  });
}

/** แปลงไฟล์ที่ได้จาก API เป็น object URL — ผู้เรียกต้อง URL.revokeObjectURL เมื่อเลิกใช้ */
export function attachmentObjectUrl(file: AttachmentFile): string {
  const binary = atob(file.dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  // blob: URL อยู่ใน origin เดียวกับหน้าเว็บ — ห้ามเป็นชนิดที่รันสคริปต์ได้ (เช่น text/html, image/svg+xml)
  // จึงรับเฉพาะชนิดในรายการที่อนุญาต นอกนั้นให้เบราว์เซอร์ถือเป็นไฟล์ดาวน์โหลดเท่านั้น
  const safeType = Object.values(ATTACHMENT_MIME).includes(file.mimeType) ? file.mimeType : 'application/octet-stream';
  return URL.createObjectURL(new Blob([bytes], { type: safeType }));
}

/** ดาวน์โหลดทันที (ใช้หลังโหลดไฟล์จาก API เสร็จ) */
export function downloadAttachment(file: AttachmentFile): void {
  const url = attachmentObjectUrl(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** เปิดดูในเบราว์เซอร์ได้เลยไหม (PDF และรูป) — Word/Excel ต้องดาวน์โหลด */
export const canPreview = (mimeType: string) => mimeType === 'application/pdf' || mimeType.startsWith('image/');
