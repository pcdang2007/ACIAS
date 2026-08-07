'use strict';

const { rows, row, run, now } = require('../db/database');
const analytics = require('./analytics');

function periodRange(type, period) {
  if (type === 'lesson' || type === 'day') {
    const d = new Date(period);
    const end = new Date(d);
    end.setDate(end.getDate() + 1);
    return { from: d.toISOString(), to: end.toISOString() };
  }
  if (type === 'week') {
    const [y, w] = period.split('-W').map(Number);
    const jan1 = new Date(y, 0, 1);
    const start = new Date(y, 0, (w - 1) * 7 + 1 - jan1.getDay() + 1);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { from: start.toISOString(), to: end.toISOString() };
  }
  if (type === 'month') {
    const [y, m] = period.split('-').map(Number);
    return { from: new Date(y, m - 1, 1).toISOString(), to: new Date(y, m, 1).toISOString() };
  }
  if (type === 'semester') {
    const [y, s] = period.split('-S').map(Number);
    const from = new Date(y, s === 1 ? 0 : 6, 1).toISOString();
    const to = new Date(y, s === 1 ? 6 : 12, 1).toISOString();
    return { from, to };
  }
  if (type === 'year') {
    const y = Number(period);
    return { from: new Date(y, 0, 1).toISOString(), to: new Date(y, 12, 1).toISOString() };
  }
  return { from: null, to: null };
}

function scopeQuery(scopeType, scopeId) {
  if (scopeType === 'student') {
    return { classId: null, studentId: scopeId };
  }
  if (scopeType === 'class') {
    return { classId: scopeId, studentId: null };
  }
  return { classId: null, studentId: null };
}

function generateReport({ type, scopeType, scopeId, period, userId }) {
  const range = periodRange(type, period);
  const scope = scopeQuery(scopeType, scopeId);

  const indicators = analytics.computeIndicators({ ...scope, from: range.from, to: range.to });
  const trend = analytics.computeTrend({
    classId: scope.classId,
    from: range.from,
    to: range.to,
    unit: type === 'question' ? 'question' : type === 'lesson' || type === 'day' ? 'session' : type
  });

  const students = scope.classId
    ? rows(
        'SELECT s.id, s.student_code, s.full_name FROM students s WHERE s.class_id = ? ORDER BY s.full_name',
        [scope.classId]
      )
    : [];

  let details = null;
  if (scopeType === 'student' && scopeId) {
    details = analytics.detectStudents({ classId: null, from: range.from, to: range.to }).outstanding;
  } else {
    details = analytics.detectStudents({ classId: scope.classId, from: range.from, to: range.to });
  }

  const metrics = { ...indicators, student_count: students.length };
  const title = `${scopeType === 'student' ? 'Student' : scopeType === 'class' ? 'Class' : 'Global'} report - ${type} ${period || ''}`;

  const id = run(
    'INSERT INTO reports (type, scope_type, scope_id, period, title, summary, content, generated_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [type, scopeType, scopeId || null, period || null, title, JSON.stringify(metrics), JSON.stringify({ trend, students, details }), userId || null, now()]
  ).lastInsertRowid;

  analytics.storeStatistics({ period: `${type}:${period || 'all'}`, scope: scopeType || 'global', scopeId: scopeId || 0, metrics });

  return { id, type, scopeType, scopeId, period, title, summary: metrics, content: { trend, students, details } };
}

function listReports() {
  return rows('SELECT * FROM reports ORDER BY id DESC');
}

function getReport(id) {
  const r = row('SELECT * FROM reports WHERE id = ?', [id]);
  if (!r) return null;
  return { ...r, summary: JSON.parse(r.summary || '{}'), content: JSON.parse(r.content || '{}') };
}

module.exports = { generateReport, listReports, getReport, periodRange };
