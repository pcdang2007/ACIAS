'use strict';

const express = require('express');
const { row, rows, run, now, transaction } = require('../db/database');
const { authRequired, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { wrap, ok, created, bad, notFound, canAccessClass } = require('./helpers');

const router = express.Router();
router.use(authRequired);

router.get('/', requirePermission('class.read'), wrap((req, res) => {
  const classes = rows(
    `SELECT c.*, u.full_name AS homeroom_teacher_name
     FROM classes c LEFT JOIN users u ON u.id = c.homeroom_teacher_id ORDER BY c.id`
  );
  const accessible = classes.filter((c) => canAccessClass(req.user, c.id));
  ok(res, accessible);
}));

router.get('/:id', requirePermission('class.read'), wrap((req, res) => {
  const c = row(
    `SELECT c.*, u.full_name AS homeroom_teacher_name
     FROM classes c LEFT JOIN users u ON u.id = c.homeroom_teacher_id WHERE c.id = ?`,
    [req.params.id]
  );
  if (!c) return notFound(res);
  if (!canAccessClass(req.user, c.id)) return res.status(403).json({ error: 'Forbidden: no access to this class' });
  ok(res, c);
}));

router.post('/', requirePermission('class.write'), wrap((req, res) => {
  const { name, grade, room, subjects, homeroom_teacher_id, academic_year } = req.body || {};
  if (!name) return bad(res, 'name is required');
  const id = run('INSERT INTO classes (name, grade, room, subjects, homeroom_teacher_id, academic_year, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    name, grade, room, subjects || null, homeroom_teacher_id || null, academic_year || null, now()
  ]).lastInsertRowid;
  audit(req.user.id, 'CREATE_CLASS', 'class', id, req.body, req);
  created(res, { id });
}));

router.put('/:id', requirePermission('class.write'), wrap((req, res) => {
  const { name, grade, room, subjects, homeroom_teacher_id, academic_year } = req.body || {};
  run('UPDATE classes SET name = COALESCE(?, name), grade = COALESCE(?, grade), room = COALESCE(?, room), subjects = COALESCE(?, subjects), homeroom_teacher_id = ?, academic_year = COALESCE(?, academic_year) WHERE id = ?', [
    name, grade, room, subjects, homeroom_teacher_id ?? row('SELECT homeroom_teacher_id FROM classes WHERE id = ?', [req.params.id]).homeroom_teacher_id, academic_year, req.params.id
  ]);
  audit(req.user.id, 'UPDATE_CLASS', 'class', req.params.id, req.body, req);
  ok(res, { message: 'Class updated' });
}));

router.delete('/:id', requirePermission('class.write'), wrap((req, res) => {
  const c = row('SELECT id FROM classes WHERE id = ?', [req.params.id]);
  if (!c) return notFound(res);
  transaction(() => {
    const students = rows('SELECT id, user_id, parent_user_id FROM students WHERE class_id = ?', [c.id]);
    const linkedUsers = [...new Set(students.flatMap((s) => [s.user_id, s.parent_user_id]).filter((v) => v != null))];
    run('DELETE FROM sessions WHERE class_id = ? OR lesson_id IN (SELECT id FROM lessons WHERE class_id = ?)', [c.id, c.id]);
    run('DELETE FROM lessons WHERE class_id = ?', [c.id]);
    run('DELETE FROM seats WHERE class_id = ?', [c.id]);
    run('DELETE FROM seat_history WHERE class_id = ?', [c.id]);
    run('DELETE FROM answers WHERE student_id IN (SELECT id FROM students WHERE class_id = ?)', [c.id]);
    run('DELETE FROM interactions WHERE student_id IN (SELECT id FROM students WHERE class_id = ?)', [c.id]);
    run('DELETE FROM attendance WHERE student_id IN (SELECT id FROM students WHERE class_id = ?)', [c.id]);
    run('UPDATE appeals SET student_id = NULL WHERE student_id IN (SELECT id FROM students WHERE class_id = ?)', [c.id]);
    run('UPDATE users SET student_id = NULL WHERE student_id IN (SELECT id FROM students WHERE class_id = ?)', [c.id]);
    run('DELETE FROM students WHERE class_id = ?', [c.id]);
    if (linkedUsers.length) {
      const marks = linkedUsers.map(() => '?').join(',');
      run(`DELETE FROM users WHERE id IN (${marks}) AND id NOT IN (
            SELECT user_id FROM students WHERE user_id IS NOT NULL
            UNION
            SELECT parent_user_id FROM students WHERE parent_user_id IS NOT NULL
          )`, linkedUsers);
    }
    run('UPDATE users SET class_id = NULL WHERE class_id = ?', [c.id]);
    run('DELETE FROM classes WHERE id = ?', [c.id]);
  });
  audit(req.user.id, 'DELETE_CLASS', 'class', c.id, null, req);
  ok(res, { message: 'Class deleted' });
}));

module.exports = router;
