'use strict';

const express = require('express');
const { rows } = require('../db/database');
const { authRequired, requirePermission } = require('../middleware/auth');
const { wrap, ok, bad, notFound } = require('./helpers');
const analytics = require('../services/analytics');

const router = express.Router();
router.use(authRequired);

/**
 * Key indicators for a class/student/global scope (spec section IV).
 * Query params: class_id, student_id, session_id, from, to
 */
router.get('/indicators', requirePermission('statistic.read'), wrap((req, res) => {
  const { class_id, student_id, session_id, from, to } = req.query;
  ok(res, analytics.computeIndicators({
    classId: class_id ? Number(class_id) : null,
    studentId: student_id ? Number(student_id) : null,
    sessionId: session_id ? Number(session_id) : null,
    from,
    to
  }));
}));

/**
 * Trends over time by bucket: session|day|week|month|question
 */
router.get('/trend', requirePermission('statistic.read'), wrap((req, res) => {
  const { class_id, session_id, metric, unit, from, to } = req.query;
  ok(res, analytics.computeTrend({
    classId: class_id ? Number(class_id) : null,
    sessionId: session_id ? Number(session_id) : null,
    metric: metric || 'correct_answer_rate',
    unit: unit || 'session',
    from,
    to
  }));
}));

/**
 * Automatic detection: low interaction, consistently incorrect,
 * decreasing interaction, outstanding students.
 */
router.get('/detect', requirePermission('statistic.read'), wrap((req, res) => {
  const { class_id, from, to } = req.query;
  ok(res, analytics.detectStudents({
    classId: class_id ? Number(class_id) : null,
    from,
    to
  }));
}));

router.get('/student/:studentId', requirePermission('statistic.read'), wrap((req, res) => {
  const { from, to } = req.query;
  const indicators = analytics.computeIndicators({ studentId: Number(req.params.studentId), from, to });
  const detail = rows(
    `SELECT a.session_id, a.answer_value, a.is_correct, a.score, a.reaction_ms,
            a.created_at, sq.content, sq.points
     FROM answers a LEFT JOIN session_questions sq ON sq.id = a.session_question_id
     WHERE a.student_id = ? ORDER BY a.created_at DESC LIMIT 50`,
    [req.params.studentId]
  );
  ok(res, { indicators, recent_answers: detail });
}));

router.get('/saved', requirePermission('statistic.read'), wrap((req, res) => {
  const { period, scope, scope_id } = req.query;
  const cond = [];
  const params = [];
  if (period) { cond.push('period = ?'); params.push(period); }
  if (scope) { cond.push('scope = ?'); params.push(scope); }
  if (scope_id) { cond.push('scope_id = ?'); params.push(scope_id); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  ok(res, rows(`SELECT * FROM statistics ${where} ORDER BY metric`, params));
}));

module.exports = router;
