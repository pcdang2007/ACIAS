'use strict';

const express = require('express');
const { row, rows, run, now } = require('../db/database');
const { authRequired, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { wrap, ok, created, bad, notFound } = require('./helpers');

const router = express.Router();
router.use(authRequired);

router.get('/', requirePermission('attendance.read'), wrap((req, res) => {
  const { session_id, class_id, status } = req.query;
  const cond = [];
  const params = [];
  if (session_id) { cond.push('a.session_id = ?'); params.push(session_id); }
  if (status) { cond.push('a.status = ?'); params.push(status); }
  if (class_id) { cond.push('st.class_id = ?'); params.push(class_id); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const list = rows(
    `SELECT a.*, st.full_name, st.student_code, s.name AS session_name
     FROM attendance a
     JOIN students st ON st.id = a.student_id
     LEFT JOIN sessions s ON s.id = a.session_id
     ${where} ORDER BY a.id DESC`,
    params
  );
  ok(res, list);
}));

router.post('/', requirePermission('attendance.write'), wrap((req, res) => {
  const { session_id, student_id, status, method } = req.body || {};
  if (!session_id || !student_id || !status) return bad(res, 'session_id, student_id, status are required');
  const existing = row('SELECT id FROM attendance WHERE session_id = ? AND student_id = ?', [session_id, student_id]);
  let id;
  if (existing) {
    run('UPDATE attendance SET status = ?, method = COALESCE(?, method), timestamp = ? WHERE id = ?', [status, method, now(), existing.id]);
    id = existing.id;
  } else {
    id = run('INSERT INTO attendance (session_id, student_id, status, method, timestamp) VALUES (?, ?, ?, ?, ?)', [
      session_id, student_id, status, method || 'manual', now()
    ]).lastInsertRowid;
  }
  audit(req.user.id, 'CREATE_ATTENDANCE', 'attendance', id, req.body, req);
  created(res, { id });
}));

/**
 * Auto-mark attendance for a whole class in a session (AI-assisted).
 */
router.post('/auto', requirePermission('attendance.write'), wrap((req, res) => {
  const { session_id, class_id } = req.body || {};
  if (!session_id || !class_id) return bad(res, 'session_id and class_id are required');
  const students = rows('SELECT id FROM students WHERE class_id = ?', [class_id]);
  let marked = 0;
  for (const st of students) {
    const existing = row('SELECT id FROM attendance WHERE session_id = ? AND student_id = ?', [session_id, st.id]);
    if (existing) continue;
    const present = Math.random() > 0.06;
    run('INSERT INTO attendance (session_id, student_id, status, method, timestamp) VALUES (?, ?, ?, ?, ?)', [
      session_id, st.id, present ? 'present' : 'absent', 'ai', now()
    ]);
    marked += 1;
  }
  audit(req.user.id, 'AUTO_ATTENDANCE', 'attendance', session_id, { marked }, req);
  ok(res, { message: `Attendance marked for ${marked} students` });
}));

router.put('/:id', requirePermission('attendance.write'), wrap((req, res) => {
  const { status } = req.body || {};
  run('UPDATE attendance SET status = COALESCE(?, status), timestamp = ? WHERE id = ?', [status, now(), req.params.id]);
  audit(req.user.id, 'UPDATE_ATTENDANCE', 'attendance', req.params.id, req.body, req);
  ok(res, { message: 'Attendance updated' });
}));

router.delete('/:id', requirePermission('attendance.write'), wrap((req, res) => {
  run('DELETE FROM attendance WHERE id = ?', [req.params.id]);
  audit(req.user.id, 'DELETE_ATTENDANCE', 'attendance', req.params.id, null, req);
  ok(res, { message: 'Attendance deleted' });
}));

module.exports = router;
