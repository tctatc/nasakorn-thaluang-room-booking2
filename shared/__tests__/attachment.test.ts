import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_LOCAL_MAX_BYTES, attachmentMetaFromRow, base64ByteLength, base64Head, cleanAttachmentName, formatFileSize,
  sniffAttachmentKind, validateAttachmentUpload,
} from '../schemas/attachment';

const b64 = (bytes: number[]) => Buffer.from(Uint8Array.from(bytes)).toString('base64');
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];
const ZIP = [0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0];
const EXE = [0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0];

describe('ชื่อไฟล์แนบ', () => {
  it('ตัด path และอักขระต้องห้ามออก', () => {
    expect(cleanAttachmentName('../../etc/passwd')).toBe('passwd');
    expect(cleanAttachmentName('C:\\Users\\a\\บันทึกข้อความ.pdf')).toBe('บันทึกข้อความ.pdf');
    expect(cleanAttachmentName('a<b>:"c|?*.pdf')).toBe('abc.pdf');
    expect(cleanAttachmentName('...hidden.pdf')).toBe('hidden.pdf');
  });
  it('ชื่อยาวถูกตัดแต่ยังคงนามสกุล', () => {
    const name = cleanAttachmentName(`${'ก'.repeat(300)}.docx`);
    expect(name.length).toBe(120);
    expect(name.endsWith('.docx')).toBe(true);
  });
});

describe('base64', () => {
  it('ถอดหัวไฟล์ได้ตรงกับ Buffer', () => {
    expect(base64Head(b64(PNG))).toEqual(PNG.slice(0, 8));
    expect(base64Head(b64([1, 2]), 8)).toEqual([1, 2]);
  });
  it('คำนวณขนาดจริงรวม padding', () => {
    for (const n of [1, 2, 3, 4, 5, 1000]) expect(base64ByteLength(b64(new Array(n).fill(7)))).toBe(n);
  });
});

describe('ตรวจชนิดไฟล์จากเนื้อไฟล์', () => {
  it('รับเมื่อเนื้อไฟล์ตรงกับนามสกุล', () => {
    expect(sniffAttachmentKind(PDF, 'a.PDF')).toBe('pdf');
    expect(sniffAttachmentKind(PNG, 'a.png')).toBe('png');
    expect(sniffAttachmentKind([0xff, 0xd8, 0xff, 0xe0], 'a.jpeg')).toBe('jpg');
    expect(sniffAttachmentKind(ZIP, 'a.docx')).toBe('docx');
    expect(sniffAttachmentKind(ZIP, 'a.xlsx')).toBe('xlsx');
  });
  it('ปฏิเสธไฟล์ที่เปลี่ยนนามสกุลหลอก หรือชนิดที่ไม่รับ', () => {
    expect(sniffAttachmentKind(EXE, 'memo.pdf')).toBeNull();
    expect(sniffAttachmentKind(PDF, 'memo.png')).toBeNull();
    expect(sniffAttachmentKind(ZIP, 'archive.zip')).toBeNull();
    expect(sniffAttachmentKind(PDF, 'memo.html')).toBeNull();
    expect(sniffAttachmentKind(PDF, 'memo')).toBeNull();
  });
});

describe('validateAttachmentUpload', () => {
  it('ไม่ส่งไฟล์มา = ไม่มีเอกสารแนบ', () => {
    expect(validateAttachmentUpload(undefined)).toEqual({ ok: true, value: null });
    expect(validateAttachmentUpload(null)).toEqual({ ok: true, value: null });
  });
  it('ไฟล์ถูกต้อง: ชนิด MIME มาจากเนื้อไฟล์ ไม่ใช่จากที่ส่งมา', () => {
    const result = validateAttachmentUpload({ name: 'บันทึก.pdf', mimeType: 'text/html', dataBase64: b64(PDF) });
    expect(result).toEqual({ ok: true, value: { name: 'บันทึก.pdf', mimeType: 'application/pdf', size: PDF.length, kind: 'pdf', dataBase64: b64(PDF) } });
  });
  it('ปฏิเสธไฟล์อันตราย base64 เสีย หรือใหญ่เกิน', () => {
    expect(validateAttachmentUpload({ name: 'x.pdf', dataBase64: b64(EXE) }).ok).toBe(false);
    expect(validateAttachmentUpload({ name: 'x.pdf', dataBase64: 'not base64!' }).ok).toBe(false);
    expect(validateAttachmentUpload({ name: '', dataBase64: b64(PDF) }).ok).toBe(false);
    const big = b64([...PDF, ...new Array(ATTACHMENT_LOCAL_MAX_BYTES).fill(0)]);
    const result = validateAttachmentUpload({ name: 'big.pdf', dataBase64: big }, ATTACHMENT_LOCAL_MAX_BYTES);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.message).toContain('1 MB');
  });
});

describe('อื่น ๆ', () => {
  it('formatFileSize อ่านง่าย', () => {
    expect(formatFileSize(500)).toBe('500 ไบต์');
    expect(formatFileSize(245_000)).toBe('239 KB');
    expect(formatFileSize(1_300_000)).toBe('1.2 MB');
  });
  it('อ่านข้อมูลไฟล์จากแถว โดยไม่ส่งรหัส Drive ออกไป', () => {
    expect(attachmentMetaFromRow({ attachmentFileId: 'drive-id', attachmentName: 'a.pdf', attachmentMime: 'application/pdf', attachmentSize: 12 }))
      .toEqual({ name: 'a.pdf', mimeType: 'application/pdf', size: 12 });
    expect(attachmentMetaFromRow({ attachmentName: 'a.pdf' })).toBeNull();
    expect(attachmentMetaFromRow({})).toBeNull();
  });
});
