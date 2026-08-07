'use strict';

const express = require('express');
const { row, rows, run, now, transaction } = require('../db/database');
const { authRequired, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { wrap, ok, created, bad, notFound, canAccessClass } = require('./helpers');

const router = express.Router();
router.use(authRequired);

router.get('/', requirePermission('lesson.read'), wrap((req, res) => {
  const lessons = rows(
    `SELECT l.*, s.name AS subject_name, c.name AS class_name, u.full_name AS teacher_name
     FROM lessons l
     LEFT JOIN subjects s ON s.id = l.subject_id
     LEFT JOIN classes c ON c.id = l.class_id
     LEFT JOIN users u ON u.id = l.teacher_id
     ORDER BY l.id DESC`
  );
  ok(res, lessons);
}));

router.get('/:id', requirePermission('lesson.read'), wrap((req, res) => {
  const l = row(
    `SELECT l.*, s.name AS subject_name, c.name AS class_name, u.full_name AS teacher_name
     FROM lessons l
     LEFT JOIN subjects s ON s.id = l.subject_id
     LEFT JOIN classes c ON c.id = l.class_id
     LEFT JOIN users u ON u.id = l.teacher_id
     WHERE l.id = ?`,
    [req.params.id]
  );
  if (!l) return notFound(res);
  ok(res, l);
}));

router.post('/', requirePermission('lesson.write'), wrap((req, res) => {
  const { code, title, subject_id, teacher_id, class_id, scheduled_at, status } = req.body || {};
  if (!title) return bad(res, 'title is required');
  const id = run('INSERT INTO lessons (code, title, subject_id, teacher_id, class_id, scheduled_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    code || `L-${Date.now()}`, title, subject_id || null, teacher_id || req.user.id, class_id || null, scheduled_at || null, status || 'scheduled', now()
  ]).lastInsertRowid;
  audit(req.user.id, 'CREATE_LESSON', 'lesson', id, req.body, req);
  created(res, { id });
}));

router.put('/:id', requirePermission('lesson.write'), wrap((req, res) => {
  const existing = row('SELECT * FROM lessons WHERE id = ?', [req.params.id]);
  if (!existing) return notFound(res);
  const b = req.body || {};
  const code = b.code !== undefined ? b.code : existing.code;
  const title = b.title !== undefined ? b.title : existing.title;
  const subject_id = b.subject_id !== undefined ? b.subject_id : existing.subject_id;
  const teacher_id = b.teacher_id !== undefined ? b.teacher_id : existing.teacher_id;
  const class_id = b.class_id !== undefined ? b.class_id : existing.class_id;
  const scheduled_at = b.scheduled_at !== undefined ? b.scheduled_at : existing.scheduled_at;
  const status = b.status !== undefined ? b.status : existing.status;
  run('UPDATE lessons SET code = ?, title = ?, subject_id = ?, teacher_id = ?, class_id = ?, scheduled_at = ?, status = ? WHERE id = ?', [
    code, title, subject_id, teacher_id, class_id, scheduled_at, status, req.params.id
  ]);
  audit(req.user.id, 'UPDATE_LESSON', 'lesson', req.params.id, req.body, req);
  ok(res, { message: 'Lesson updated' });
}));

router.delete('/:id', requirePermission('lesson.write'), wrap((req, res) => {
  const l = row('SELECT id FROM lessons WHERE id = ?', [req.params.id]);
  if (!l) return notFound(res);
  transaction(() => {
    run('DELETE FROM sessions WHERE lesson_id = ?', [l.id]);
    run('DELETE FROM lessons WHERE id = ?', [l.id]);
  });
  audit(req.user.id, 'DELETE_LESSON', 'lesson', l.id, null, req);
  ok(res, { message: 'Lesson deleted' });
}));

module.exports = router;
