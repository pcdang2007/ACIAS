'use strict';

const express = require('express');
const { row, rows, run, now } = require('../db/database');
const { authRequired, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { wrap, ok, created, bad, notFound } = require('./helpers');

const router = express.Router();
router.use(authRequired);

router.get('/', requirePermission('appeal.read'), wrap((req, res) => {
  const list = rows(
    `SELECT a.*, st.full_name AS student_name, u.full_name AS submitted_by_name, r.title AS report_title
     FROM appeals a
     LEFT JOIN students st ON st.id = a.student_id
     LEFT JOIN users u ON u.id = a.submitted_by
     LEFT JOIN reports r ON r.id = a.report_id
     ORDER BY a.id DESC`
  );
  let filtered = list;
  if (req.user.role_code === 'PARENT') {
    const student = row('SELECT id FROM students WHERE parent_user_id = ?', [req.user.id]);
    filtered = list.filter((a) => a.student_id === (student && student.id));
  }
  if (req.user.role_code === 'STUDENT') {
    const student = row('SELECT id FROM students WHERE user_id = ?', [req.user.id]);
    filtered = list.filter((a) => a.student_id === (student && student.id));
  }
  ok(res, filtered);
}));

router.post('/', requirePermission('appeal.write'), wrap((req, res) => {
  const { report_id, student_id, reason } = req.body || {};
  if (!reason) return bad(res, 'reason is required');
  const id = run('INSERT INTO appeals (report_id, student_id, submitted_by, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    report_id || null, student_id || null, req.user.id, reason, 'pending', now()
  ]).lastInsertRowid;
  audit(req.user.id, 'CREATE_APPEAL', 'appeal', id, req.body, req);
  created(res, { id });
}));

router.put('/:id', requirePermission('appeal.write'), wrap((req, res) => {
  const { status, resolution } = req.body || {};
  run('UPDATE appeals SET status = COALESCE(?, status), resolution = COALESCE(?, resolution), resolved_by = ?, resolved_at = CASE WHEN COALESCE(?, status) IN (?, ?) THEN COALESCE(resolved_at, ?) ELSE resolved_at END WHERE id = ?', [
    status, resolution, req.user.id, status, 'approved', 'rejected', now(), req.params.id
  ]);
  audit(req.user.id, 'RESOLVE_APPEAL', 'appeal', req.params.id, req.body, req);
  ok(res, { message: 'Appeal updated' });
}));

router.delete('/:id', requirePermission('appeal.write'), wrap((req, res) => {
  run('DELETE FROM appeals WHERE id = ?', [req.params.id]);
  audit(req.user.id, 'DELETE_APPEAL', 'appeal', req.params.id, null, req);
  ok(res, { message: 'Appeal deleted' });
}));

module.exports = router;
