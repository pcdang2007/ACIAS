'use strict';

const bcrypt = require('bcryptjs');
const { getDb, rows, run, transaction, now } = require('./database');

const PERMISSIONS = [
  ['user.read', 'Read users'],
  ['user.write', 'Manage users'],
  ['role.read', 'Read roles'],
  ['role.write', 'Manage roles'],
  ['class.read', 'Read classes'],
  ['class.write', 'Manage classes'],
  ['student.read', 'Read students'],
  ['student.write', 'Manage students'],
  ['subject.read', 'Read subjects'],
  ['subject.write', 'Manage subjects'],
  ['question.read', 'Read question bank'],
  ['question.write', 'Manage question bank'],
  ['lesson.read', 'Read lessons'],
  ['lesson.write', 'Manage lessons'],
  ['session.read', 'Read sessions'],
  ['session.write', 'Manage sessions'],
  ['seat.read', 'Read seating chart'],
  ['seat.write', 'Manage seating chart'],
  ['attendance.read', 'Read attendance'],
  ['attendance.write', 'Manage attendance'],
  ['answer.read', 'Read answers'],
  ['answer.write', 'Manage answers'],
  ['interaction.read', 'Read interactions'],
  ['interaction.write', 'Manage interactions'],
  ['report.read', 'Read reports'],
  ['report.write', 'Generate reports'],
  ['appeal.read', 'Read appeals'],
  ['appeal.write', 'Submit/resolve appeals'],
  ['device.read', 'Read devices'],
  ['device.write', 'Manage devices'],
  ['audit.read', 'Read audit logs'],
  ['statistic.read', 'Read statistics'],
  ['ai.run', 'Run AI recognition']
];

const ROLE_DEFS = [
  {
    code: 'ADMIN',
    name: 'Admin',
    level: 0,
    description: 'System administrator with full access',
    perms: PERMISSIONS.map((p) => p[0])
  },
  {
    code: 'HOMEROOM_TEACHER',
    name: 'Homeroom Teacher',
    level: 1,
    description: 'Class homeroom teacher (parent of students)',
    perms: [
      'user.read', 'user.write',
      'class.read', 'class.write',
      'student.read', 'student.write',
      'subject.read',
      'question.read', 'question.write',
      'lesson.read', 'lesson.write',
      'session.read', 'session.write',
      'seat.read', 'seat.write',
      'attendance.read', 'attendance.write',
      'answer.read', 'answer.write',
      'interaction.read', 'interaction.write',
      'report.read', 'report.write',
      'appeal.read', 'appeal.write',
      'device.read',
      'statistic.read',
      'ai.run'
    ]
  },
  {
    code: 'PARENT',
    name: 'Parent',
    level: 1,
    description: 'Parent/guardian of a student',
    perms: ['class.read', 'student.read', 'subject.read', 'question.read', 'report.read', 'statistic.read', 'appeal.write', 'attendance.read']
  },
  {
    code: 'SUBJECT_TEACHER',
    name: 'Subject Teacher',
    level: 2,
    description: 'Subject teacher',
    perms: [
      'class.read', 'student.read', 'subject.read',
      'question.read', 'question.write',
      'lesson.read', 'lesson.write',
      'session.read', 'session.write',
      'seat.read', 'seat.write',
      'attendance.read', 'attendance.write',
      'answer.read', 'answer.write',
      'interaction.read', 'interaction.write',
      'report.read', 'report.write',
      'appeal.read',
      'device.read',
      'statistic.read',
      'ai.run'
    ]
  },
  {
    code: 'STUDENT',
    name: 'Student',
    level: 3,
    description: 'Student',
    perms: ['class.read', 'subject.read', 'question.read', 'report.read', 'statistic.read']
  },
  {
    code: 'GUEST',
    name: 'Guest',
    level: 4,
    description: 'Guest viewer',
    perms: ['class.read', 'subject.read', 'statistic.read']
  }
];

const SUBJECTS = [
  ['MAT', 'Mathematics'],
  ['LIT', 'Literature'],
  ['PHY', 'Physics'],
  ['CHE', 'Chemistry'],
  ['ENG', 'English'],
  ['HIS', 'History']
];

const STUDENT_NAMES = {
  '10A1': [
    ['HS001', 'Nguyen Van Bao'],
    ['HS002', 'Tran Thi Mai'],
    ['HS003', 'Le Hoang Minh'],
    ['HS004', 'Pham Thu Huong'],
    ['HS005', 'Hoang Duc Anh'],
    ['HS006', 'Vo Thi Ngoc'],
    ['HS007', 'Dang Quang Huy'],
    ['HS008', 'Bui Thi Lan'],
    ['HS009', 'Do Van Khang'],
    ['HS010', 'Ngo Thi Yen'],
    ['HS011', 'Duong Anh Tuan'],
    ['HS012', 'Ly Thi Ha']
  ],
  '10A2': [
    ['HS101', 'Vu Minh Chau'],
    ['HS102', 'Phan Ngoc Linh'],
    ['HS103', 'Trieu Gia Huy'],
    ['HS104', 'Lam Thi Thao'],
    ['HS105', 'Trinh Van Phuc']
  ]
};

function seed() {
  const db = getDb();
  const existing = rows('SELECT COUNT(*) AS c FROM roles');
  if (existing[0].c > 0) {
    console.log('Database already seeded. Skipping.');
    return;
  }

  transaction(() => {
    for (const [code, name] of PERMISSIONS) {
      run('INSERT INTO permissions (code, name) VALUES (?, ?)', [code, name]);
    }
    const permId = {};
    for (const p of rows('SELECT id, code FROM permissions')) permId[p.code] = p.id;

    const roleId = {};
    for (const r of ROLE_DEFS) {
      const res = run('INSERT INTO roles (code, name, level, description) VALUES (?, ?, ?, ?)', [
        r.code, r.name, r.level, r.description
      ]);
      roleId[r.code] = res.lastInsertRowid;
      for (const p of r.perms) {
        run('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [roleId[r.code], permId[p]]);
      }
    }

    for (const [code, name] of SUBJECTS) {
      run('INSERT INTO subjects (code, name) VALUES (?, ?)', [code, name]);
    }

    const hash = (pw) => bcrypt.hashSync(pw, 10);
    const admin = run('INSERT INTO users (username, password_hash, full_name, role_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      'admin', hash('admin123'), 'System Administrator', roleId.ADMIN, 'active', now()
    ]).lastInsertRowid;

    const ht = run('INSERT INTO users (username, password_hash, full_name, email, role_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      'teacher.homeroom', hash('password123'), 'Nguyen Van An', 'an.nv@school.edu.vn', roleId.HOMEROOM_TEACHER, 'active', now()
    ]).lastInsertRowid;

    const stMath = run('INSERT INTO users (username, password_hash, full_name, email, role_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      'teacher.math', hash('password123'), 'Tran Van Binh', 'binh.tv@school.edu.vn', roleId.SUBJECT_TEACHER, 'active', now()
    ]).lastInsertRowid;

    const stLit = run('INSERT INTO users (username, password_hash, full_name, email, role_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      'teacher.lit', hash('password123'), 'Pham Thi Cuc', 'cuc.pt@school.edu.vn', roleId.SUBJECT_TEACHER, 'active', now()
    ]).lastInsertRowid;

    run('INSERT INTO users (username, password_hash, full_name, role_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      'guest', hash('guest123'), 'Guest User', roleId.GUEST, 'active', now()
    ]);

    const c1 = run('INSERT INTO classes (name, grade, room, subjects, homeroom_teacher_id, academic_year, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      '10A1', '10', 'Room 201', 'MAT,LIT,ENG', ht, '2026-2027', now()
    ]).lastInsertRowid;
    const c2 = run('INSERT INTO classes (name, grade, room, subjects, homeroom_teacher_id, academic_year, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      '10A2', '10', 'Room 202', 'MAT,PHY,CHE', ht, '2026-2027', now()
    ]).lastInsertRowid;

    run('UPDATE users SET class_id = ? WHERE id = ?', [c1, ht]);
    run('INSERT INTO classes (name, grade, room, subjects, academic_year, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      '11A1', '11', 'Room 301', 'MAT,LIT', '2026-2027', now()
    ]);

    const studentId = {};
    const parentId = {};
    for (const [cls, code, name] of [
      ...STUDENT_NAMES['10A1'].map((s) => ['10A1', s[0], s[1]]),
      ...STUDENT_NAMES['10A2'].map((s) => ['10A2', s[0], s[1]])
    ]) {
      const cid = cls === '10A1' ? c1 : c2;
      const userRes = run('INSERT INTO users (username, password_hash, full_name, role_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
        code.toLowerCase(), hash('password123'), name, roleId.STUDENT, 'active', now()
      ]);
      const sid = run('INSERT INTO students (student_code, full_name, gender, birth_date, class_id, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        code, name, Math.random() > 0.5 ? 'Male' : 'Female', '2010-01-01', cid, userRes.lastInsertRowid, now()
      ]).lastInsertRowid;
      studentId[code] = sid;

      const puser = run('INSERT INTO users (username, password_hash, full_name, role_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
        `parent.${code.toLowerCase()}`, hash('password123'), `Parent of ${name}`, roleId.PARENT, 'active', now()
      ]).lastInsertRowid;
      parentId[code] = puser;
      run('UPDATE students SET parent_user_id = ? WHERE id = ?', [puser, sid]);
      run('UPDATE users SET student_id = ? WHERE id = ?', [sid, userRes.lastInsertRowid]);
    }

    const bank1 = run('INSERT INTO question_banks (name, description, subject_id, owner_id, created_at) VALUES (?, ?, ?, ?, ?)', [
      'Grade 10 Math - Quadratic Functions', 'Chapter 1', 1, admin, now()
    ]).lastInsertRowid;
    const bank2 = run('INSERT INTO question_banks (name, description, subject_id, owner_id, created_at) VALUES (?, ?, ?, ?, ?)', [
      'Grade 10 Literature - Folk Literature', 'Chapter 1', 2, admin, now()
    ]).lastInsertRowid;

    const questions = [
      [bank1, 'multiple_choice', 'The vertex of the parabola y = x² - 4x + 3 is:', 'A', JSON.stringify(['(2, -1)', '(2, 1)', '(-2, 3)', '(-2, -1)']), 3, 1, 15, 10, JSON.stringify(['vertex', 'parabola'])],
      [bank1, 'multiple_choice', 'Solve x² - 5x + 6 = 0:', 'C', JSON.stringify(['x = 1; x = 6', 'x = -2; x = -3', 'x = 2; x = 3', 'x = -1; x = -6']), 2, 1, 10, 10, JSON.stringify(['solve', 'x squared'])],
      [bank1, 'true_false', 'The discriminant of x² - 2x + 1 = 0 equals zero.', 'true', null, 1, 1, 8, 5, JSON.stringify(['discriminant', 'zero'])],
      [bank1, 'short_answer', 'State the axis of symmetry formula for ax² + bx + c.', 'x = -b/(2a)', null, 3, 1, 20, 10, JSON.stringify(['axis', 'symmetry'])],
      [bank1, 'multiple_choice', 'The range of y = x² + 2 is:', 'D', JSON.stringify(['R', '[0, ∞)', '(-∞, 2]', '[2, ∞)']), 2, 1, 10, 10, JSON.stringify(['range', 'minimum'])],
      [bank1, 'multiple_choice', 'How many real roots does x² + 1 = 0 have?', 'B', JSON.stringify(['1', '0', '2', 'Infinite']), 1, 1, 10, 5, JSON.stringify(['roots', 'no solution'])],
      [bank2, 'multiple_choice', '"Truyen Kieu" was written by:', 'C', JSON.stringify(['Nguyen Trai', 'Ho Xuan Huong', 'Nguyen Du', 'To Huu']), 2, 2, 10, 10, JSON.stringify(['Truyen Kieu', 'Nguyen Du'])],
      [bank2, 'true_false', 'Folk literature is transmitted in written form.', 'false', null, 1, 2, 8, 5, JSON.stringify(['folk', 'oral'])],
      [bank2, 'short_answer', 'Name one genre of Vietnamese folk literature.', 'Fairy tale', null, 1, 2, 15, 5, JSON.stringify(['fairy tale', 'folklore'])]
    ];
    for (const q of questions) {
      run('INSERT INTO questions (bank_id, type, content, answer, choices, difficulty, subject_id, duration, points, keywords, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        q[0], q[1], q[2], q[3], q[4], q[5], q[6], q[7], q[8], q[9], admin, now()
      ]);
    }

    const lesson = run('INSERT INTO lessons (code, title, subject_id, teacher_id, class_id, scheduled_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
      'L-MAT-10A1-001', 'Quadratic Functions - Review', 1, stMath, c1, '2026-08-05T07:30:00Z', 'scheduled', now()
    ]).lastInsertRowid;

    const dev1 = run('INSERT INTO devices (name, type, stream_url, location, status, registered_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      'Main Webcam', 'webcam', 'rtsp://camera-01.lan/stream', 'Room 201', 'online', admin, now()
    ]).lastInsertRowid;
    run('INSERT INTO devices (name, type, stream_url, location, status, registered_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      'Room Microphone', 'microphone', 'rtsp://mic-01.lan/audio', 'Room 201', 'online', admin, now()
    ]);

    const students = rows('SELECT s.id, s.student_code, s.class_id FROM students s ORDER BY s.id');
    const grid = { c1: 0, c2: 0 };
    for (const s of students) {
      const key = s.class_id === c1 ? 'c1' : 'c2';
      const col = grid[key] % 4;
      const r = Math.floor(grid[key] / 4);
      grid[key] += 1;
      run('INSERT INTO seats (class_id, student_id, seat_row, seat_col, camera_id, active) VALUES (?, ?, ?, ?, ?, 1)', [
        s.class_id, s.id, r + 1, col + 1, dev1
      ]);
    }

    run('INSERT INTO lessons (code, title, subject_id, teacher_id, class_id, scheduled_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
      'L-LIT-10A2-001', 'Truyen Kieu - Reading', 2, stLit, c2, '2026-08-06T09:00:00Z', 'scheduled', now()
    ]);

    console.log('Seed complete.');
    console.log('  Admin login: admin / admin123');
    console.log('  Teacher login: teacher.math / password123');
    console.log('  Student login: hs001 / password123');
    console.log('  Parent login: parent.hs001 / password123');
    console.log('  Guest login: guest / guest123');
  });
}

if (require.main === module) {
  seed();
}

module.exports = { seed };
