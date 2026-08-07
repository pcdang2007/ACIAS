'use strict';

const express = require('express');
const { row, rows } = require('../db/database');
const { authRequired, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { wrap, ok, bad, notFound } = require('./helpers');
const audio = require('../ai/audio');
const vision = require('../ai/vision');
const engine = require('../ai/engine');
const scoring = require('../services/scoring');

const router = express.Router();
router.use(authRequired);

/**
 * Run the audio pipeline on a segment (simulated).
 */
router.post('/audio', requirePermission('ai.run'), wrap((req, res) => {
  const { segment, session_id } = req.body || {};
  const result = audio.runAudioPipeline(segment, session_id || null);
  audit(req.user.id, 'AI_AUDIO_PIPELINE', 'ai', null, { command: result.command }, req);
  ok(res, result);
}));

/**
 * Run the vision pipeline (simulated frame).
 */
router.post('/vision', requirePermission('ai.run'), wrap((req, res) => {
  const { session_id, mode, student_id } = req.body || {};
  if (!session_id) return bad(res, 'session_id is required');
  const result = vision.runVisionPipeline(session_id, mode || '1', student_id || null);
  audit(req.user.id, 'AI_VISION_PIPELINE', 'ai', null, { mode }, req);
  ok(res, result);
}));

/**
 * Compute call-to-answer suggestions using the X'/Y'/Z' scoring model.
 * Query params: class_id, session_id, question_points, amax
 */
router.get('/suggestions', requirePermission('ai.run'), wrap((req, res) => {
  const { class_id, session_id, question_points, amax, alpha, beta, gamma, delta } = req.query;
  if (!class_id) return bad(res, 'class_id query is required');
  const suggestions = scoring.computeSuggestions({
    classId: Number(class_id),
    sessionId: session_id ? Number(session_id) : null,
    questionPoints: question_points ? Number(question_points) : 10,
    amax: amax ? Number(amax) : 10,
    weights: { alpha: alpha ? Number(alpha) : 0.3, beta: beta ? Number(beta) : 0.3, gamma: gamma ? Number(gamma) : 0.2, delta: delta ? Number(delta) : 0.2 }
  });
  ok(res, suggestions);
}));

/**
 * Start/stop the live session AI simulator.
 */
router.post('/simulator/:action', requirePermission('ai.run'), wrap((req, res) => {
  const { session_id } = req.body || {};
  if (!session_id) return bad(res, 'session_id is required');
  const result = req.params.action === 'start'
    ? engine.startSessionSimulator(session_id)
    : engine.stopSessionSimulator(session_id);
  audit(req.user.id, `AI_SIMULATOR_${req.params.action.toUpperCase()}`, 'ai', session_id, null, req);
  ok(res, result);
}));

router.get('/status', requirePermission('ai.run'), wrap((req, res) => {
  ok(res, { provider: 'mock', active_simulators: engine.activeCount() });
}));

module.exports = router;
