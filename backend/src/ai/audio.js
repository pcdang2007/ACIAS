'use strict';

const { rows } = require('../db/database');

/**
 * Audio Recognition Pipeline (spec section III.A):
 *   Audio stream -> Voice Activity Detection -> Speech Recognition
 *   -> Command Recognition -> Question Matching
 *
 * Provider 'mock' simulates the pipeline stages. Real providers (Whisper, etc.)
 * can be plugged in behind the same interface.
 */

const TEACHER_UTTERANCES = [
  'Please raise your hand to answer',
  'Now answer question number one',
  'Who can solve this problem?',
  'Start the answer session',
  'End the answer session',
  'Class, please focus',
  'Can anyone tell me the answer?',
  'We move to the next question',
  'Show me your fingers',
  'Nice job everyone'
];

const COMMANDS = [
  { phrase: 'start the answer session', command: 'start_answering' },
  { phrase: 'start answering', command: 'start_answering' },
  { phrase: 'end the answer session', command: 'end_answering' },
  { phrase: 'end answering', command: 'end_answering' },
  { phrase: 'next question', command: 'next_question' },
  { phrase: 'raise your hand', command: 'raise_hand_prompt' },
  { phrase: 'show me your fingers', command: 'finger_prompt' },
  { phrase: 'who can answer', command: 'suggest_answerer' }
];

function vad(segment) {
  return { activity: segment && segment.length > 0, level: 0.5 + Math.random() * 0.5 };
}

function recognizeSpeech(segment) {
  return { transcript: segment || TEACHER_UTTERANCES[Math.floor(Math.random() * TEACHER_UTTERANCES.length)], confidence: 0.85 + Math.random() * 0.14 };
}

function recognizeCommand(transcript) {
  const lower = (transcript || '').toLowerCase();
  for (const c of COMMANDS) {
    if (lower.includes(c.phrase)) return { command: c.command, matched: c.phrase };
  }
  return { command: 'general_utterance', matched: null };
}

function scoreQuestion(q, transcript) {
  let score = 0;
  let keywords = [];
  try {
    keywords = JSON.parse(q.keywords || '[]');
  } catch { keywords = []; }
  const lower = (transcript || '').toLowerCase();
  for (const k of keywords) {
    if (lower.includes(String(k).toLowerCase())) score += 1;
  }
  for (const w of String(q.content).toLowerCase().split(/\s+/).slice(0, 8)) {
    if (lower.includes(w)) score += 0.5;
  }
  return score;
}

function matchQuestion(transcript, sessionId) {
  const questions = rows(
    'SELECT * FROM session_questions WHERE session_id = ? AND status = ?',
    [sessionId, 'open']
  );
  let best = null;
  let bestScore = 0;
  for (const q of questions) {
    const s = scoreQuestion(q, transcript);
    if (s > bestScore) {
      best = q;
      bestScore = s;
    }
  }
  return { question: best, score: bestScore };
}

function runAudioPipeline(segment, sessionId) {
  const v = vad(segment);
  if (!v.activity) return { pipeline: 'audio', vad: v, transcript: null, command: null, matched: null, skipped: 'no voice activity' };
  const sr = recognizeSpeech(segment);
  const cr = recognizeCommand(sr.transcript);
  const qm = sessionId ? matchQuestion(sr.transcript, sessionId) : { question: null, score: 0 };
  return {
    pipeline: 'audio',
    vad: v,
    transcript: sr.transcript,
    confidence: sr.confidence,
    command: cr.command,
    matched_phrase: cr.matched,
    question_match: qm.question ? { session_question_id: qm.question.id, content: qm.question.content, score: qm.score } : null
  };
}

module.exports = { runAudioPipeline, recognizeCommand, matchQuestion };
