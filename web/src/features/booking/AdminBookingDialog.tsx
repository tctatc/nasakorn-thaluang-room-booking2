import { useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { formatTimeOfDay, parseTimeOfDay } from '@shared/time/bangkok';
import { isOpenLocationRoom } from '@shared/schemas/room';
import { useApp } from '../../app/providers/AppProvider';
import type { DemoBooking, DemoRoom } from '../../lib/api/demo';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { TimeSelect } from '../../components/ui/TimeSelect';
import { useToast } from '../../components/ui/Toast';
import { endTimeOptions, startTimeOptions } from './timeOptions';

const inputClass = 'min-h-11 w-full rounded-control border border-line bg-surface px-3 text-base text-ink outline-none transition-colors duration-150 focus:border-brand focus:ring-2 focus:ring-brand/20';
const labelClass = 'mb-1.5 block text-sm font-medium text-ink';

/**
 * ผู้ดูแลแก้หรือลบคำขอที่ส่งมาแล้ว
 * แก้ได้: ห้อง วันเวลา เรื่อง ข้อมูลผู้ขอ จำนวนคน รายละเอียด — สถานะและผลการลงนามไม่เปลี่ยน
 * ลบ: ต้องกดยืนยันอีกครั้ง ลบแล้วกู้จากหน้าเว็บไม่ได้ (สาระสำคัญยังอยู่ใน AuditLogs)
 */
export function AdminBookingDialog({ booking, rooms, onClose, onDone }: {
  booking: DemoBooking;
  rooms: DemoRoom[];
  onClose: () => void;
  /** หลังบันทึกหรือลบสำเร็จ — ให้หน้าที่เปิดโหลดรายการใหม่ */
  onDone: () => void;
}) {
  const { api, token, settings } = useApp();
  const toast = useToast();
  const rules = settings!;
  const [roomId, setRoomId] = useState(booking.roomId);
  const [dateKey, setDateKey] = useState(booking.dateKey);
  const [start, setStart] = useState(formatTimeOfDay(booking.startMin));
  const [end, setEnd] = useState(formatTimeOfDay(booking.endMin));
  const [title, setTitle] = useState(booking.title);
  const [bookerName, setBookerName] = useState(booking.bookerName || booking.userName);
  const [position, setPosition] = useState(booking.requesterPosition ?? '');
  const [department, setDepartment] = useState(booking.department ?? '');
  const [phone, setPhone] = useState(booking.requesterPhone ?? '');
  const [attendees, setAttendees] = useState(String(booking.attendees));
  const [note, setNote] = useState(booking.note ?? '');
  const [customLocation, setCustomLocation] = useState(booking.customLocation ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const room = rooms.find((item) => item.roomId === roomId);
  const openLocation = isOpenLocationRoom(room);
  const startMin = parseTimeOfDay(start);
  const endChoices = endTimeOptions(rules, startMin);

  const changeStart = (value: string) => {
    const next = parseTimeOfDay(value);
    setStart(value);
    // คงความยาวเดิมไว้ถ้าทำได้ ไม่ได้ก็ใช้เวลาจบแรกที่เลือกได้
    const keep = next + (parseTimeOfDay(end) - startMin);
    const choices = endTimeOptions(rules, next);
    setEnd(formatTimeOfDay(choices.includes(keep) ? keep : choices[0] ?? next + rules.slotMinutes));
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { changed } = await api.adminUpdateBooking(token, {
        bookingId: booking.bookingId, roomId, dateKey, startMin, endMin: parseTimeOfDay(end), title: title.trim(),
        bookerName: bookerName.trim(), requesterPosition: position.trim(), department: department.trim(),
        requesterPhone: phone.trim(), attendees: Number(attendees) || 0, note: note.trim(),
        customLocation: openLocation ? customLocation.trim() : '',
      });
      toast.success(changed ? `บันทึกการแก้ไขแล้ว (${changed} รายการ)` : 'ไม่มีข้อมูลที่เปลี่ยน');
      onDone();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      await api.adminDeleteBooking(token, booking.bookingId, 'ลบโดยผู้ดูแลระบบ');
      toast.success('ลบคำขอแล้ว');
      onDone();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ลบไม่สำเร็จ');
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      labelId="admin-booking-title"
      title="แก้ไขคำขอ (ผู้ดูแลระบบ)"
      description={`${booking.title || 'คำขอใช้ห้อง'} · สถานะและผลการลงนามจะไม่เปลี่ยน`}
      onClose={onClose}
      footer={confirmDelete ? (
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <p className="w-full text-sm font-medium text-danger sm:mr-auto sm:w-auto">ลบคำขอนี้ถาวร? กู้คืนจากหน้าเว็บไม่ได้</p>
          <Button variant="secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>ไม่ลบ</Button>
          <Button variant="danger" loading={busy} loadingLabel="กำลังลบ" icon={<Trash2 className="size-4" aria-hidden="true" />} onClick={() => void remove()}>ยืนยันลบ</Button>
        </div>
      ) : (
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" className="mr-auto text-danger" disabled={busy} icon={<Trash2 className="size-4" aria-hidden="true" />} onClick={() => setConfirmDelete(true)}>ลบคำขอ</Button>
          <Button variant="secondary" disabled={busy} onClick={onClose}>ยกเลิก</Button>
          <Button type="submit" form="admin-booking-form" loading={busy} loadingLabel="กำลังบันทึก">บันทึกการแก้ไข</Button>
        </div>
      )}
    >
      <form id="admin-booking-form" onSubmit={save} className="space-y-4">
        {error && <Alert tone="danger" title="ทำรายการไม่สำเร็จ"><span role="alert">{error}</span></Alert>}
        <div>
          <label className={labelClass} htmlFor="ab-room">ห้อง</label>
          <select id="ab-room" className={inputClass} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            {rooms.map((item) => <option key={item.roomId} value={item.roomId}>{item.name}{item.status !== 'active' ? ' (ปิดจอง)' : ''}</option>)}
          </select>
        </div>
        {openLocation && (
          <div>
            <label className={labelClass} htmlFor="ab-location">สถานที่</label>
            <input id="ab-location" className={inputClass} required maxLength={200} value={customLocation} onChange={(e) => setCustomLocation(e.target.value)} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="col-span-2 sm:col-span-1">
            <label className={labelClass} htmlFor="ab-date">วันที่</label>
            <input id="ab-date" type="date" required className={inputClass} value={dateKey} onChange={(e) => e.target.value && setDateKey(e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="ab-start">เริ่ม</label>
            <TimeSelect id="ab-start" className={inputClass} value={start} options={startTimeOptions(rules)} onChange={changeStart} />
          </div>
          <div>
            <label className={labelClass} htmlFor="ab-end">สิ้นสุด</label>
            <TimeSelect id="ab-end" className={inputClass} value={end} options={endChoices} onChange={setEnd} />
          </div>
        </div>
        <div>
          <label className={labelClass} htmlFor="ab-title">เรื่องที่ใช้ห้อง</label>
          <input id="ab-title" className={inputClass} required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="ab-booker">ชื่อผู้จอง</label>
            <input id="ab-booker" className={inputClass} required maxLength={100} value={bookerName} onChange={(e) => setBookerName(e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="ab-position">ตำแหน่ง</label>
            <input id="ab-position" className={inputClass} maxLength={100} value={position} onChange={(e) => setPosition(e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="ab-department">หน่วยงาน</label>
            <input id="ab-department" className={inputClass} maxLength={100} value={department} onChange={(e) => setDepartment(e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="ab-phone">โทรศัพท์</label>
            <input id="ab-phone" type="tel" inputMode="tel" className={inputClass} maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="ab-attendees">ผู้เข้าร่วม (คน)</label>
            <input id="ab-attendees" type="number" inputMode="numeric" min={1} className={inputClass} required value={attendees} onChange={(e) => setAttendees(e.target.value)} />
          </div>
        </div>
        <div>
          <label className={labelClass} htmlFor="ab-note">รายละเอียดเพิ่มเติม</label>
          <textarea id="ab-note" className={`${inputClass} min-h-20 py-2`} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </form>
    </Dialog>
  );
}
