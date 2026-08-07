'use strict';

const express = require('express');
const { row, rows, run, now } = require('../db/database');
const { authRequired, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { wrap, ok, created, bad, notFound, canAccessClass } = require('./helpers');
const engine = require('../ai/engine');
const scoring = require('../services/scoring');

const router = express.Router();
router.use(authRequired);

const SESSION_DETAIL = `
  SELECT s.*, l.title AS lesson_title, c.name AS class_name, su.name AS subject_name,
         t.full_name AS teacher_name, d.name AS device_name
  FROM sessions s
  LEFT JOIN lessons l ON l.id = s.lesson_id
  LEFT JOIN classes c ON c.id = s.class_id
  LEFT JOIN subjects su ON su.id = s.subject_id
  LEFT JOIN users t ON t.id = s.teacher_id
  LEFT JOIN devices d ON d.id = s.device_id
`;

router.get('/', requirePermission('session.read'), wrap((req, res) => {
  const sessions = rows(`${SESSION_DETAIL} ORDER BY s.id DESC`);
  const accessible = sessions.filter((s) => canAccessClass(req.user, s.class_id));
  ok(res, accessible);
}));

router.get('/:id', requirePermission('session.read'), wrap((req, res) => {
  const s = row(`${SESSION_DETAIL} WHERE s.id = ?`, [req.params.id]);
  if (!s) return notFound(res);
  if (!canAccessClass(req.user, s.class_id)) return res.status(403).json({ error: 'Forbidden' });
  ok(res, s);
}));

router.post('/', requirePermission('session.write'), wrap((req, res) => {
  const { lesson_id, teacher_id, class_id, subject_id, device_id, notes, status } = req.body || {};
  if (!class_id) return bad(res, 'class_id is required');
  if (!canAccessClass(req.user, class_id)) return res.status(403).json({ error: 'Forbidden' });
  const id = run('INSERT INTO sessions (lesson_id, teacher_id, class_id, subject_id, device_id, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    lesson_id || null,
    teacher_id || req.user.id,
    class_id,
    subject_id || null,
    device_id || null,
    status || 'idle',
    notes || null,
    now()
  ]).lastInsertRowid;
  audit(req.user.id, 'CREATE_SESSION', 'session', id, req.body, req);
  created(res, { id });
}));

router.put('/:id', requirePermission('session.write'), wrap((req, res) => {
  const { lesson_id, subject_id, device_id, notes, status } = req.body || {};
  run('UPDATE sessions SET lesson_id = ?, subject_id = ?, device_id = ?, notes = ?, status = COALESCE(?, status) WHERE id = ?', [
    lesson_id, subject_id, device_id, notes, status, req.params.id
  ]);
  audit(req.user.id, 'UPDATE_SESSION', 'session', req.params.id, req.body, req);
  ok(res, { message: 'Session updated' });
}));

router.post('/:id/start', requirePermission('session.write'), wrap((req, res) => {
  const s = row('SELECT * FROM sessions WHERE id = ?', [req.params.id]);
  if (!s) return notFound(res);
  run("UPDATE sessions SET status = 'live', start_time = COALESCE(start_time, ?) WHERE id = ?", [now(), req.params.id]);
  engine.startSessionSimulator(req.params.id);
  const summary = buildLiveSummary(req.params.id);
  audit(req.user.id, 'START_SESSION', 'session', req.params.id, null, req);
  ok(res, { message: 'Session started', summary });
}));

router.post('/:id/end', requirePermission('session.write'), wrap((req, res) => {
  const s = row('SELECT * FROM sessions WHERE id = ?', [req.params.id]);
  if (!s) return notFound(res);
  engine.stopSessionSimulator(req.params.id);
  run("UPDATE sessions SET status = 'ended', end_time = ? WHERE id = ?", [now(), req.params.id]);
  run("UPDATE session_questions SET status = 'closed', ended_at = ? WHERE session_id = ? AND status = 'open'", [now(), req.params.id]);
  audit(req.user.id, 'END_SESSION', 'session', req.params.id, null, req);
  ok(res, { message: 'Session ended' });
}));

router.get('/:id/live', requirePermission('session.read'), wrap((req, res) => {
  ok(res, buildLiveSummary(req.params.id));
}));

// ---- Session questions ----
router.get('/:id/questions', requirePermission('session.read'), wrap((req, res) => {
  ok(res, rows('SELECT * FROM session_questions WHERE session_id = ? ORDER BY id', [req.params.id]));
}));

router.post('/:id/questions', requirePermission('session.write'), wrap((req, res) => {
  const { question_id, points, recognition_mode, duration, content, type } = req.body || {};
  let src = null;
  if (question_id) {
    src = row('SELECT * FROM questions WHERE id = ?', [question_id]);
  }
  const id = run(
    'INSERT INTO session_questions (session_id, question_id, type, content, points, recognition_mode, started_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      req.params.id,
      question_id || null,
      type || (src && src.type) || 'multiple_choice',
      content || (src && src.content) || 'New question',
      points || (src && src.points) || 10,
      recognition_mode || '1',
      now(),
      'open'
    ]
  ).lastInsertRowid;
  audit(req.user.id, 'ADD_SESSION_QUESTION', 'session_question', id, req.body, req);
  const question = row('SELECT * FROM session_questions WHERE id = ?', [id]);
  const suggestions = scoring.computeSuggestions({
    classId: req.query.class_id || null,
    sessionId: req.params.id,
    questionPoints: question.points
  });
  created(res, { id, question, suggestions });
}));

router.put('/questions/:qid', requirePermission('session.write'), wrap((req, res) => {
  const { recognition_mode, points, status } = req.body || {};
  run('UPDATE session_questions SET recognition_mode = COALESCE(?, recognition_mode), points = COALESCE(?, points), status = COALESCE(?, status) WHERE id = ?', [
    recognition_mode, points, status, req.params.qid
  ]);
  audit(req.user.id, 'UPDATE_SESSION_QUESTION', 'session_question', req.params.qid, req.body, req);
  ok(res, { message: 'Session question updated' });
}));

router.post('/questions/:qid/close', requirePermission('session.write'), wrap((req, res) => {
  run("UPDATE session_questions SET status = 'closed', ended_at = ? WHERE id = ?", [now(), req.params.qid]);
  audit(req.user.id, 'CLOSE_SESSION_QUESTION', 'session_question', req.params.qid, null, req);
  ok(res, { message: 'Question closed' });
}));

// ---- Answers & suggestions for a question ----
router.get('/questions/:qid/answers', requirePermission('answer.read'), wrap((req, res) => {
  const list = rows(
    `SELECT a.*, st.full_name, st.student_code, st.class_id
     FROM answers a JOIN students st ON st.id = a.student_id
     WHERE a.session_question_id = ? ORDER BY a.reaction_ms`,
    [req.params.qid]
  );
  ok(res, list);
}));

router.get('/questions/:qid/suggestions', requirePermission('ai.run'), wrap((req, res) => {
  const q = row('SELECT * FROM session_questions WHERE id = ?', [req.params.qid]);
  if (!q) return notFound(res);
  const session = row('SELECT * FROM sessions WHERE id = ?', [q.session_id]);
  const suggestions = scoring.computeSuggestions({
    classId: session.class_id,
    sessionId: q.session_id,
    questionPoints: q.points
  });
  ok(res, suggestions);
}));

router.delete('/:id', requirePermission('session.write'), wrap((req, res) => {
  run('DELETE FROM sessions WHERE id = ?', [req.params.id]);
  audit(req.user.id, 'DELETE_SESSION', 'session', req.params.id, null, req);
  ok(res, { message: 'Session deleted' });
}));

function buildLiveSummary(sessionId) {
  const session = row(`${SESSION_DETAIL} WHERE s.id = ?`, [sessionId]);
  if (!session) return null;
  const stats = row(
    `SELECT COUNT(*) AS answers, SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct,
            COUNT(DISTINCT student_id) AS answering_students,
            AVG(CASE WHEN reaction_ms > 0 THEN reaction_ms END) AS avg_rt
     FROM answers WHERE session_id = ?`,
    [sessionId]
  );
  const interactions = row(
    `SELECT COUNT(*) AS total, COUNT(DISTINCT student_id) AS students,
            SUM(CASE WHEN type = 'speech' THEN 1 ELSE 0 END) AS speech,
            SUM(CASE WHEN type = 'raise_hand' THEN 1 ELSE 0 END) AS raises
     FROM interactions WHERE session_id = ?`,
    [sessionId]
  );
  const question = row(
    "SELECT * FROM session_questions WHERE session_id = ? AND status = 'open' ORDER BY id LIMIT 1",
    [sessionId]
  );
  return {
    session,
    live_stats: {
      total_answers: stats ? stats.answers : 0,
      correct_answers: stats ? stats.correct : 0,
      correct_rate: stats && stats.answers ? Math.round((stats.correct / stats.answers) * 1000) / 10 : 0,
      answering_students: stats ? stats.answering_students : 0,
      avg_reaction_ms: stats && stats.avg_rt ? Math.round(stats.avg_rt) : 0,
      total_interactions: interactions ? interactions.total : 0,
      speech_events: interactions ? interactions.speech : 0,
      hand_raises: interactions ? interactions.raises : 0
    },
    open_question: question
  };
}

module.exports = router;
