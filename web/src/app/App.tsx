import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell';
import { LoadingState } from '../components/ui/States';
import { NotFoundPage } from '../features/NotFoundPage';
import { LoginPage } from '../features/auth/LoginPage';
import { BookingPage, BookingsPage, RoomsPage } from '../features/BookingPages';
import { PublicShell } from '../components/layout/PublicShell';
import { PublicHomePage } from '../features/public/PublicHomePage';
import { TrackLookupPage, TrackPage } from '../features/track/TrackPage';
import { NAV_ITEMS } from './navigation';
import { canSeeAllBookings } from '@shared/domain/approval';
import { useApp } from './providers/AppProvider';
import { ForceChangePage } from '../features/account/ForceChangePage';
import { MyPage } from '../features/account/MyPage';

/*
 * หน้าที่คนส่วนใหญ่ไม่ได้เปิด (หลังบ้าน รายงาน พิมพ์ฟอร์ม) แยกไฟล์ โหลดเมื่อกดเข้าไปเท่านั้น
 * หน้าจอง/ติดตาม/หน้าของฉันอยู่ในไฟล์หลัก เปิดแล้วใช้ได้ทันที
 */
const DashboardPage = lazy(() => import('../features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const ApprovalsPage = lazy(() => import('../features/ApprovalReportPages').then((m) => ({ default: m.ApprovalsPage })));
const PrintFormPage = lazy(() => import('../features/ApprovalReportPages').then((m) => ({ default: m.PrintFormPage })));
const UsersPage = lazy(() => import('../features/users/UsersPage').then((m) => ({ default: m.UsersPage })));
const ManagePage = lazy(() => import('../features/manage/ManagePage').then((m) => ({ default: m.ManagePage })));
const QrPosterPage = lazy(() => import('../features/public/QrPosterPage').then((m) => ({ default: m.QrPosterPage })));
const ReviewsPage = lazy(() => import('../features/reviews/ReviewsPage').then((m) => ({ default: m.ReviewsPage })));
const ReportsPage = lazy(() => import('../features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const AttachmentPage = lazy(() => import('../features/attachment/AttachmentPage').then((m) => ({ default: m.AttachmentPage })));

function PageLoading() {
  return <div className="grid min-h-[40vh] place-items-center"><LoadingState message="กำลังเปิดหน้า" /></div>;
}

/** หน้าแรกหลังเข้าสู่ระบบ: ผู้ใช้งานทั่วไปเห็นหน้าของฉัน (คำขอของตัวเอง) ผู้ลงนามและผู้ดูแลเห็นภาพรวมทั้งระบบ */
function HomePage() {
  const { user } = useApp();
  return user?.role === 'staff' ? <MyPage asHome /> : <DashboardPage />;
}

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
  // หน้าเอกสารแนบ (ลิงก์จาก LINE) ต้องเข้าสู่ระบบก่อนเสมอ
  const staffPath = pathname.startsWith('/attachment/') || pathname === '/me' || NAV_ITEMS.some((item) => item.path !== '/' && pathname.startsWith(item.path));
  // จำหน้าที่ตั้งใจเปิดไว้ เข้าสู่ระบบแล้วพากลับไปหน้านั้น
  return staffPath ? <Navigate to="/login" replace state={{ from: `${pathname}${search}` }} /> : <Navigate to="/" replace />;
}

/** เพิ่งเข้าสู่ระบบจากหน้า /login → กลับไปหน้าที่ตั้งใจเปิด (ถ้ามี) ไม่งั้นหน้าภาพรวม */
function AfterLogin() {
  const from = (useLocation().state as { from?: unknown } | null)?.from;
  return <Navigate to={typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/'} replace />;
}

export function App() {
  const { phase, user } = useApp();

  if (phase === 'booting') {
    return (
      <div className="grid min-h-dvh place-items-center">
        <LoadingState message="กำลังเตรียมระบบ" />
      </div>
    );
  }

  if (phase === 'anonymous') {
    return (
      <Suspense fallback={<PageLoading />}>
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
      </Suspense>
    );
  }

  // ผู้ดูแลสั่งให้ตั้งรหัสใหม่เอง: ทุก URL มาที่หน้าตั้งรหัส (server ปฏิเสธคำสั่งอื่นอยู่แล้ว)
  if (user !== null && (user.mustChangePassword === true || user.mustChangePin === true)) {
    return <ForceChangePage />;
  }

  return (
    <Suspense fallback={<PageLoading />}>
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/me" element={<MyPage />} />
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
        <Route path="/attachment/:bookingId" element={<AttachmentPage />} />
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
    </Suspense>
  );
}
