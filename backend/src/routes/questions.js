'use strict';

const express = require('express');
const { row, rows, run, now, transaction } = require('../db/database');
const { authRequired, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { wrap, ok, created, bad, notFound } = require('./helpers');

const router = express.Router();
router.use(authRequired);

function parseQ(q) {
  if (!q) return q;
  const copy = { ...q };
  try { copy.choices = JSON.parse(q.choices || '[]'); } catch { copy.choices = []; }
  try { copy.keywords = JSON.parse(q.keywords || '[]'); } catch { copy.keywords = []; }
  return copy;
}

// ---- Question Banks ----
router.get('/banks', requirePermission('question.read'), wrap((req, res) => {
  const banks = rows('SELECT * FROM question_banks ORDER BY id');
  ok(res, banks.map((b) => ({ ...b, question_count: row('SELECT COUNT(*) AS c FROM questions WHERE bank_id = ?', [b.id]).c })));
}));

router.post('/banks', requirePermission('question.write'), wrap((req, res) => {
  const { name, description, subject_id } = req.body || {};
  if (!name) return bad(res, 'name is required');
  const id = run('INSERT INTO question_banks (name, description, subject_id, owner_id, created_at) VALUES (?, ?, ?, ?, ?)', [
    name, description, subject_id || null, req.user.id, now()
  ]).lastInsertRowid;
  audit(req.user.id, 'CREATE_QUESTION_BANK', 'question_bank', id, req.body, req);
  created(res, { id });
}));

router.put('/banks/:id', requirePermission('question.write'), wrap((req, res) => {
  const existing = row('SELECT * FROM question_banks WHERE id = ?', [req.params.id]);
  if (!existing) return notFound(res);
  const b = req.body || {};
  const name = b.name !== undefined ? b.name : existing.name;
  const description = b.description !== undefined ? b.description : existing.description;
  const subject_id = b.subject_id !== undefined ? b.subject_id : existing.subject_id;
  run('UPDATE question_banks SET name = ?, description = ?, subject_id = ? WHERE id = ?', [
    name, description, subject_id, req.params.id
  ]);
  audit(req.user.id, 'UPDATE_QUESTION_BANK', 'question_bank', req.params.id, req.body, req);
  ok(res, { message: 'Question bank updated' });
}));

router.delete('/banks/:id', requirePermission('question.write'), wrap((req, res) => {
  const b = row('SELECT id FROM question_banks WHERE id = ?', [req.params.id]);
  if (!b) return notFound(res);
  transaction(() => {
    run('UPDATE session_questions SET question_id = NULL WHERE question_id IN (SELECT id FROM questions WHERE bank_id = ?)', [b.id]);
    run('DELETE FROM question_banks WHERE id = ?', [b.id]);
  });
  audit(req.user.id, 'DELETE_QUESTION_BANK', 'question_bank', b.id, null, req);
  ok(res, { message: 'Question bank deleted' });
}));

// ---- Questions ----
router.get('/', requirePermission('question.read'), wrap((req, res) => {
  const { bank_id, subject_id, type, difficulty } = req.query;
  const cond = [];
  const params = [];
  if (bank_id) { cond.push('q.bank_id = ?'); params.push(bank_id); }
  if (subject_id) { cond.push('q.subject_id = ?'); params.push(subject_id); }
  if (type) { cond.push('q.type = ?'); params.push(type); }
  if (difficulty) { cond.push('q.difficulty = ?'); params.push(difficulty); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const qs = rows(
    `SELECT q.*, b.name AS bank_name, s.name AS subject_name
     FROM questions q
     LEFT JOIN question_banks b ON b.id = q.bank_id
     LEFT JOIN subjects s ON s.id = q.subject_id
     ${where} ORDER BY q.id`,
    params
  );
  ok(res, qs.map(parseQ));
}));

router.get('/:id', requirePermission('question.read'), wrap((req, res) => {
  const q = row('SELECT * FROM questions WHERE id = ?', [req.params.id]);
  if (!q) return notFound(res);
  ok(res, parseQ(q));
}));

router.post('/', requirePermission('question.write'), wrap((req, res) => {
  const { bank_id, type, content, answer, choices, difficulty, subject_id, duration, points, keywords } = req.body || {};
  if (!bank_id || !type || !content) return bad(res, 'bank_id, type, content are required');
  if (!['multiple_choice', 'true_false', 'short_answer'].includes(type)) return bad(res, 'invalid question type');
  const id = run(
    'INSERT INTO questions (bank_id, type, content, answer, choices, difficulty, subject_id, duration, points, keywords, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [bank_id, type, content, answer || null, choices ? JSON.stringify(choices) : null, difficulty || 1, subject_id || null, duration || 10, points || 10, keywords ? JSON.stringify(keywords) : null, req.user.id, now()]
  ).lastInsertRowid;
  audit(req.user.id, 'CREATE_QUESTION', 'question', id, req.body, req);
  created(res, { id });
}));

router.put('/:id', requirePermission('question.write'), wrap((req, res) => {
  const existing = row('SELECT * FROM questions WHERE id = ?', [req.params.id]);
  if (!existing) return notFound(res);
  const b = req.body || {};
  const type = b.type !== undefined ? b.type : existing.type;
  const content = b.content !== undefined ? b.content : existing.content;
  const answer = b.answer !== undefined ? b.answer : existing.answer;
  const choices = b.choices !== undefined ? (Array.isArray(b.choices) ? JSON.stringify(b.choices) : b.choices) : existing.choices;
  const difficulty = b.difficulty !== undefined ? b.difficulty : existing.difficulty;
  const subject_id = b.subject_id !== undefined ? b.subject_id : existing.subject_id;
  const duration = b.duration !== undefined ? b.duration : existing.duration;
  const points = b.points !== undefined ? b.points : existing.points;
  const keywords = b.keywords !== undefined ? (Array.isArray(b.keywords) ? JSON.stringify(b.keywords) : b.keywords) : existing.keywords;
  run(
    'UPDATE questions SET type = ?, content = ?, answer = ?, choices = ?, difficulty = ?, subject_id = ?, duration = ?, points = ?, keywords = ? WHERE id = ?',
    [type, content, answer, choices, difficulty, subject_id, duration, points, keywords, req.params.id]
  );
  audit(req.user.id, 'UPDATE_QUESTION', 'question', req.params.id, req.body, req);
  ok(res, { message: 'Question updated' });
}));

router.delete('/:id', requirePermission('question.write'), wrap((req, res) => {
  const q = row('SELECT id FROM questions WHERE id = ?', [req.params.id]);
  if (!q) return notFound(res);
  run('UPDATE session_questions SET question_id = NULL WHERE question_id = ?', [q.id]);
  run('DELETE FROM questions WHERE id = ?', [q.id]);
  audit(req.user.id, 'DELETE_QUESTION', 'question', q.id, null, req);
  ok(res, { message: 'Question deleted' });
}));

module.exports = router;
