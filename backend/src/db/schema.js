'use strict';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  level INTEGER NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  grade TEXT,
  room TEXT,
  subjects TEXT,
  homeroom_teacher_id INTEGER REFERENCES users(id),
  academic_year TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  student_id INTEGER REFERENCES students(id),
  class_id INTEGER REFERENCES classes(id),
  status TEXT DEFAULT 'active',
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_code TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  gender TEXT,
  birth_date TEXT,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  user_id INTEGER REFERENCES users(id),
  parent_user_id INTEGER REFERENCES users(id),
  notes TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS question_banks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  subject_id INTEGER REFERENCES subjects(id),
  owner_id INTEGER REFERENCES users(id),
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_id INTEGER NOT NULL REFERENCES question_banks(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  answer TEXT,
  choices TEXT,
  difficulty INTEGER DEFAULT 1,
  subject_id INTEGER REFERENCES subjects(id),
  duration INTEGER DEFAULT 10,
  points INTEGER DEFAULT 10,
  keywords TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  title TEXT NOT NULL,
  subject_id INTEGER REFERENCES subjects(id),
  teacher_id INTEGER REFERENCES users(id),
  class_id INTEGER REFERENCES classes(id),
  scheduled_at TEXT,
  status TEXT DEFAULT 'scheduled',
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  stream_url TEXT,
  location TEXT,
  status TEXT DEFAULT 'offline',
  registered_by INTEGER REFERENCES users(id),
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id INTEGER REFERENCES lessons(id),
  teacher_id INTEGER NOT NULL REFERENCES users(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  subject_id INTEGER REFERENCES subjects(id),
  device_id INTEGER REFERENCES devices(id),
  status TEXT DEFAULT 'idle',
  start_time TEXT,
  end_time TEXT,
  notes TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS session_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  question_id INTEGER REFERENCES questions(id),
  type TEXT,
  content TEXT,
  points INTEGER DEFAULT 10,
  recognition_mode TEXT DEFAULT '1',
  started_at TEXT,
  ended_at TEXT,
  status TEXT DEFAULT 'open'
);

CREATE TABLE IF NOT EXISTS seats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES students(id),
  seat_row INTEGER NOT NULL,
  seat_col INTEGER NOT NULL,
  camera_id INTEGER REFERENCES devices(id),
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS seat_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  from_seat_id INTEGER,
  to_seat_id INTEGER,
  reason TEXT,
  changed_by INTEGER REFERENCES users(id),
  changed_at TEXT
);

CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_question_id INTEGER NOT NULL REFERENCES session_questions(id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id),
  seat_id INTEGER REFERENCES seats(id),
  answer_value TEXT,
  is_correct INTEGER,
  score REAL,
  reaction_ms INTEGER,
  detection_method TEXT,
  confidence REAL,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES students(id),
  seat_id INTEGER REFERENCES seats(id),
  type TEXT,
  sub_type TEXT,
  value REAL,
  detail TEXT,
  timestamp TEXT
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id),
  status TEXT,
  method TEXT,
  timestamp TEXT
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT,
  scope_type TEXT,
  scope_id INTEGER,
  period TEXT,
  title TEXT,
  summary TEXT,
  content TEXT,
  generated_by INTEGER REFERENCES users(id),
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS appeals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER REFERENCES reports(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES students(id),
  submitted_by INTEGER REFERENCES users(id),
  reason TEXT,
  status TEXT DEFAULT 'pending',
  resolution TEXT,
  resolved_by INTEGER REFERENCES users(id),
  created_at TEXT,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  detail TEXT,
  ip TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS statistics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period TEXT,
  scope TEXT,
  scope_id INTEGER,
  metric TEXT,
  value REAL,
  updated_at TEXT,
  UNIQUE(period, scope, scope_id, metric)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sid TEXT NOT NULL,
  ip TEXT,
  created_at TEXT,
  expires_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS camera_feeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  device_id INTEGER REFERENCES devices(id),
  photo_path TEXT,
  status TEXT DEFAULT 'active',
  last_result TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT,
  ended_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);
CREATE INDEX IF NOT EXISTS idx_seats_class ON seats(class_id);
CREATE INDEX IF NOT EXISTS idx_answers_session ON answers(session_id);
CREATE INDEX IF NOT EXISTS idx_interactions_session ON interactions(session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_session ON attendance(session_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_sid ON auth_sessions(sid);
CREATE INDEX IF NOT EXISTS idx_camera_feeds_session ON camera_feeds(session_id);
`;

module.exports = { SCHEMA };
