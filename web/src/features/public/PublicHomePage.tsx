import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, Search } from 'lucide-react';
import { useApp, useSettings } from '../../app/providers/AppProvider';
import { Alert } from '../../components/ui/Alert';
import type { DemoRoom } from '../../lib/api/demo';
import { BOOKINGS_CHANGED_EVENT } from '../../lib/api/client';
import { RoomStatusNow } from '../dashboard/RoomStatusNow';
import { AvailabilityBoard } from '../schedule/AvailabilityBoard';

/** หน้าแรกของผู้จองทั่วไป: ปุ่มจอง → สถานะห้องตอนนี้ → ปฏิทินห้องว่างพร้อมตัวตรวจการจองซ้ำ */
export function PublicHomePage() {
  const { api } = useApp();
  const settings = useSettings();
  const [rooms, setRooms] = useState<DemoRoom[]>([]);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    api.rooms('').then((result) => setRooms(result.rooms)).catch((e: Error) => setError(e.message));
    const bump = () => setRefreshKey((key) => key + 1);
    window.addEventListener(BOOKINGS_CHANGED_EVENT, bump);
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') bump(); }, 30_000);
    return () => { window.removeEventListener(BOOKINGS_CHANGED_EVENT, bump); window.clearInterval(timer); };
  }, [api]);

  return <>
    <section className="enter relative mb-6 overflow-hidden rounded-[20px] bg-brand-gradient px-5 py-6 text-ink-inverse shadow-raised sm:px-7">
      <span aria-hidden="true" className="absolute -right-12 -top-20 size-64 rounded-full bg-white/10" />
      <div className="relative">
        <h1 className="text-2xl font-semibold leading-snug sm:text-3xl">จองห้องประชุมได้เลย ไม่ต้องเข้าสู่ระบบ</h1>
        <p className="mt-2 text-base text-white/90 sm:text-lg">เลือกห้องและเวลา กรอกชื่อกับเบอร์โทร แล้วติดตามผลด้วย QR Code</p>
        <div className="mt-5 grid gap-3 sm:flex">
          <Link to="/book" className="inline-flex min-h-14 items-center justify-center gap-2 rounded-control bg-white px-6 text-lg font-semibold text-brand shadow-card transition-transform duration-150 motion-safe:active:scale-[0.98]">
            <CalendarPlus className="size-6" aria-hidden="true" />จองห้องประชุม
          </Link>
          <Link to="/track" className="inline-flex min-h-14 items-center justify-center gap-2 rounded-control px-6 text-lg font-semibold text-white ring-2 ring-white/70 transition-colors duration-150 hover:bg-white/10">
            <Search className="size-6" aria-hidden="true" />ติดตามสถานะคำขอ
          </Link>
        </div>
      </div>
    </section>

    {error && <Alert tone="danger" title="โหลดห้องประชุมไม่สำเร็จ" className="mb-5">{error}</Alert>}
    <RoomStatusNow rooms={rooms} refreshKey={refreshKey} />
    <AvailabilityBoard rooms={rooms} settings={settings} />

    <section aria-labelledby="steps-title" className="mt-8 rounded-card bg-surface p-5 shadow-card sm:p-6">
      <h2 id="steps-title" className="text-lg font-semibold text-ink">ขั้นตอนการขอใช้ห้อง</h2>
      <ol className="mt-3 space-y-3 text-base text-ink">
        {[
          'กรอกคำขอจอง ระบบเช็กให้ทันทีว่าเวลาชนกับคนอื่นไหม',
          'เจ้าหน้าที่ตรวจห้อง หัวหน้างานรับรอง และผู้บริหารอนุมัติ ตามลำดับ',
          'ดูผลด้วยรหัสติดตามหรือ QR Code แล้วพิมพ์แบบฟอร์มคำขอได้ทันที',
        ].map((text, index) => (
          <li key={text} className="flex gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-base font-semibold text-brand">{index + 1}</span>
            <span className="pt-0.5">{text}</span>
          </li>
        ))}
      </ol>
    </section>
  </>;
}
