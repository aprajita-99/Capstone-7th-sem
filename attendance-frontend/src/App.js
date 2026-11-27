import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import './ui/ui.css';
import { ToastProvider } from './ui/Toast';
import { ConfirmProvider } from './ui/Confirm';
import Home from './components/Home';
import NotFound from './components/NotFound';
import Login from './components/login/Login';
import StudentDashboard from './components/student/studentDashboard';
import TeacherDashboard from './components/teacher/teacherDashboard';
import ClassManagement from './components/teacher/classManagement';
import { PageLoader } from './ui/Spinner';
import ErrorBoundary from './ui/ErrorBoundary';

// Pages that are not landing pages load on demand, keeping the first download small,
// and are fetched in the background once the first page is idle (no wait when opened).
const PREFETCH = [
  () => import('./components/teacher/ClassDetail'),
  () => import('./components/teacher/LiveCheckin'),
  () => import('./components/student/CheckIn'),
  () => import('./components/teacher/Reviews'),
  () => import('./components/student/StudentAttendance'),
];
const prefetchPages = () => PREFETCH.forEach((load) => load().catch(() => {}));
const ClassDetail = lazy(() => import('./components/teacher/ClassDetail'));
const LiveCheckin = lazy(() => import('./components/teacher/LiveCheckin'));
const CheckIn = lazy(() => import('./components/student/CheckIn'));
const Reviews = lazy(() => import('./components/teacher/Reviews'));
const AcousticLab = lazy(() => import('./components/acousticLab/AcousticLab'));
const LinkTest = lazy(() => import('./components/acousticLab/LinkTest'));
// The AWS liveness component is large; load it only on pages that use it.
const FaceTest = lazy(() => import('./components/face/FaceTest'));
const Enroll = lazy(() => import('./components/student/Enroll'));
const VerifyDevice = lazy(() => import('./components/student/VerifyDevice'));
const StudentAttendance = lazy(() => import('./components/student/StudentAttendance'));
const Privacy = lazy(() => import('./components/info/Privacy'));
const Help = lazy(() => import('./components/info/Help'));
const withPageLoader = (element) => <Suspense fallback={<PageLoader label="Loading…" />}>{element}</Suspense>;
const withFaceLoader = (element) => <Suspense fallback={<PageLoader label="Loading face check…" />}>{element}</Suspense>;

// Never a blank page: errors while drawing are caught, retried once, or shown with Reload.
const PageErrorBoundary = ({ children }) => {
  const location = useLocation();
  return <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>;
};

function App() {
  useEffect(() => {
    const idle = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 1500));
    idle(prefetchPages);
  }, []);

  return (
    <BrowserRouter>
      <PageErrorBoundary>
      <ToastProvider>
        <ConfirmProvider>
        <Routes>
          <Route path={'/'} element={<Home />} />
          <Route path={'/login'} element={<Login />} />
          <Route path='/privacy' element={<Suspense fallback={<PageLoader label="Loading…" />}><Privacy /></Suspense>} />
          <Route path='/help' element={<Suspense fallback={<PageLoader label="Loading…" />}><Help /></Suspense>} />
          <Route path='/teacher/classes' element={<ClassManagement />} />
          <Route path='/teacher/classes/:classId' element={withPageLoader(<ClassDetail />)} />
          <Route path='/teacher/classes/:classId/live' element={withPageLoader(<LiveCheckin />)} />
          <Route path='/teacher/sessions/:sessionId' element={withPageLoader(<LiveCheckin />)} />
          <Route path='/student/check-in/:sessionId' element={withPageLoader(<CheckIn />)} />
          <Route path='/acoustic-lab' element={withPageLoader(<AcousticLab />)} />
          <Route path='/acoustic-lab/link' element={withPageLoader(<LinkTest />)} />
          <Route path='/face-test' element={withFaceLoader(<FaceTest />)} />
          <Route path='/student/enroll' element={withFaceLoader(<Enroll />)} />
          <Route path='/student/verify-device' element={withFaceLoader(<VerifyDevice />)} />
          <Route path='/teacher/reviews' element={withPageLoader(<Reviews />)} />
          <Route path='/student/attendance' element={<Suspense fallback={<PageLoader label="Loading your attendance…" />}><StudentAttendance /></Suspense>} />
          <Route path={'/student-dashboard'} element={<StudentDashboard />} />
          <Route path={'/teacher-dashboard'} element={<TeacherDashboard />} />
          <Route path='*' element={<NotFound />} />
        </Routes>
        </ConfirmProvider>
      </ToastProvider>
      </PageErrorBoundary>
    </BrowserRouter>
  );
}

export default App;
