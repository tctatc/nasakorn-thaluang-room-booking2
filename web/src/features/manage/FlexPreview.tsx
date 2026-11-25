import type { CSSProperties, ReactNode } from 'react';
import type { LineMessage } from '@shared/domain/line-message';

/**
 * แสดงการ์ด Flex Message แบบประมาณให้ผู้ดูแลเห็นหน้าตาก่อนส่งจริง
 * รองรับเฉพาะชนิดที่ bookingLineMessage ใช้ (box / text / separator / button) — ข้อมูลมาจากตัวสร้างข้อความตัวเดียวกับที่ server ส่ง
 */

type Node = Record<string, unknown>;

const SIZE: Record<string, string> = { xxs: '11px', xs: '12px', sm: '14px', md: '15px', lg: '18px', xl: '20px' };
const SPACE: Record<string, string> = { none: '0', xs: '2px', sm: '4px', md: '8px', lg: '12px', xl: '16px' };

function render(node: Node, key: number, parentLayout = 'vertical'): ReactNode {
  const margin = typeof node.margin === 'string' ? SPACE[node.margin] : undefined;
  if (node.type === 'box') {
    const layout = String(node.layout ?? 'vertical');
    const style: CSSProperties = {
      display: 'flex', flexDirection: layout === 'vertical' ? 'column' : 'row', alignItems: layout === 'baseline' ? 'baseline' : undefined,
      gap: SPACE[String(node.spacing ?? 'none')], marginTop: margin, background: node.backgroundColor as string | undefined,
      padding: typeof node.paddingAll === 'string' ? `${parseInt(SPACE[node.paddingAll] ?? '0', 10) + 4}px` : undefined,
    };
    return <div key={key} style={style}>{(node.contents as Node[]).map((child, index) => render(child, index, layout))}</div>;
  }
  if (node.type === 'text') {
    const style: CSSProperties = {
      fontSize: SIZE[String(node.size ?? 'md')], fontWeight: node.weight === 'bold' ? 600 : 400, color: node.color as string | undefined,
      flex: parentLayout === 'vertical' ? undefined : Number(node.flex ?? 1), whiteSpace: node.wrap ? 'pre-wrap' : 'nowrap',
      overflow: node.wrap ? undefined : 'hidden', textOverflow: node.wrap ? undefined : 'ellipsis', textAlign: node.align as CSSProperties['textAlign'],
      marginTop: margin, minWidth: 0, lineHeight: 1.45,
    };
    return <span key={key} style={style}>{String(node.text)}</span>;
  }
  if (node.type === 'separator') return <hr key={key} style={{ marginTop: margin, borderColor: '#E5E7EB' }} />;
  if (node.type === 'button') {
    const primary = node.style === 'primary';
    return (
      <span key={key} style={{ display: 'block', borderRadius: 8, padding: '9px 12px', textAlign: 'center', fontSize: 14, fontWeight: 600,
        background: primary ? String(node.color ?? '#06C755') : '#F3F4F6', color: primary ? '#fff' : '#111827' }}>
        {String((node.action as Node).label)}
      </span>
    );
  }
  return null;
}

export function FlexPreview({ message }: { message: LineMessage }) {
  const bubble = message.contents;
  return (
    <div className="rounded-card bg-[#8CABD9] p-4 sm:p-6" aria-label="ตัวอย่างข้อความใน LINE">
      <div className="mx-auto w-full max-w-[300px] overflow-hidden rounded-[18px] bg-white text-left shadow-raised">
        {['header', 'body', 'footer'].map((part, index) => (bubble[part] ? render(bubble[part] as Node, index) : null))}
      </div>
      <p className="mx-auto mt-3 max-w-[300px] rounded-control bg-black/25 px-3 py-2 text-xs text-white">
        แจ้งเตือนบนหน้าจอล็อก: {message.altText}
      </p>
    </div>
  );
}
