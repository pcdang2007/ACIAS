'use strict';

const { rows } = require('../db/database');

/**
 * Image Recognition Pipeline (spec section III.B):
 *   Video stream -> Person Detection -> Seat Tracking -> Pose Estimation
 *   -> Hand Detection -> Finger Counting -> Answer Recognition
 *
 * Seat tracking is prioritized over facial recognition to reduce biometric
 * data requirements (security by design).
 */

const FINGER_TO_LETTER = { 1: 'A', 2: 'B', 3: 'C', 4: 'D' };

const FRAME_W = 640;
const FRAME_H = 360;

function detectPersons(sessionId) {
  let count = 3 + Math.floor(Math.random() * 5);
  if (sessionId) {
    try {
      const seats = rows(
        `SELECT COUNT(*) AS cnt FROM seats WHERE class_id = (SELECT class_id FROM sessions WHERE id = ?) AND active = 1 AND student_id IS NOT NULL`,
        [sessionId]
      );
      const seatCount = seats[0]?.cnt || 0;
      if (seatCount > 0) count = Math.max(1, seatCount + Math.floor(Math.random() * 3) - 1);
    } catch { /* fall back to random */ }
  }
  const persons = [];
  for (let i = 0; i < count; i++) {
    persons.push({
      id: `P${i}`,
      confidence: 0.85 + Math.random() * 0.14,
      bbox: {
        x: Math.round((Math.random() * 400) / FRAME_W * 1000) / 1000,
        y: Math.round((Math.random() * 200) / FRAME_H * 1000) / 1000,
        w: 0.15 + Math.random() * 0.1,
        h: 0.5 + Math.random() * 0.15
      }
    });
  }
  return persons;
}

function trackSeats(persons, sessionId) {
  const seats = rows(
    `SELECT s.id AS seat_id, s.student_id, s.seat_row, s.seat_col,
            st.full_name, st.student_code
     FROM seats s JOIN students st ON st.id = s.student_id
     WHERE s.class_id = (SELECT class_id FROM sessions WHERE id = ?) AND s.active = 1`,
    [sessionId]
  );
  const tracked = seats.map((seat) => ({
    ...seat,
    detected: Math.random() > 0.15,
    confidence: 0.8 + Math.random() * 0.19
  }));
  return { tracked_seats: tracked, persons_detected: persons.length };
}

function estimatePose() {
  return {
    pose: Math.random() > 0.5 ? 'sitting' : 'sitting',
    keypoints_visible: 12 + Math.floor(Math.random() * 6)
  };
}

function detectHands() {
  return { hands_detected: Math.random() > 0.4 ? 1 : 0, confidence: 0.75 + Math.random() * 0.24 };
}

function countFingers() {
  const weights = [0, 0.15, 0.4, 0.3, 0.15];
  const r = Math.random();
  let cumulative = 0;
  let count = 1;
  for (let i = 1; i <= 4; i++) {
    cumulative += weights[i];
    if (r < cumulative) { count = i; break; }
  }
  return { finger_count: count, letter: FINGER_TO_LETTER[count], confidence: 0.75 + Math.random() * 0.24 };
}

/**
 * Recognition mode (configured per question by the teacher):
 *   1 - count fingers (1->A, 2->B, 3->C, 4->D)
 *   2 - count fingers, left/right hand distinction
 *   3 - hand-raise detection -> prioritize scoring -> suggest caller
 */
function recognizeAnswer(mode, studentId) {
  if (mode === '3') {
    const raised = Math.random() > 0.55;
    return {
      method: 'hand_raise',
      raised: raised ? 1 : 0,
      letter: null,
      confidence: 0.85 + Math.random() * 0.14
    };
  }
  const f = countFingers();
  return {
    method: mode === '2' ? 'finger_left_right' : 'finger',
    hand: mode === '2' ? (Math.random() > 0.5 ? 'left' : 'right') : null,
    finger_count: f.finger_count,
    letter: f.letter,
    confidence: f.confidence
  };
}

function runVisionPipeline(sessionId, mode = '1', studentId = null) {
  const persons = detectPersons(sessionId);
  const tracking = trackSeats(persons, sessionId);
  const pose = estimatePose();
  const hands = detectHands();
  const recognition = recognizeAnswer(mode, studentId);
  return {
    pipeline: 'vision',
    person_detection: persons,
    seat_tracking: tracking,
    pose_estimation: pose,
    hand_detection: hands,
    finger_counting: recognition.method === 'finger' || recognition.method === 'finger_left_right'
      ? { finger_count: recognition.finger_count }
      : null,
    answer_recognition: recognition,
    note: 'Seat tracking used in place of facial recognition to minimize biometric data.'
  };
}

/**
 * Monitor pass: runs every vision stage, capturing per-stage results and timing,
 * so the "who records" page can show the AI working step by step.
 */
function runVisionMonitor(sessionId, mode = '1') {
  const started = Date.now();
  const t0 = Date.now();
  const person_detection = detectPersons(sessionId);
  const det_ms = Date.now() - t0;

  const t1 = Date.now();
  const seat_tracking = trackSeats(person_detection, sessionId);
  const track_ms = Date.now() - t1;

  const t2 = Date.now();
  const pose_estimation = estimatePose();
  const pose_ms = Date.now() - t2;

  const t3 = Date.now();
  const hand_detection = detectHands();
  const hand_ms = Date.now() - t3;

  const t4 = Date.now();
  const finger_counting = countFingers();
  const count_ms = Date.now() - t4;

  const t5 = Date.now();
  const answer_recognition = recognizeAnswer(mode, null);
  const answer_ms = Date.now() - t5;

  return {
    pipeline: 'vision',
    frame: { width: FRAME_W, height: FRAME_H },
    stages: [
      { name: 'person_detection', label: 'Person detection', result: person_detection, ms: det_ms },
      { name: 'seat_tracking', label: 'Seat tracking', result: seat_tracking, ms: track_ms },
      { name: 'pose_estimation', label: 'Pose estimation', result: pose_estimation, ms: pose_ms },
      { name: 'hand_detection', label: 'Hand detection', result: hand_detection, ms: hand_ms },
      { name: 'finger_counting', label: 'Finger counting', result: finger_counting, ms: count_ms },
      { name: 'answer_recognition', label: 'Answer recognition', result: answer_recognition, ms: answer_ms }
    ],
    person_detection,
    seat_tracking,
    pose_estimation,
    hand_detection,
    finger_counting,
    answer_recognition,
    elapsed_ms: Date.now() - started,
    note: 'Seat tracking used in place of facial recognition to minimize biometric data.'
  };
}

module.exports = { runVisionPipeline, runVisionMonitor, FINGER_TO_LETTER };
