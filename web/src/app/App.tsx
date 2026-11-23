import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { LoadingState } from '../components/ui/States';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { NotFoundPage } from '../features/NotFoundPage';
import { LoginPage } from '../features/auth/LoginPage';
import { BookingPage, BookingsPage, RoomsPage } from '../features/BookingPages';
import { ApprovalsPage, PrintFormPage } from '../features/ApprovalReportPages';
import { UsersPage } from '../features/users/UsersPage';
import { ManagePage } from '../features/manage/ManagePage';
import { PublicShell } from '../components/layout/PublicShell';
import { PublicHomePage } from '../features/public/PublicHomePage';
import { QrPosterPage } from '../features/public/QrPosterPage';
import { TrackLookupPage, TrackPage } from '../features/track/TrackPage';
import { NAV_ITEMS } from './navigation';
import { ReviewsPage } from '../features/reviews/ReviewsPage';
import { ReportsPage } from '../features/reports/ReportsPage';
import { canSeeAllBookings } from '@shared/domain/approval';
import { useApp } from './providers/AppProvider';

/** หน้าของผู้ดูแลเท่านั้น — คนอื่นพิมพ์ URL เข้ามาเองจะถูกพากลับหน้าภาพรวม (server ตรวจสิทธิ์ซ้ำทุกคำสั่งอยู่แล้ว) */
function AdminOnly({ children }: { children: ReactNode }) {
  const { user } = useApp();
  return user?.role === 'admin' ? children : <Navigate to="/" replace />;
}

/** หน้าที่ต้องเห็นการจองทุกคน (ผู้ดูแลและผู้ลงนาม) */
function AllBookingsOnly({ children }: { children: ReactNode }) {
  const { user } = useApp();
  return user !== null && canSeeAllBookings(user.role) ? children : <Navigate to="/" replace />;
}

/** ยังไม่เข้าสู่ระบบแต่เปิดลิงก์หน้าของเจ้าหน้าที่ (เช่น #/approvals) → ไปหน้าเข้าสู่ระบบ ที่เหลือกลับหน้าแรก */
function StaffPathOrHome() {
  const { pathname, search } = useLocation();
  const staffPath = NAV_ITEMS.some((item) => item.path !== '/' && pathname.startsWith(item.path));
  // จำหน้าที่ตั้งใจเปิดไว้ เข้าสู่ระบบแล้วพากลับไปหน้านั้น
  return staffPath ? <Navigate to="/login" replace state={{ from: `${pathname}${search}` }} /> : <Navigate to="/" replace />;
}

/** เพิ่งเข้าสู่ระบบจากหน้า /login → กลับไปหน้าที่ตั้งใจเปิด (ถ้ามี) ไม่งั้นหน้าภาพรวม */
function AfterLogin() {
  const from = (useLocation().state as { from?: unknown } | null)?.from;
  return <Navigate to={typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/'} replace />;
}

export function App() {
  const { phase } = useApp();

  if (phase === 'booting') {
    return (
      <div className="grid min-h-dvh place-items-center">
        <LoadingState message="กำลังเตรียมระบบ" />
      </div>
    );
  }

  if (phase === 'anonymous') {
    return (
      <Routes>
        <Route element={<PublicShell />}>
          <Route path="/" element={<PublicHomePage />} />
          <Route path="/book" element={<BookingPage />} />
          <Route path="/track" element={<TrackLookupPage />} />
          <Route path="/track/:code" element={<TrackPage />} />
          <Route path="/qr" element={<QrPosterPage />} />
        </Route>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<StaffPathOrHome />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/book" element={<BookingPage />} />
        <Route path="/calendar" element={<BookingsPage calendar />} />
        <Route path="/my-bookings" element={<BookingsPage />} />
        <Route path="/rooms" element={<RoomsPage />} />
        <Route path="/approvals" element={<ApprovalsPage />} />
        <Route path="/reports" element={<PrintFormPage />} />
        <Route path="/users" element={<AdminOnly><UsersPage /></AdminOnly>} />
        <Route path="/summary" element={<AllBookingsOnly><ReportsPage /></AllBookingsOnly>} />
        <Route path="/reviews" element={<AdminOnly><ReviewsPage /></AdminOnly>} />
        <Route path="/manage" element={<AdminOnly><ManagePage /></AdminOnly>} />
        {/*
          เส้นทางของโมดูลที่ยังไม่เสร็จ ชี้กลับหน้าภาพรวม
          เพื่อไม่ให้ใครเจอหน้าขาวจากการพิมพ์ URL หรือกดลิงก์เก่า
        */}
        <Route path="/track" element={<TrackLookupPage />} />
        <Route path="/track/:code" element={<TrackPage />} />
        <Route path="/qr" element={<QrPosterPage />} />
        <Route path="/login" element={<AfterLogin />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
