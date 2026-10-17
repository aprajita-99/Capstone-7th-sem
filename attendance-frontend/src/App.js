import React from 'react';
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
import AcousticLab from './components/acousticLab/AcousticLab';
import LinkTest from './components/acousticLab/LinkTest';

function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route path={'/'} element={<Home />} />
          <Route path={'/login'} element={<Login />} />
          <Route path='/teacher/classes' element={<ClassManagement />} />
          <Route path='/teacher/classes/:classId' element={<ClassDetail />} />
          <Route path='/acoustic-lab' element={<AcousticLab />} />
          <Route path='/acoustic-lab/link' element={<LinkTest />} />
          <Route path={'/student-dashboard'} element={<StudentDashboard />} />
          <Route path={'/teacher-dashboard'} element={<TeacherDashboard />} />
          <Route path='*' element={<NotFound />} />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
