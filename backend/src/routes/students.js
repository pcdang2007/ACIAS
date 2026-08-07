'use strict';

const express = require('express');
const { row, rows, run, now, transaction } = require('../db/database');
const { authRequired, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { wrap, ok, created, bad, notFound, canAccessClass, canAccessStudent } = require('./helpers');

const router = express.Router();
router.use(authRequired);

router.get('/', requirePermission('student.read'), wrap((req, res) => {
  const { class_id } = req.query;
  const cond = [];
  const params = [];
  if (class_id) { cond.push('s.class_id = ?'); params.push(class_id); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const students = rows(
    `SELECT s.*, c.name AS class_name, u.full_name AS account_name,
            pu.full_name AS parent_name
     FROM students s
     LEFT JOIN classes c ON c.id = s.class_id
     LEFT JOIN users u ON u.id = s.user_id
     LEFT JOIN users pu ON pu.id = s.parent_user_id
     ${where} ORDER BY s.full_name`,
    params
  );
  const accessible = students.filter((s) => canAccessStudent(req.user, s.id));
  ok(res, accessible);
}));

router.get('/:id', requirePermission('student.read'), wrap((req, res) => {
  const s = row(
    `SELECT s.*, c.name AS class_name, u.full_name AS account_name, pu.full_name AS parent_name
     FROM students s
     LEFT JOIN classes c ON c.id = s.class_id
     LEFT JOIN users u ON u.id = s.user_id
     LEFT JOIN users pu ON pu.id = s.parent_user_id
     WHERE s.id = ?`,
    [req.params.id]
  );
  if (!s) return notFound(res);
  if (!canAccessStudent(req.user, s.id)) return res.status(403).json({ error: 'Forbidden' });
  ok(res, s);
}));

router.post('/', requirePermission('student.write'), wrap((req, res) => {
  const { student_code, full_name, gender, birth_date, class_id, notes } = req.body || {};
  if (!student_code || !full_name || !class_id) return bad(res, 'student_code, full_name, class_id are required');
  if (row('SELECT 1 AS ok FROM students WHERE student_code = ?', [student_code])) return bad(res, 'student_code already exists');
  const id = run('INSERT INTO students (student_code, full_name, gender, birth_date, class_id, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    student_code, full_name, gender, birth_date, class_id, notes, now()
  ]).lastInsertRowid;
  audit(req.user.id, 'CREATE_STUDENT', 'student', id, req.body, req);
  created(res, { id });
}));

router.put('/:id', requirePermission('student.write'), wrap((req, res) => {
  const { student_code, full_name, gender, birth_date, class_id, notes } = req.body || {};
  run('UPDATE students SET student_code = COALESCE(?, student_code), full_name = COALESCE(?, full_name), gender = COALESCE(?, gender), birth_date = COALESCE(?, birth_date), class_id = COALESCE(?, class_id), notes = COALESCE(?, notes) WHERE id = ?', [
    student_code, full_name, gender, birth_date, class_id, notes, req.params.id
  ]);
  audit(req.user.id, 'UPDATE_STUDENT', 'student', req.params.id, req.body, req);
  ok(res, { message: 'Student updated' });
}));

router.delete('/:id', requirePermission('student.write'), wrap((req, res) => {
  const s = row('SELECT id, user_id, parent_user_id FROM students WHERE id = ?', [req.params.id]);
  if (!s) return notFound(res);
  const linked = [s.user_id, s.parent_user_id].filter((v) => v != null);
  transaction(() => {
    run('DELETE FROM seats WHERE student_id = ?', [s.id]);
    run('DELETE FROM seat_history WHERE student_id = ?', [s.id]);
    run('DELETE FROM answers WHERE student_id = ?', [s.id]);
    run('DELETE FROM interactions WHERE student_id = ?', [s.id]);
    run('DELETE FROM attendance WHERE student_id = ?', [s.id]);
    run('UPDATE appeals SET student_id = NULL WHERE student_id = ?', [s.id]);
    run('UPDATE users SET student_id = NULL WHERE student_id = ?', [s.id]);
    run('DELETE FROM students WHERE id = ?', [s.id]);
    if (linked.length) {
      const marks = linked.map(() => '?').join(',');
      run(`DELETE FROM users WHERE id IN (${marks}) AND id NOT IN (
            SELECT user_id FROM students WHERE user_id IS NOT NULL
            UNION
            SELECT parent_user_id FROM students WHERE parent_user_id IS NOT NULL
          )`, linked);
    }
  });
  audit(req.user.id, 'DELETE_STUDENT', 'student', s.id, null, req);
  ok(res, { message: 'Student deleted' });
}));

/**
 * Import students from Excel/CSV (spec section II.B).
 * Accepted columns: student_code, full_name, gender, birth_date, class_id, notes
 */
router.post('/import', requirePermission('student.write'), wrap((req, res) => {
  const importer = require('../services/importer');
  const body = req.body || {};
  const result = body.rows ? importer.importStudents(body.rows, req) : importer.importStudents(body, req);
  audit(req.user.id, 'IMPORT_STUDENTS', 'student', null, { imported: result.imported, updated: result.updated, moved: result.moved, failed: result.failed.length }, req);
  ok(res, result);
}));

module.exports = router;
