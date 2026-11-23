import { NavLink, Outlet } from 'react-router-dom';
import { CalendarCheck2, CalendarPlus, LayoutDashboard, LogIn, Search } from 'lucide-react';
import { useApp } from '../../app/providers/AppProvider';
import { Button } from '../ui/Button';
import { LoadingState } from '../ui/States';
import { cn } from '../../lib/cn';

/** เมนูของผู้จองทั่วไป — 3 งานหลัก ไม่ต้องเข้าสู่ระบบ */
const PUBLIC_NAV = [
  { path: '/', label: 'ปฏิทินห้องว่าง', short: 'หน้าแรก', icon: LayoutDashboard },
  { path: '/book', label: 'จองห้องประชุม', short: 'จองห้อง', icon: CalendarPlus },
  { path: '/track', label: 'ติดตามสถานะ', short: 'ติดตาม', icon: Search },
] as const;

/**
 * โครงหน้าสำหรับคนที่ยังไม่เข้าสู่ระบบ: จองห้อง ดูปฏิทินห้องว่าง และติดตามคำขอได้เลย
 * การเข้าสู่ระบบมีไว้สำหรับเจ้าหน้าที่ หัวหน้างาน ผู้บริหาร และผู้ดูแลเท่านั้น
 */
export function PublicShell() {
  const { settings, bootError, retryBoot } = useApp();

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only-focusable">ข้ามไปที่เนื้อหาหลัก</a>
      <header className="app-chrome sticky top-0 z-[20] border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-5xl items-center gap-3 px-4 pt-[env(safe-area-inset-top)] lg:px-6">
          <NavLink to="/" className="flex min-w-0 items-center gap-2.5 rounded-control">
            <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-inner bg-brand-gradient text-ink-inverse shadow-[var(--shadow-3d-brand)]">
              <CalendarCheck2 className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-base font-semibold text-ink">ระบบจองห้องประชุม</span>
              <span className="block truncate text-sm text-ink-muted">วิทยาลัยเทคนิคท่าหลวงฯ</span>
            </span>
          </NavLink>
          <nav aria-label="เมนูหลัก" className="ml-auto hidden md:block">
            <ul className="flex items-center gap-1">
              {PUBLIC_NAV.map((item) => (
                <li key={item.path}>
                  <NavLink to={item.path} end={item.path === '/'} className={({ isActive }) => cn(
                    'flex min-h-12 items-center gap-2 rounded-pill px-4 text-base font-medium transition-colors duration-150',
                    isActive ? 'bg-brand-gradient text-ink-inverse shadow-[var(--shadow-3d-brand)]' : 'text-ink-muted hover:bg-brand-soft hover:text-brand',
                  )}>
                    <item.icon className="size-5" aria-hidden="true" />{item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <NavLink to="/login" className="ml-auto inline-flex min-h-12 shrink-0 items-center gap-2 rounded-control px-3 text-sm font-medium text-ink-muted ring-1 ring-line hover:bg-surface-sunken hover:text-ink md:ml-2">
            <LogIn className="size-5" aria-hidden="true" /><span>เจ้าหน้าที่</span>
          </NavLink>
        </div>
      </header>

      <main id="main" className="flex-1 px-4 pt-5 pb-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom)+1.5rem)] md:pb-10 lg:px-6 lg:pt-8">
        <div className="mx-auto max-w-5xl">
          {settings !== null ? <Outlet /> : bootError ? (
            <div className="mx-auto max-w-md rounded-card bg-surface p-6 text-center shadow-card">
              <p className="text-lg font-semibold text-ink">เชื่อมต่อระบบไม่สำเร็จ</p>
              <p className="mt-1 text-base text-ink-muted">{bootError}</p>
              <Button className="mt-4" onClick={retryBoot}>ลองอีกครั้ง</Button>
            </div>
          ) : <LoadingState message="กำลังเตรียมระบบ" />}
        </div>
      </main>

      {/* มือถือ/แท็บเล็ตแนวตั้ง: เมนูด้านล่าง ปุ่มจองอยู่กลางที่นิ้วโป้งเอื้อมถึง */}
      <nav aria-label="เมนูด้านล่าง" className="app-chrome fixed inset-x-0 bottom-0 z-[30] border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <ul className="mx-auto grid h-[var(--bottom-nav-height)] max-w-lg grid-cols-3">
          {PUBLIC_NAV.map((item) => (
            <li key={item.path} className="flex">
              <NavLink to={item.path} end={item.path === '/'} className={({ isActive }) => cn(
                'flex flex-1 flex-col items-center justify-center gap-1 text-sm font-medium transition-colors duration-150',
                isActive ? 'text-brand' : 'text-ink-muted',
              )}>
                {({ isActive }) => <>
                  <span className={cn('grid h-8 w-14 place-items-center rounded-full transition-colors duration-150', isActive && 'bg-brand-soft')}>
                    <item.icon className="size-6" aria-hidden="true" />
                  </span>
                  {item.short}
                </>}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
