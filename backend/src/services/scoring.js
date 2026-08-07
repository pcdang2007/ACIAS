'use strict';

const { rows } = require('../db/database');

/**
 * Implements the ACIAS call-to-answer prioritization algorithm (spec section III.C).
 *
 * Sets:
 *   X  - participation frequency (times a student has spoken/answered)
 *   Y  - current capability (accuracy of a student)
 *   Z  - reaction speed (ms) - lower is better
 *
 * Mapped into [0,1] using the min-max formulas:
 *   X'_i = (max(X) - X_i) / (max(X) - min(X))     (low participation -> high X')
 *   Y'_i = (Y_i - min(Y)) / (max(Y) - min(Y))     (good capability -> high Y')
 *   Z'_i = (max(Z) - Z_i) / (max(Z) - min(Z))     (fast reaction -> high Z')
 *
 * Score:
 *   S_i = alpha*Z'_i + beta*X'_i
 *         + gamma*(A/Amax)*Y'_i
 *         + delta*((1 - A)/Amax)*(1 - Y'_i)
 *
 * where A = points of the current question, Amax = maximum possible points.
 * Default weights: alpha=0.3, beta=0.3, gamma=0.2, delta=0.2.
 */
function minMaxNormalize(values) {
  const nums = values.filter((v) => v != null);
  if (nums.length === 0) return {};
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  const range = max - min;
  const map = {};
  values.forEach((v, i) => {
    if (v == null) map[i] = null;
    else map[i] = range === 0 ? 0.5 : (v - min) / range;
  });
  return map;
}

function normalizeInverted(values) {
  const nums = values.filter((v) => v != null);
  if (nums.length === 0) return {};
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  const range = max - min;
  const map = {};
  values.forEach((v, i) => {
    if (v == null) map[i] = null;
    else map[i] = range === 0 ? 0.5 : (max - v) / range;
  });
  return map;
}

/**
 * Build per-student statistics used by the scoring model.
 * @param {number} classId class scope
 * @param {number} sessionId optional - restrict to a session
 */
function studentMetrics(classId, sessionId) {
  const where = [];
  const params = [];
  if (classId) {
    where.push('st.class_id = ?');
    params.push(classId);
  }
  if (sessionId) {
    where.push('a.session_id = ?');
    params.push(sessionId);
  }
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const answerStats = rows(
    `SELECT a.student_id,
            COUNT(*) AS answer_count,
            SUM(CASE WHEN a.is_correct = 1 THEN 1 ELSE 0 END) AS correct_count,
            AVG(CASE WHEN a.reaction_ms > 0 THEN a.reaction_ms END) AS avg_reaction_ms
     FROM answers a
     JOIN students st ON st.id = a.student_id
     ${cond}
     GROUP BY a.student_id`,
    params
  );

  const speechCounts = sessionId
    ? rows(
        `SELECT student_id, COUNT(*) AS c FROM interactions WHERE session_id = ? AND type = 'speech' GROUP BY student_id`,
        [sessionId]
      )
    : [];

  const students = rows('SELECT id FROM students WHERE class_id = ?', [classId || -1]);
  const map = {};
  for (const s of students) {
    map[s.id] = {
      student_id: s.id,
      participation: 0,
      correct_count: 0,
      answer_count: 0,
      accuracy: 0.5,
      avg_reaction_ms: null,
      reaction_score: null
    };
  }
  for (const a of answerStats) {
    const entry = map[a.student_id];
    if (!entry) continue;
    entry.answer_count = a.answer_count;
    entry.correct_count = a.correct_count;
    entry.accuracy = a.answer_count ? a.correct_count / a.answer_count : 0.5;
    entry.avg_reaction_ms = a.avg_reaction_ms;
  }
  for (const s of speechCounts) {
    if (map[s.student_id]) map[s.student_id].participation = s.c;
  }
  return map;
}

/**
 * Compute suggestion scores for the current question.
 * @param {object} opts { classId, sessionId, questionPoints, amax, weights }
 * @returns array of suggestions sorted desc by S
 */
function computeSuggestions({ classId, sessionId, questionPoints, amax, weights }) {
  const alpha = (weights && weights.alpha) || 0.3;
  const beta = (weights && weights.beta) || 0.3;
  const gamma = (weights && weights.gamma) || 0.2;
  const delta = (weights && weights.delta) || 0.2;
  const A = questionPoints || amax || 10;
  const Amax = amax || Math.max(A, 10);

  const metrics = studentMetrics(classId, sessionId);
  const ids = Object.keys(metrics).map(Number);
  if (ids.length === 0) return [];

  const X = ids.map((id) => metrics[id].participation);
  const Y = ids.map((id) => metrics[id].accuracy);
  const Z = ids.map((id) => metrics[id].avg_reaction_ms ?? null);

  const Xn = normalizeInverted(X); // low participation -> high X'
  const Yn = minMaxNormalize(Y); // good capability -> high Y'
  const Zn = normalizeInverted(Z); // fast reaction -> high Z'

  const aRatio = A / Amax;

  const results = ids.map((id, i) => {
    const x1 = Xn[i] ?? 0.5;
    const y1 = Yn[i] ?? 0.5;
    const z1 = Zn[i] ?? 0.5;
    const S =
      alpha * z1 +
      beta * x1 +
      gamma * aRatio * y1 +
      delta * (1 - aRatio) * (1 - y1);
    const m = metrics[id];
    return {
      student_id: id,
      score: Math.round(S * 1000) / 1000,
      participation_frequency: m.participation,
      accuracy: Math.round(m.accuracy * 1000) / 1000,
      avg_reaction_ms: m.avg_reaction_ms ? Math.round(m.avg_reaction_ms) : null,
      X_prime: Math.round(x1 * 1000) / 1000,
      Y_prime: Math.round(y1 * 1000) / 1000,
      Z_prime: Math.round(z1 * 1000) / 1000
    };
  });

  results.sort((a, b) => b.score - a.score);
  return results.map((r, idx) => ({ ...r, rank: idx + 1 }));
}

module.exports = { computeSuggestions, studentMetrics, minMaxNormalize, normalizeInverted };
