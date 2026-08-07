'use strict';

const { rows, row, run, transaction, now } = require('../db/database');
const { runAudioPipeline } = require('./audio');
const { runVisionPipeline, FINGER_TO_LETTER } = require('./vision');
const { broadcast } = require('../services/hub');

/**
 * AI Engine orchestrator (spec section III).
 * Runs the audio & vision pipelines inside a live session and records
 * interactions / answers. Provider is pluggable ('mock' simulates frames).
 */

const activeSims = new Map();

function getOpenQuestion(sessionId) {
  return row('SELECT * FROM session_questions WHERE session_id = ? AND status = ? ORDER BY id LIMIT 1', [sessionId, 'open']);
}

function getSeats(sessionId) {
  return rows(
    `SELECT s.id AS seat_id, s.student_id, st.full_name
     FROM seats s JOIN students st ON st.id = s.student_id
     WHERE s.class_id = (SELECT class_id FROM sessions WHERE id = ?) AND s.active = 1`,
    [sessionId]
  );
}

function recordInteraction(sessionId, studentId, seatId, type, subType, value, detail) {
  const ts = now();
  run(
    'INSERT INTO interactions (session_id, student_id, seat_id, type, sub_type, value, detail, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [sessionId, studentId, seatId, type, subType, value, detail ? JSON.stringify(detail) : null, ts]
  );
  broadcast('interaction', { session_id: sessionId, student_id: studentId, type, sub_type: subType, timestamp: ts });
}

function recordAnswer({ sessionId, question, studentId, seatId, letter, method, confidence, reactionMs, value, isCorrect, score }) {
  const ts = now();
  run(
    'INSERT INTO answers (session_question_id, session_id, student_id, seat_id, answer_value, is_correct, score, reaction_ms, detection_method, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [question.id, sessionId, studentId, seatId, letter, isCorrect ? 1 : 0, score, reactionMs, method, confidence, ts]
  );
  broadcast('answer', {
    session_id: sessionId,
    session_question_id: question.id,
    student_id: studentId,
    answer_value: letter,
    is_correct: isCorrect,
    score,
    reaction_ms: reactionMs,
    method,
    timestamp: ts
  });
}

function closeQuestionIfExpired(question) {
  const started = new Date(question.started_at).getTime();
  const duration = question.duration || 15;
  if (Date.now() - started > duration * 1000) {
    run('UPDATE session_questions SET status = ?, ended_at = ? WHERE id = ?', ['closed', now(), question.id]);
    broadcast('question_closed', { session_question_id: question.id });
    return true;
  }
  return false;
}

function simulateTick(sessionId) {
  const session = row('SELECT * FROM sessions WHERE id = ?', [sessionId]);
  if (!session || session.status !== 'live') {
    activeSims.delete(sessionId);
    return;
  }

  const question = getOpenQuestion(sessionId);
  if (!question) return;

  if (closeQuestionIfExpired(question)) return;

  const seats = getSeats(sessionId);
  if (seats.length === 0) return;

  const roll = Math.random();

  // Speech events (participation, reaction speed)
  if (roll < 0.3) {
    const seat = seats[Math.floor(Math.random() * seats.length)];
    const transcript = ['I think the answer is', 'I know this one', 'Can I try?', 'The answer is'][Math.floor(Math.random() * 4)];
    recordInteraction(sessionId, seat.student_id, seat.seat_id, 'speech', 'student_talk', 1, { transcript });
  }

  // Hand raises + answer recognition
  if (roll >= 0.15 && roll < 0.9) {
    const n = 1 + Math.floor(Math.random() * 3);
    const picked = [...seats].sort(() => Math.random() - 0.5).slice(0, n);
    for (const seat of picked) {
      const mode = question.recognition_mode || '1';
      const vision = runVisionPipeline(sessionId, mode, seat.student_id);
      const rec = vision.answer_recognition;

      if (mode === '3') {
        if (rec.raised) {
          recordInteraction(sessionId, seat.student_id, seat.seat_id, 'raise_hand', 'hand_raise', 1, { confidence: rec.confidence });
          const reactionMs = 800 + Math.floor(Math.random() * 8000);
          const isCorrect = Math.random() < 0.7;
          const score = isCorrect ? question.points : 0;
          recordAnswer({
            sessionId,
            question,
            studentId: seat.student_id,
            seatId: seat.seat_id,
            letter: null,
            method: 'hand_raise',
            confidence: rec.confidence,
            reactionMs,
            value: null,
            isCorrect,
            score
          });
        }
      } else {
        const reactionMs = 600 + Math.floor(Math.random() * 9000);
        const isCorrect = Math.random() < 0.68;
        const score = isCorrect ? question.points : 0;
        recordAnswer({
          sessionId,
          question,
          studentId: seat.student_id,
          seatId: seat.seat_id,
          letter: rec.letter,
          method: rec.method,
          confidence: rec.confidence,
          reactionMs,
          value: rec.letter,
          isCorrect,
          score
        });
        recordInteraction(sessionId, seat.student_id, seat.seat_id, 'answer', rec.method, rec.letter ? FINGER_TO_LETTER[Object.keys(FINGER_TO_LETTER).find((k) => FINGER_TO_LETTER[k] === rec.letter)] || 0 : 0, { letter: rec.letter, reaction_ms: reactionMs });
      }
    }
  }

  // Audio pipeline / teacher commands
  if (roll > 0.92) {
    const audio = runAudioPipeline(null, sessionId);
    if (audio.command === 'end_answering') {
      run('UPDATE session_questions SET status = ?, ended_at = ? WHERE id = ?', ['closed', now(), question.id]);
    }
    broadcast('audio', { ...audio, session_id: sessionId });
  }

  // Persist aggregated stats for live dashboard
  broadcast('stats', { session_id: sessionId, timestamp: now() });
}

function startSessionSimulator(sessionId) {
  if (activeSims.has(sessionId)) return { started: true, reason: 'already running' };
  const timer = setInterval(() => {
    try {
      simulateTick(sessionId);
    } catch (err) {
      clearInterval(timer);
      activeSims.delete(sessionId);
      broadcast('sim_error', { session_id: sessionId, message: err.message });
    }
  }, 2500);
  activeSims.set(sessionId, timer);
  return { started: true, interval_ms: 2500 };
}

function stopSessionSimulator(sessionId) {
  const timer = activeSims.get(sessionId);
  if (timer) {
    clearInterval(timer);
    activeSims.delete(sessionId);
  }
  return { stopped: true };
}

function stopAll() {
  for (const [, t] of activeSims) clearInterval(t);
  activeSims.clear();
}

function activeCount() {
  return activeSims.size;
}

module.exports = { startSessionSimulator, stopSessionSimulator, stopAll, activeCount, simulateTick };
