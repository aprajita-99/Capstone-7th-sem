import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './ui/ui.css';
import { ToastProvider } from './ui/Toast';
import Home from './components/Home';
import NotFound from './components/NotFound';
import Login from './components/login/Login';
import StudentDashboard from './components/student/studentDashboard';
import TeacherDashboard from './components/teacher/teacherDashboard';
import ClassManagement from './components/teacher/classManagement';
import ClassDetail from './components/teacher/ClassDetail';
import LiveCheckin from './components/teacher/LiveCheckin';
import CheckIn from './components/student/CheckIn';
import Reviews from './components/teacher/Reviews';
import AcousticLab from './components/acousticLab/AcousticLab';
import LinkTest from './components/acousticLab/LinkTest';
import { PageLoader } from './ui/Spinner';

// The AWS liveness component is large; load it only on pages that use it.
const FaceTest = lazy(() => import('./components/face/FaceTest'));
const Enroll = lazy(() => import('./components/student/Enroll'));
const VerifyDevice = lazy(() => import('./components/student/VerifyDevice'));
const withFaceLoader = (element) => <Suspense fallback={<PageLoader label="Loading face check…" />}>{element}</Suspense>;

function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route path={'/'} element={<Home />} />
          <Route path={'/login'} element={<Login />} />
          <Route path='/teacher/classes' element={<ClassManagement />} />
          <Route path='/teacher/classes/:classId' element={<ClassDetail />} />
          <Route path='/teacher/classes/:classId/live' element={<LiveCheckin />} />
          <Route path='/teacher/sessions/:sessionId' element={<LiveCheckin />} />
          <Route path='/student/check-in/:sessionId' element={<CheckIn />} />
          <Route path='/acoustic-lab' element={<AcousticLab />} />
          <Route path='/acoustic-lab/link' element={<LinkTest />} />
          <Route path='/face-test' element={withFaceLoader(<FaceTest />)} />
          <Route path='/student/enroll' element={withFaceLoader(<Enroll />)} />
          <Route path='/student/verify-device' element={withFaceLoader(<VerifyDevice />)} />
          <Route path='/teacher/reviews' element={<Reviews />} />
          <Route path={'/student-dashboard'} element={<StudentDashboard />} />
          <Route path={'/teacher-dashboard'} element={<TeacherDashboard />} />
          <Route path='*' element={<NotFound />} />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
