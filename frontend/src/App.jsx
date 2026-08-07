import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Students from './pages/Students';
import Classes from './pages/Classes';
import Seats from './pages/Seats';
import QuestionBank from './pages/QuestionBank';
import Lessons from './pages/Lessons';
import Sessions from './pages/Sessions';
import SessionLive from './pages/SessionLive';
import Attendance from './pages/Attendance';
import Reports from './pages/Reports';
import Statistics from './pages/Statistics';
import Appeals from './pages/Appeals';
import Users from './pages/Users';
import Roles from './pages/Roles';
import Devices from './pages/Devices';
import CameraMonitor from './pages/CameraMonitor';
import AuditLogs from './pages/AuditLogs';
import Subjects from './pages/Subjects';
import Profile from './pages/Profile';

function navItems(role) {
  const r = role || '';
  const items = [
    { group: 'Overview', links: [{ to: '/', label: 'Dashboard' }] }
  ];
  if (['ADMIN', 'HOMEROOM_TEACHER', 'SUBJECT_TEACHER'].includes(r)) {
    items.push({
      group: 'Classroom',
      links: [
        { to: '/students', label: 'Students' },
        { to: '/classes', label: 'Classes' },
        { to: '/seats', label: 'Seating Chart' },
        { to: '/attendance', label: 'Attendance' }
      ]
    });
  }
  if (['ADMIN', 'HOMEROOM_TEACHER', 'SUBJECT_TEACHER'].includes(r)) {
    items.push({
      group: 'Teaching',
      links: [
        { to: '/questions', label: 'Question Bank' },
        { to: '/lessons', label: 'Lessons' },
        { to: '/sessions', label: 'Sessions' },
        { to: '/camera', label: 'Who records' }
      ]
    });
  }
  items.push({
    group: 'Analytics',
    links: [
      { to: '/statistics', label: 'Statistics' },
      { to: '/reports', label: 'Reports' }
    ]
  });
  if (r !== 'GUEST') {
    items.push({
      group: 'Feedback',
      links: [{ to: '/appeals', label: 'Appeals' }]
    });
  }
  if (r === 'ADMIN') {
    items.push({
      group: 'Administration',
      links: [
        { to: '/users', label: 'Users' },
        { to: '/roles', label: 'Roles' },
        { to: '/subjects', label: 'Subjects' },
        { to: '/devices', label: 'Devices' },
        { to: '/audit', label: 'Audit Logs' }
      ]
    });
  }
  items.push({ group: 'Account', links: [{ to: '/profile', label: 'My Profile' }] });
  return items;
}

function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const groups = navItems(user && user.role_code);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          ACIAS
          <small>AI Classroom Interaction Analytics</small>
        </div>
        <nav className="nav">
          {groups.map((g, i) => (
            <div key={i}>
              <div className="group">{g.group}</div>
              {g.links.map((l) => (
                <NavLink key={l.to} to={l.to} end={l.to === '/'}>
                  {l.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">RBAC · SQLite · AI Engine</div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

function Guard({ children, fallback }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <Guard>
            <Layout>
              <Topbar />
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/students" element={<Students />} />
                <Route path="/classes" element={<Classes />} />
                <Route path="/seats" element={<Seats />} />
                <Route path="/questions" element={<QuestionBank />} />
                <Route path="/lessons" element={<Lessons />} />
                <Route path="/sessions" element={<Sessions />} />
                <Route path="/sessions/:id/live" element={<SessionLive />} />
                <Route path="/camera" element={<CameraMonitor />} />
                <Route path="/attendance" element={<Attendance />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/statistics" element={<Statistics />} />
                <Route path="/appeals" element={<Appeals />} />
                <Route path="/users" element={<Users />} />
                <Route path="/roles" element={<Roles />} />
                <Route path="/devices" element={<Devices />} />
                <Route path="/audit" element={<AuditLogs />} />
                <Route path="/subjects" element={<Subjects />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Layout>
          </Guard>
        }
      />
    </Routes>
  );
}

function Topbar() {
  const { user, logout } = useAuth();
  return (
    <div className="topbar">
      <div />
      <div className="user-chip">
        <span className="role-badge">{user ? user.role_code : ''}</span>
        <span>{user ? user.full_name : ''}</span>
        <button className="logout" onClick={() => { logout(); window.location.href = '/login'; }}>
          Logout
        </button>
      </div>
    </div>
  );
}
