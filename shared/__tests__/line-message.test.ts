import { describe, expect, it } from 'vitest';
import {
  bookingLineMessage, isSafeSiteUrl, normalizeSiteUrl, parseLineTargets, siteLink, thaiLongDate, timeRangeThai,
  type LineBookingInfo,
} from '../domain/line-message';

const SITE = 'https://tctatc.github.io/nasakorn-thaluang-room-booking2/';
const base: LineBookingInfo = {
  bookingId: 'bk_abc123', title: 'ประชุมครูประจำแผนกวิชา', bookerName: 'นายสมชาย ใจดี', department: 'แผนกวิชาช่างยนต์',
  roomName: 'ห้องประชุม 1', dateKey: '2026-11-26', startMin: 9 * 60, endMin: 12 * 60, status: 'pending', approvalStep: 1,
  attachment: { name: 'บันทึกข้อความ.pdf', mimeType: 'application/pdf', size: 245_000 },
};

/** รวมข้อความทุกตัวในการ์ด เพื่อดูว่ามีข้อมูลครบ */
function allText(node: unknown): string {
  if (Array.isArray(node)) return node.map(allText).join('\n');
  if (node && typeof node === 'object') return Object.values(node).map(allText).join('\n');
  return typeof node === 'string' ? node : '';
}
function uris(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(uris);
  if (node && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    return [...(typeof record.uri === 'string' ? [record.uri] : []), ...Object.values(record).flatMap(uris)];
  }
  return [];
}

describe('วันที่และเวลาภาษาไทย', () => {
  it('วันที่เต็มเป็น พ.ศ.', () => {
    expect(thaiLongDate('2026-11-26')).toBe('วันพฤหัสบดีที่ 26 พฤศจิกายน 2569');
    expect(thaiLongDate('2027-01-03')).toBe('วันอาทิตย์ที่ 3 มกราคม 2570');
  });
  it('ช่วงเวลา', () => expect(timeRangeThai(540, 690)).toBe('09:00 - 11:30 น.'));
});

describe('การ์ดแจ้งการจอง', () => {
  it('มีข้อมูลครบ 5 อย่างที่กำหนด และไม่มีเบอร์โทร', () => {
    const message = bookingLineMessage(base, SITE);
    const text = allText(message.contents);
    expect(text).toContain('วันพฤหัสบดีที่ 26 พฤศจิกายน 2569');
    expect(text).toContain('09:00 - 12:00 น. (3 ชั่วโมง)');
    expect(text).toContain('นายสมชาย ใจดี');
    expect(text).toContain('ห้องประชุม 1');
    expect(text).toContain('บันทึกข้อความ.pdf (239 KB)');
    expect(text).toContain('รออนุมัติ · ขั้นที่ 1');
    expect(text).not.toMatch(/0\d{2}-?\d{3}-?\d{4}/);
  });

  it('ปุ่มเอกสารแนบชี้ไปหน้าที่ตรวจสิทธิ์ ไม่ใช่ไฟล์ตรง และเปิดในเบราว์เซอร์ของเครื่อง', () => {
    const links = uris(bookingLineMessage(base, SITE).contents);
    expect(links[0]).toBe(`${SITE}?openExternalBrowser=1#/attachment/bk_abc123`);
    expect(links[1]).toBe(`${SITE}?openExternalBrowser=1#/approvals`);
    expect(links.every((uri) => uri.startsWith('https://') && !uri.includes('drive.google'))).toBe(true);
  });

  it('ไม่มีไฟล์แนบ: บอกว่าไม่มี และไม่มีปุ่มเปิดไฟล์', () => {
    const message = bookingLineMessage({ ...base, attachment: null, status: 'confirmed', approvalStep: 0 }, SITE);
    expect(allText(message.contents)).toContain('ไม่มีเอกสารแนบ');
    expect(allText(message.contents)).toContain('ยืนยันแล้ว');
    expect(uris(message.contents)).toEqual([`${SITE}?openExternalBrowser=1#/calendar`]);
  });

  it('altText อ่านรู้เรื่องในบรรทัดเดียว ยาวไม่เกิน 400', () => {
    const message = bookingLineMessage(base, SITE);
    expect(message.altText).toBe('จองห้องประชุมสำเร็จ: ห้องประชุม 1 26 พ.ย. 69 09:00 - 12:00 น. โดย นายสมชาย ใจดี (มีเอกสารแนบ)');
    expect(bookingLineMessage({ ...base, roomName: 'ก'.repeat(1000), bookerName: 'ข'.repeat(1000) }, SITE).altText.length).toBeLessThanOrEqual(400);
  });

  it('ข้อความจากผู้จองถูกตัดอักขระควบคุมและความยาว', () => {
    const message = bookingLineMessage({ ...base, title: `หัวข้อ\u0000\u0007${'ก'.repeat(500)}` }, SITE);
    const title = (message.contents.body as { contents: { text: string }[] }).contents[0]!.text;
    expect(title).not.toMatch(/[\u0000-\u0008]/);
    expect(title.length).toBeLessThanOrEqual(160);
  });

  it('URL หน้าเว็บไม่ปลอดภัย = ไม่มีปุ่มลิงก์เลย', () => {
    expect(uris(bookingLineMessage(base, 'http://evil.example/').contents)).toEqual([]);
    expect(uris(bookingLineMessage(base, 'javascript:alert(1)').contents)).toEqual([]);
  });
});

describe('ค่าตั้ง LINE', () => {
  it('รับเฉพาะรหัสผู้รับที่ถูกรูปแบบ ไม่ซ้ำ', () => {
    const user = `U${'a'.repeat(32)}`;
    const group = `C${'0'.repeat(32)}`;
    expect(parseLineTargets(`${user}, ${group}\n${user} junk Uxyz`)).toEqual([user, group]);
  });
  it('URL หน้าเว็บ', () => {
    expect(isSafeSiteUrl(SITE)).toBe(true);
    expect(isSafeSiteUrl('http://a.b/')).toBe(false);
    expect(normalizeSiteUrl('https://a.b/x/?demo=1#/track')).toBe('https://a.b/x/');
    expect(siteLink('https://a.b/x', '/calendar')).toBe('https://a.b/x/?openExternalBrowser=1#/calendar');
  });
});
