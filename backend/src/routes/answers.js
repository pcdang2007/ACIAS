'use strict';

const express = require('express');
const { row, rows, run, now } = require('../db/database');
const { authRequired, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { wrap, ok, bad, notFound, canAccessStudent } = require('./helpers');

const router = express.Router();
router.use(authRequired);

router.get('/', requirePermission('answer.read'), wrap((req, res) => {
  const { session_id, session_question_id, student_id } = req.query;
  const cond = [];
  const params = [];
  if (session_id) { cond.push('a.session_id = ?'); params.push(session_id); }
  if (session_question_id) { cond.push('a.session_question_id = ?'); params.push(session_question_id); }
  if (student_id) { cond.push('a.student_id = ?'); params.push(student_id); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const list = rows(
    `SELECT a.*, st.full_name, st.student_code, sq.content AS question_content
     FROM answers a
     JOIN students st ON st.id = a.student_id
     LEFT JOIN session_questions sq ON sq.id = a.session_question_id
     ${where} ORDER BY a.id DESC`,
    params
  );
  const accessible = list.filter((a) => canAccessStudent(req.user, a.student_id));
  ok(res, accessible);
}));

router.post('/', requirePermission('answer.write'), wrap((req, res) => {
  const { session_question_id, session_id, student_id, answer_value, is_correct, score, reaction_ms, detection_method, confidence } = req.body || {};
  if (!session_question_id || !student_id) return bad(res, 'session_question_id and student_id are required');
  const id = run(
    'INSERT INTO answers (session_question_id, session_id, student_id, answer_value, is_correct, score, reaction_ms, detection_method, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [session_question_id, session_id || null, student_id, answer_value || null, is_correct ? 1 : 0, score || 0, reaction_ms || null, detection_method || 'manual', confidence || null, now()]
  ).lastInsertRowid;
  audit(req.user.id, 'CREATE_ANSWER', 'answer', id, req.body, req);
  ok(res, { id });
}));

router.put('/:id', requirePermission('answer.write'), wrap((req, res) => {
  const { is_correct, score, answer_value } = req.body || {};
  run('UPDATE answers SET is_correct = COALESCE(?, is_correct), score = COALESCE(?, score), answer_value = COALESCE(?, answer_value) WHERE id = ?', [
    is_correct, score, answer_value, req.params.id
  ]);
  audit(req.user.id, 'UPDATE_ANSWER', 'answer', req.params.id, req.body, req);
  ok(res, { message: 'Answer updated' });
}));

router.delete('/:id', requirePermission('answer.write'), wrap((req, res) => {
  run('DELETE FROM answers WHERE id = ?', [req.params.id]);
  audit(req.user.id, 'DELETE_ANSWER', 'answer', req.params.id, null, req);
  ok(res, { message: 'Answer deleted' });
}));

module.exports = router;
