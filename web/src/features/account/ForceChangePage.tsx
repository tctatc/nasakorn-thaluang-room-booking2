import { LogOut, ShieldCheck } from 'lucide-react';
import { useApp, useCurrentUser } from '../../app/providers/AppProvider';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { CredentialForm } from './CredentialForm';

/**
 * ผู้ดูแลสร้างบัญชีหรือรีเซ็ตรหัสให้ และติ๊ก "ให้ตั้งใหม่เอง" — ต้องตั้งให้เสร็จก่อนใช้หน้าอื่น
 * หน้าเว็บแค่พามาที่นี่ ตัวบังคับจริงอยู่ที่ server (authenticate_ ปฏิเสธทุกคำสั่งอื่น)
 */
export function ForceChangePage() {
  const user = useCurrentUser();
  const { signOut } = useApp();
  const toast = useToast();
  const password = user.mustChangePassword === true;
  const pin = user.mustChangePin === true;
  const what = password && pin ? 'รหัสผ่านและ PIN ' : password ? 'รหัสผ่าน' : ' PIN ';

  return (
    <main className="min-h-dvh bg-canvas px-4 py-8 sm:py-14">
      <div className="mx-auto w-full max-w-md">
        <div className="flex items-center gap-3">
          <img src={`${import.meta.env.BASE_URL}college-logo.png`} alt="" className="size-11 shrink-0 rounded-full bg-surface p-0.5 ring-1 ring-line" />
          <div className="min-w-0">
            <p className="font-semibold text-ink">ระบบจองห้องประชุม</p>
            <p className="truncate text-sm text-ink-muted">วิทยาลัยเทคนิคท่าหลวงซิเมนต์ไทยอนุสรณ์</p>
          </div>
        </div>

        <div className="mt-8 rounded-card bg-surface p-5 shadow-card ring-1 ring-line/70 sm:p-7">
          <span aria-hidden="true" className="grid size-12 place-items-center rounded-full bg-brand-soft text-brand">
            <ShieldCheck className="size-6" />
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink text-balance">{`ตั้ง${what}ของคุณก่อนเริ่มใช้งาน`}</h1>
          <p className="mt-2 text-base text-ink-muted">
            สวัสดี {user.displayName} ค่าที่ได้รับจากผู้ดูแลใช้ได้ครั้งแรกครั้งเดียว ตั้งของคุณเองตอนนี้ ครั้งต่อไปเข้าสู่ระบบด้วยค่าใหม่ ผู้ดูแลจะไม่รู้ค่าที่คุณตั้ง
          </p>
          <div className="mt-6">
            <CredentialForm
              formId="first-login"
              password={password}
              pin={pin}
              firstTime
              onDone={() => toast.success(`ตั้ง${what}ใหม่แล้ว เริ่มใช้งานได้เลย`.replace(/\s+/g, ' '))}
            />
          </div>
        </div>

        <Button variant="ghost" className="mt-4" icon={<LogOut className="size-4" />} onClick={signOut}>ออกจากระบบ</Button>
      </div>
    </main>
  );
}
