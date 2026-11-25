/**
 * ข้อความแจ้งเตือน LINE เมื่อมีการจองห้องสำเร็จ (LINE Messaging API แบบ Flex Message)
 *
 * อยู่ใน shared เพื่อให้ Apps Script (ส่งจริง) และหน้าเว็บ (ตัวอย่างในหน้าตั้งค่า) ใช้โครงเดียวกันทุกตัวอักษร
 * Flex Message แสดงเป็นการ์ดเหมือนกันทั้ง LINE มือถือและ LINE บนคอมพิวเตอร์
 * เครื่องที่แสดงการ์ดไม่ได้ (เช่น แจ้งเตือนบนหน้าจอล็อก) จะเห็น altText แทน จึงต้องอ่านรู้เรื่องในบรรทัดเดียว
 *
 * ข้อมูลในการ์ดเลือกเฉพาะที่ผู้อนุมัติต้องใช้ ไม่ใส่เบอร์โทรของผู้จอง (กลุ่ม LINE ส่งต่อกันได้ง่าย)
 */

import { APPROVAL_STEPS } from './approval';
import { BOOKING_STATUS_LABEL_TH, type BookingStatus } from './status';
import { dayOfWeekOfDateKey } from '../time/bangkok';
import { formatFileSize, type AttachmentMeta } from '../schemas/attachment';

const THAI_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** "วันพฤหัสบดีที่ 26 พฤศจิกายน 2569" — เขียนเองไม่พึ่ง Intl เพราะ Apps Script มีข้อมูลภาษาไทยไม่ครบ */
export function thaiLongDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return `วัน${THAI_DAYS[dayOfWeekOfDateKey(dateKey)]}ที่ ${day} ${THAI_MONTHS[month! - 1]} ${year! + 543}`;
}

/** "26 พ.ย. 69" */
export function thaiShortDate(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return `${day} ${THAI_MONTHS_SHORT[month! - 1]} ${String(year! + 543).slice(-2)}`;
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export function durationThai(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours ? `${hours} ชั่วโมง` : '', rest ? `${rest} นาที` : ''].filter(Boolean).join(' ');
}

/** "09:00 - 12:00 น." */
export function timeRangeThai(startMin: number, endMin: number): string {
  return `${hhmm(startMin)} - ${hhmm(endMin)} น.`;
}

/** URL ของหน้าเว็บต้องเป็น https (LINE ไม่รับลิงก์ http ในปุ่ม) และไม่มีส่วน # */
export function isSafeSiteUrl(url: string): boolean {
  return /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(\/[A-Za-z0-9._~%!$&'()*+,;=:@/-]*)?$/.test(url) && url.length <= 300;
}

/** ตัดให้เหลือ origin + path ลงท้ายด้วย / (หน้าเว็บใช้ HashRouter) */
export function normalizeSiteUrl(url: string): string {
  const base = url.split('#')[0]!.split('?')[0]!;
  return base.endsWith('/') ? base : `${base}/`;
}

/**
 * ลิงก์ในแอป LINE: openExternalBrowser=1 ให้เปิดในเบราว์เซอร์ของเครื่อง (ที่อาจเข้าสู่ระบบค้างไว้แล้ว)
 * แทนเบราว์เซอร์ในแอป LINE ที่ต้องเข้าสู่ระบบใหม่ทุกครั้ง
 */
export function siteLink(siteUrl: string, hashPath: string): string {
  return `${normalizeSiteUrl(siteUrl)}?openExternalBrowser=1#${hashPath}`;
}

/** หน้าเปิดเอกสารแนบ — ต้องเข้าสู่ระบบและมีสิทธิ์เห็นการจองนี้ก่อนจึงได้ไฟล์ */
export function attachmentPagePath(bookingId: string): string {
  return `/attachment/${encodeURIComponent(bookingId)}`;
}

/** รหัสผู้รับของ LINE: U = ผู้ใช้, C = กลุ่ม, R = ห้องแชต ตามด้วยเลขฐาน 16 อีก 32 ตัว */
export const LINE_TARGET_PATTERN = /^[UCR][0-9a-f]{32}$/;

export function parseLineTargets(raw: string): string[] {
  const ids = raw.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
  return ids.filter((id, index) => LINE_TARGET_PATTERN.test(id) && ids.indexOf(id) === index);
}

export function lineTargetKind(id: string): string {
  return id.startsWith('C') ? 'กลุ่ม' : id.startsWith('R') ? 'ห้องแชต' : 'ผู้ใช้';
}

export interface LineBookingInfo {
  bookingId: string;
  title: string;
  bookerName: string;
  department: string;
  /** ชื่อห้อง หรือสถานที่ที่ผู้จองระบุเอง (ห้อง "อื่น ๆ") */
  roomName: string;
  dateKey: string;
  startMin: number;
  endMin: number;
  status: BookingStatus;
  approvalStep: number;
  attachment: AttachmentMeta | null;
}

/** ตัดอักขระควบคุมและความยาว — ข้อความมาจากผู้จอง (คนทั่วไปก็จองได้) */
function clean(text: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  const single = String(text ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single || '-';
}

function statusLine(info: LineBookingInfo): { text: string; color: string } {
  if (info.status === 'pending') {
    const step = APPROVAL_STEPS[Math.min(Math.max(info.approvalStep, 1), APPROVAL_STEPS.length) - 1]!;
    return { text: `รออนุมัติ · ขั้นที่ ${step.step} ${step.waiting}`, color: '#FDE68A' };
  }
  return { text: BOOKING_STATUS_LABEL_TH[info.status], color: '#BBF7D0' };
}

type FlexNode = Record<string, unknown>;

function row(label: string, value: string, options: { bold?: boolean; color?: string } = {}): FlexNode {
  return {
    type: 'box', layout: 'baseline', spacing: 'md',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#6B7280', flex: 2 },
      { type: 'text', text: value, size: 'sm', color: options.color ?? '#111827', weight: options.bold ? 'bold' : 'regular', flex: 5, wrap: true },
    ],
  };
}

export interface LineMessage {
  type: 'flex';
  altText: string;
  contents: FlexNode;
}

/** การ์ดแจ้งการจองใหม่ — siteUrl คือที่อยู่หน้าเว็บ (https) ใช้ทำปุ่มลิงก์ */
export function bookingLineMessage(info: LineBookingInfo, siteUrl: string): LineMessage {
  const status = statusLine(info);
  const date = thaiLongDate(info.dateKey);
  const time = timeRangeThai(info.startMin, info.endMin);
  const booker = clean(info.bookerName, 80);
  const room = clean(info.roomName, 80);
  const canLink = isSafeSiteUrl(normalizeSiteUrl(siteUrl));

  const body: FlexNode[] = [
    { type: 'text', text: clean(info.title, 160), weight: 'bold', size: 'lg', wrap: true, color: '#111827' },
    { type: 'separator', margin: 'lg' },
    {
      type: 'box', layout: 'vertical', spacing: 'md', margin: 'lg',
      contents: [
        row('วันที่', date, { bold: true }),
        row('เวลา', `${time} (${durationThai(info.endMin - info.startMin)})`, { bold: true }),
        row('ผู้จอง', info.department ? `${booker}\n${clean(info.department, 80)}` : booker),
        row('ห้อง', room),
        row('เอกสาร', info.attachment
          ? `${clean(info.attachment.name, 80)} (${formatFileSize(info.attachment.size)})`
          : 'ไม่มีเอกสารแนบ', { color: info.attachment ? '#1E3A8A' : '#9CA3AF' }),
      ],
    },
  ];

  const buttons: FlexNode[] = [];
  if (canLink && info.attachment) {
    buttons.push({
      type: 'button', style: 'primary', color: '#1E3A8A', height: 'sm',
      action: { type: 'uri', label: 'เปิดเอกสารแนบ', uri: siteLink(siteUrl, attachmentPagePath(info.bookingId)) },
    });
  }
  if (canLink) {
    buttons.push({
      type: 'button', style: info.attachment ? 'secondary' : 'primary', color: info.attachment ? undefined : '#1E3A8A', height: 'sm',
      action: { type: 'uri', label: info.status === 'pending' ? 'ดูคำขอรออนุมัติ' : 'ดูปฏิทินการจอง', uri: siteLink(siteUrl, info.status === 'pending' ? '/approvals' : '/calendar') },
    });
  }
  const footerNote = info.attachment && canLink ? 'เปิดเอกสารได้เฉพาะผู้มีสิทธิ์ ต้องเข้าสู่ระบบก่อน' : '';

  const altText = `จองห้องประชุมสำเร็จ: ${room} ${thaiShortDate(info.dateKey)} ${time} โดย ${booker}${info.attachment ? ' (มีเอกสารแนบ)' : ''}`;
  return {
    type: 'flex',
    altText: altText.length > 400 ? `${altText.slice(0, 399)}…` : altText,
    contents: {
      type: 'bubble', size: 'mega',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#1E3A8A', paddingAll: 'lg', spacing: 'xs',
        contents: [
          { type: 'text', text: 'จองห้องประชุมสำเร็จ', color: '#FFFFFF', weight: 'bold', size: 'md' },
          { type: 'text', text: status.text, color: status.color, size: 'sm', wrap: true },
        ],
      },
      body: { type: 'box', layout: 'vertical', paddingAll: 'lg', contents: body },
      ...(buttons.length ? {
        footer: {
          type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: 'lg',
          contents: [
            ...buttons.map((button) => JSON.parse(JSON.stringify(button)) as FlexNode),
            ...(footerNote ? [{ type: 'text', text: footerNote, size: 'xxs', color: '#9CA3AF', align: 'center', wrap: true, margin: 'sm' }] : []),
          ],
        },
      } : {}),
    },
  };
}
