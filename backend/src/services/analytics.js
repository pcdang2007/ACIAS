'use strict';

const { rows, row, run, now } = require('../db/database');

function numeric(v, def = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
}

function round(v, d = 2) {
  return Math.round(v * 10 ** d) / 10 ** d;
}

/**
 * Aggregate per-student metrics within a session/class scope.
 */
function perStudentMetrics({ classId, sessionId, from, to }) {
  const cond = [];
  const params = [];
  if (classId) { cond.push('st.class_id = ?'); params.push(classId); }
  if (sessionId) { cond.push('a.session_id = ?'); params.push(sessionId); }
  if (from) { cond.push('a.created_at >= ?'); params.push(from); }
  if (to) { cond.push('a.created_at <= ?'); params.push(to); }
  const c = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

  const ans = rows(
    `SELECT a.student_id,
            COUNT(*) AS answer_count,
            SUM(CASE WHEN a.is_correct = 1 THEN 1 ELSE 0 END) AS correct_count,
            AVG(CASE WHEN a.reaction_ms > 0 THEN a.reaction_ms END) AS avg_rt
     FROM answers a JOIN students st ON st.id = a.student_id ${c}
     GROUP BY a.student_id`,
    params
  );

  const intCond = [];
  const intParams = [];
  if (classId) { intCond.push('st.class_id = ?'); intParams.push(classId); }
  if (sessionId) { intCond.push('i.session_id = ?'); intParams.push(sessionId); }
  if (from) { intCond.push('i.timestamp >= ?'); intParams.push(from); }
  if (to) { intCond.push('i.timestamp <= ?'); intParams.push(to); }
  const ic = intCond.length ? `WHERE ${intCond.join(' AND ')}` : '';

  const ints = rows(
    `SELECT i.student_id,
            COUNT(*) AS interaction_count,
            SUM(CASE WHEN i.type = 'speech' THEN 1 ELSE 0 END) AS speech_count,
            SUM(CASE WHEN i.type = 'raise_hand' THEN 1 ELSE 0 END) AS raise_count,
            MIN(i.timestamp) AS first_ts,
            MAX(i.timestamp) AS last_ts
     FROM interactions i JOIN students st ON st.id = i.student_id ${ic}
     GROUP BY i.student_id`,
    intParams
  );

  const att = rows(
    `SELECT student_id, COUNT(*) AS c FROM attendance a
     WHERE a.session_id = ? AND a.status IN ('present','late')
     GROUP BY a.student_id`,
    [sessionId || -1]
  );

  const map = {};
  for (const a of ans) {
    map[a.student_id] = {
      student_id: a.student_id,
      answer_count: numeric(a.answer_count),
      correct_count: numeric(a.correct_count),
      avg_reaction_ms: a.avg_rt ? numeric(a.avg_rt) : null
    };
  }
  for (const i of ints) {
    if (!map[i.student_id]) map[i.student_id] = { student_id: i.student_id, answer_count: 0, correct_count: 0, avg_reaction_ms: null };
    map[i.student_id].interaction_count = numeric(i.interaction_count);
    map[i.student_id].speech_count = numeric(i.speech_count);
    map[i.student_id].raise_count = numeric(i.raise_count);
  }
  for (const a of att) {
    if (map[a.student_id]) map[a.student_id].present = numeric(a.c);
  }
  return Object.values(map);
}

function stddev(values) {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Key indicators for a scope (class/student) over a period.
 */
function computeIndicators({ classId, sessionId, studentId, from, to }) {
  const metrics = perStudentMetrics({ classId, sessionId, from, to });
  let scoped = metrics;
  if (studentId) scoped = scoped.filter((m) => m.student_id === Number(studentId));

  if (scoped.length === 0) {
    return {
      participation_rate: 0,
      correct_answer_rate: 0,
      response_time_ms: 0,
      activeness: 0,
      interaction_level: 0,
      speech_frequency: 0,
      stability_index: 0,
      total_answers: 0,
      total_interactions: 0
    };
  }

  const present = metrics.length;
  const interacted = scoped.filter((m) => (m.interaction_count || 0) > 0 || (m.answer_count || 0) > 0).length;
  const totalAnswers = scoped.reduce((s, m) => s + m.answer_count, 0);
  const totalCorrect = scoped.reduce((s, m) => s + m.correct_count, 0);
  const totalInteractions = scoped.reduce((s, m) => s + m.interaction_count || 0, 0);
  const totalSpeech = scoped.reduce((s, m) => s + m.speech_count || 0, 0);
  const avgRT = scoped.filter((m) => m.avg_reaction_ms != null).reduce((s, m) => s + m.avg_reaction_ms, 0);

  const perStudentScores = scoped.map((m) => {
    const accuracy = m.answer_count ? m.correct_count / m.answer_count : 0;
    return accuracy * (m.answer_count || 0);
  });

  return {
    participation_rate: round((interacted / (present || 1)) * 100),
    correct_answer_rate: round((totalCorrect / (totalAnswers || 1)) * 100),
    response_time_ms: scoped.filter((m) => m.avg_reaction_ms != null).length
      ? Math.round(avgRT / scoped.filter((m) => m.avg_reaction_ms != null).length)
      : 0,
    activeness: round(totalInteractions / (present || 1), 2),
    interaction_level: round((interacted / (present || 1)) * 100),
    speech_frequency: round(totalSpeech / (present || 1), 2),
    stability_index: round(1 - Math.min(1, stddev(perStudentScores) / (totalAnswers / (present || 1) || 1)), 2),
    total_answers: totalAnswers,
    total_interactions: totalInteractions
  };
}

/**
 * Trend of an indicator over buckets (day/week/month/session).
 */
function computeTrend({ classId, sessionId, metric = 'correct_answer_rate', unit = 'session', from, to }) {
  const bucketCond = [];
  const params = [];
  if (classId) { bucketCond.push('st.class_id = ?'); params.push(classId); }
  if (from) { bucketCond.push('a.created_at >= ?'); params.push(from); }
  if (to) { bucketCond.push('a.created_at <= ?'); params.push(to); }

  let bucketExpr;
  switch (unit) {
    case 'day': bucketExpr = `substr(a.created_at, 1, 10)`; break;
    case 'week': bucketExpr = `strftime('%Y-W%W', a.created_at)`; break;
    case 'month': bucketExpr = `substr(a.created_at, 1, 7)`; break;
    case 'question': bucketExpr = `a.session_question_id`; break;
    default: bucketExpr = `a.session_id`; break;
  }

  const data = rows(
    `SELECT ${bucketExpr} AS bucket,
            COUNT(*) AS total,
            SUM(CASE WHEN a.is_correct = 1 THEN 1 ELSE 0 END) AS correct,
            AVG(CASE WHEN a.reaction_ms > 0 THEN a.reaction_ms END) AS avg_rt
     FROM answers a JOIN students st ON st.id = a.student_id
     WHERE ${bucketCond.length ? bucketCond.join(' AND ') : '1=1'}
     GROUP BY bucket ORDER BY bucket`,
    params
  );

  return data.map((d) => {
    const v = {};
    v.bucket = d.bucket;
    v.total = numeric(d.total);
    v.correct_rate = round((numeric(d.correct) / (v.total || 1)) * 100);
    v.response_time_ms = d.avg_rt ? Math.round(numeric(d.avg_rt)) : 0;
    switch (metric) {
      case 'correct_answer_rate': v.value = v.correct_rate; break;
      case 'response_time': v.value = v.response_time_ms; break;
      case 'participation': v.value = round((numeric(d.total) / 1) * 100); break;
      default: v.value = v.correct_rate;
    }
    return v;
  });
}

/**
 * Automatic detection of student categories.
 */
function detectStudents({ classId, from, to }) {
  const metrics = perStudentMetrics({ classId, from, to });
  const result = { low_interaction: [], consistently_incorrect: [], decreasing: [], outstanding: [] };

  const withActivity = metrics.filter((m) => (m.answer_count || 0) + (m.interaction_count || 0) > 0);
  const activityValues = withActivity.map((m) => (m.answer_count || 0) + (m.interaction_count || 0));
  const meanActivity = activityValues.length
    ? activityValues.reduce((s, v) => s + v, 0) / activityValues.length
    : 0;

  for (const m of metrics) {
    const activity = (m.answer_count || 0) + (m.interaction_count || 0);
    const accuracy = m.answer_count ? m.correct_count / m.answer_count : 0;
    const student = m.student_id;
    if (m.answer_count > 0 && accuracy < 0.33) {
      result.consistently_incorrect.push({ student_id: student, accuracy: round(accuracy) });
    }
    if (activity === 0 || activity < meanActivity * 0.25) {
      result.low_interaction.push({ student_id: student, activity });
    }
    if (accuracy >= 0.8 && (m.answer_count || 0) >= 3 && activity >= meanActivity) {
      result.outstanding.push({ student_id: student, accuracy: round(accuracy), activity });
    }
  }

  if (from) {
    const mid = new Date(new Date(from).getTime() + (new Date(to || now()).getTime() - new Date(from).getTime()) / 2).toISOString();
    const firstHalf = perStudentMetrics({ classId, from, to: mid });
    const secondHalf = perStudentMetrics({ classId, from: mid, to });
    const firstMap = new Map(firstHalf.map((m) => [m.student_id, m]));
    const secondMap = new Map(secondHalf.map((m) => [m.student_id, m]));
    for (const [id, second] of secondMap) {
      const first = firstMap.get(Number(id));
      const a1 = first ? (first.answer_count || 0) + (first.interaction_count || 0) : 0;
      const a2 = second.answer_count || 0;
      if (a1 > 0 && a2 < a1 * 0.5) {
        result.decreasing.push({ student_id: Number(id), first_half_activity: a1, second_half_activity: a2 });
      }
    }
  }
  return result;
}

/**
 * Persist aggregated statistics for a period/scope.
 */
function storeStatistics({ period, scope, scopeId, metrics }) {
  for (const [key, value] of Object.entries(metrics)) {
    run(
      `INSERT INTO statistics (period, scope, scope_id, metric, value, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(period, scope, scope_id, metric) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [period, scope, scopeId, key, value, now()]
    );
  }
}

module.exports = { perStudentMetrics, computeIndicators, computeTrend, detectStudents, storeStatistics, stddev };
