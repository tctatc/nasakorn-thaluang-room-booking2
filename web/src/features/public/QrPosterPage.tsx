import { Printer } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { QrCode } from '../../components/ui/QrCode';

/** ลิงก์หน้าจอง (ใช้ใน QR ติดหน้าห้อง) */
export function bookingUrl(): string {
  return `${window.location.origin}${window.location.pathname}#/book`;
}

/** โปสเตอร์ QR สำหรับพิมพ์ติดหน้าห้องประชุม — สแกนแล้วเปิดหน้าจองได้ทันที */
export function QrPosterPage() {
  const url = bookingUrl();
  return (
    <div className="mx-auto max-w-xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">QR Code สำหรับจองห้อง</h1>
          <p className="text-base text-ink-muted">พิมพ์ติดหน้าห้องประชุมหรือบอร์ดประชาสัมพันธ์</p>
        </div>
        <Button icon={<Printer className="size-5" aria-hidden="true" />} onClick={() => window.print()}>พิมพ์โปสเตอร์</Button>
      </div>
      <article className="print-sheet rounded-card bg-white p-8 text-center text-black shadow-card print:shadow-none">
        <img src={`${import.meta.env.BASE_URL}college-logo.png`} alt="" className="mx-auto h-20 w-20" />
        <p className="mt-3 text-2xl font-bold">สแกนเพื่อจองห้องประชุม</p>
        <p className="mt-1 text-lg">วิทยาลัยเทคนิคท่าหลวงซิเมนต์ไทยอนุสรณ์</p>
        <QrCode value={url} label="QR Code เปิดหน้าจองห้องประชุม" className="mx-auto mt-6 [&_svg]:max-w-[18rem] [&_svg]:ring-0" downloadName="QR จองห้องประชุม" />
        <p className="mt-4 text-base">ไม่ต้องเข้าสู่ระบบ · กรอกชื่อและเบอร์โทร · ติดตามผลด้วยรหัสหรือ QR</p>
        <p className="mt-2 break-all text-sm text-ink-muted">{url}</p>
      </article>
    </div>
  );
}
