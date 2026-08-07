'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const { row, rows, run, now } = require('../db/database');
const { authRequired, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { wrap, ok, created, bad, notFound, forbidden, canAccessClass } = require('./helpers');
const { runVisionMonitor } = require('../ai/vision');
const feedRunner = require('../ai/feed');
const { broadcast } = require('../services/hub');

const router = express.Router();
router.use(authRequired);

const PHOTO_DIR = path.join(config.uploadDir, 'camera');
const ALLOWED_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const MAX_BYTES = 10 * 1024 * 1024;

if (!fs.existsSync(PHOTO_DIR)) fs.mkdirSync(PHOTO_DIR, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES } });

function feedWithDetails(id) {
  return row(
    `SELECT f.*, s.class_id, s.status AS session_status, d.name AS device_name,
            d.type AS device_type, d.stream_url
     FROM camera_feeds f
     LEFT JOIN sessions s ON s.id = f.session_id
     LEFT JOIN devices d ON d.id = f.device_id
     WHERE f.id = ?`,
    [id]
  );
}

// Upload a photo and create a photo feed for a session
router.post('/photos', requirePermission('ai.run'), upload.single('photo'), wrap((req, res) => {
  const { session_id } = req.body || {};
  if (!session_id) return bad(res, 'session_id is required');
  const session = row('SELECT * FROM sessions WHERE id = ?', [session_id]);
  if (!session) return notFound(res);
  if (!canAccessClass(req.user, session.class_id)) return forbidden(res);
  if (!req.file) return bad(res, 'photo file is required (field: photo)');
  const ext = ALLOWED_MIME[req.file.mimetype];
  if (!ext) return bad(res, 'Only JPEG, PNG or WebP photos are allowed');
  const filename = `${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(PHOTO_DIR, filename), req.file.buffer);
  const photoPath = `/uploads/camera/${filename}`;
  const id = run(
    'INSERT INTO camera_feeds (session_id, source_type, device_id, photo_path, status, created_by, created_at) VALUES (?, ?, NULL, ?, ?, ?, ?)',
    [session_id, 'photo', photoPath, 'active', req.user.id, now()]
  ).lastInsertRowid;
  audit(req.user.id, 'CAMERA_FEED_PHOTO_UPLOAD', 'camera_feed', id, { session_id, photo_path: photoPath }, req);
  created(res, feedWithDetails(id));
}));

// Create a camera-source feed from a registered device
router.post('/', requirePermission('ai.run'), wrap((req, res) => {
  const { session_id, device_id } = req.body || {};
  if (!session_id || !device_id) return bad(res, 'session_id and device_id are required');
  const session = row('SELECT * FROM sessions WHERE id = ?', [session_id]);
  if (!session) return notFound(res);
  if (!canAccessClass(req.user, session.class_id)) return forbidden(res);
  const device = row('SELECT * FROM devices WHERE id = ?', [device_id]);
  if (!device) return notFound(res, 'Device not found');
  const existing = row(
    `SELECT * FROM camera_feeds WHERE session_id = ? AND device_id = ? AND status = 'active' ORDER BY id ASC LIMIT 1`,
    [session_id, device_id]
  );
  if (existing) return ok(res, { ...feedWithDetails(existing.id), reused: true });
  const id = run(
    'INSERT INTO camera_feeds (session_id, source_type, device_id, photo_path, status, created_by, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?)',
    [session_id, 'camera', device_id, 'active', req.user.id, now()]
  ).lastInsertRowid;
  audit(req.user.id, 'CAMERA_FEED_CREATE', 'camera_feed', id, { session_id, device_id }, req);
  created(res, { ...feedWithDetails(id), reused: false });
}));

// List feeds, optionally filtered by session
router.get('/', requirePermission('ai.run'), wrap((req, res) => {
  const { session_id } = req.query;
  let list;
  if (session_id) {
    const session = row('SELECT * FROM sessions WHERE id = ?', [session_id]);
    if (!session) return notFound(res);
    if (!canAccessClass(req.user, session.class_id)) return forbidden(res);
    list = rows(
      `SELECT f.*, s.class_id, d.name AS device_name, d.type AS device_type, d.stream_url
       FROM camera_feeds f
       LEFT JOIN sessions s ON s.id = f.session_id
       LEFT JOIN devices d ON d.id = f.device_id
       WHERE f.session_id = ? ORDER BY f.id DESC`,
      [session_id]
    );
  } else {
    const all = rows(
      `SELECT f.*, s.class_id, d.name AS device_name, d.type AS device_type, d.stream_url
       FROM camera_feeds f
       LEFT JOIN sessions s ON s.id = f.session_id
       LEFT JOIN devices d ON d.id = f.device_id
       ORDER BY f.id DESC`
    );
    list = all.filter((f) => canAccessClass(req.user, f.class_id));
  }
  ok(res, list.map((f) => ({ ...f, last_result: f.last_result ? JSON.parse(f.last_result) : null })));
}));

// Feed detail
router.get('/:id', requirePermission('ai.run'), wrap((req, res) => {
  const feed = feedWithDetails(req.params.id);
  if (!feed) return notFound(res);
  if (!canAccessClass(req.user, feed.class_id)) return forbidden(res);
  ok(res, { ...feed, last_result: feed.last_result ? JSON.parse(feed.last_result) : null });
}));

// Run the vision pipeline once
router.post('/:id/process', requirePermission('ai.run'), wrap((req, res) => {
  const feed = feedWithDetails(req.params.id);
  if (!feed) return notFound(res);
  if (!canAccessClass(req.user, feed.class_id)) return forbidden(res);
  const result = runVisionMonitor(feed.session_id, '3');
  run('UPDATE camera_feeds SET last_result = ? WHERE id = ?', [JSON.stringify(result), feed.id]);
  broadcast('pipeline', {
    feed_id: feed.id,
    session_id: feed.session_id,
    source_type: feed.source_type,
    photo_path: feed.photo_path,
    stream_url: feed.stream_url,
    device_name: feed.device_name,
    stages: result.stages,
    elapsed_ms: result.elapsed_ms,
    answer_recognition: result.answer_recognition,
    frame: result.frame,
    timestamp: now()
  });
  audit(req.user.id, 'AI_VISION_MONITOR', 'camera_feed', feed.id, null, req);
  ok(res, result);
}));

// Ingest a live frame (webcam/phone capture) and run the vision monitor on it
router.post('/:id/frames', requirePermission('ai.run'), wrap((req, res) => {
  const feed = feedWithDetails(req.params.id);
  if (!feed) return notFound(res);
  if (!canAccessClass(req.user, feed.class_id)) return forbidden(res);
  const { frame } = req.body || {};
  if (!frame || typeof frame !== 'string' || frame.length > 3 * 1024 * 1024) return bad(res, 'frame (base64 image data URL) is required');
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(frame)) return bad(res, 'frame must be a base64 image data URL');
  const result = runVisionMonitor(feed.session_id, '3');
  run('UPDATE camera_feeds SET last_result = ? WHERE id = ?', [JSON.stringify(result), feed.id]);
  broadcast('pipeline', {
    feed_id: feed.id,
    session_id: feed.session_id,
    source_type: feed.source_type,
    photo_path: feed.photo_path,
    stream_url: feed.stream_url,
    device_name: feed.device_name,
    stages: result.stages,
    elapsed_ms: result.elapsed_ms,
    answer_recognition: result.answer_recognition,
    frame: result.frame,
    timestamp: now()
  });
  audit(req.user.id, 'AI_VISION_FRAME', 'camera_feed', feed.id, null, req);
  ok(res, result);
}));

// Accept structured ML detections from client-side YOLOv8-pose
router.post('/:id/detections', requirePermission('ai.run'), wrap((req, res) => {
  const feed = feedWithDetails(req.params.id);
  if (!feed) return notFound(res);
  if (!canAccessClass(req.user, feed.class_id)) return forbidden(res);
  const { persons, frame } = req.body || {};
  if (!Array.isArray(persons)) return bad(res, 'persons array is required');
  if (!frame || !frame.width || !frame.height) return bad(res, 'frame {width, height} is required');
  const raisedCount = persons.filter((p) => p.raisedHand).length;
  const result = {
    pipeline: 'client_yolo',
    frame,
    stages: [
      { name: 'person_detection', label: 'Person detection', result: persons.map((p) => ({ id: p.id, confidence: p.confidence, bbox: p.bbox })), ms: 0 },
      { name: 'seat_tracking', label: 'Seat tracking', result: { tracked_seats: [], persons_detected: persons.length }, ms: 0 },
      { name: 'pose_estimation', label: 'Pose estimation', result: persons.map((p) => ({ id: p.id, pose: p.pose?.label || 'unknown' })), ms: 0 },
      { name: 'raised_hand', label: 'Raised hand', result: { raised_count: raisedCount, persons: persons.filter((p) => p.raisedHand).map((p) => p.id) }, ms: 0 },
      { name: 'answer_recognition', label: 'Answer recognition', result: { method: 'client_yolo', letter: null, raised: raisedCount, confidence: 0.9 }, ms: 0 }
    ],
    person_detection: persons.map((p) => ({ id: p.id, confidence: p.confidence, bbox: p.bbox })),
    persons,
    elapsed_ms: 0,
    source: 'client_yolo'
  };
  run('UPDATE camera_feeds SET last_result = ? WHERE id = ?', [JSON.stringify(result), feed.id]);
  broadcast('pipeline', {
    feed_id: feed.id,
    session_id: feed.session_id,
    source_type: feed.source_type,
    stages: result.stages,
    elapsed_ms: result.elapsed_ms,
    frame: result.frame,
    persons: persons.map((p) => ({ id: p.id, bbox: p.bbox, confidence: p.confidence, raisedHand: p.raisedHand, pose: p.pose?.label })),
    timestamp: now()
  });
  audit(req.user.id, 'AI_VISION_DETECTIONS', 'camera_feed', feed.id, { persons: persons.length, source: 'client_yolo' }, req);
  ok(res, result);
}));

// Start streaming AI stages for the feed
router.post('/:id/start', requirePermission('ai.run'), wrap((req, res) => {
  const feed = feedWithDetails(req.params.id);
  if (!feed) return notFound(res);
  if (!canAccessClass(req.user, feed.class_id)) return forbidden(res);
  const result = feedRunner.startFeed(feed.id);
  audit(req.user.id, 'CAMERA_FEED_START', 'camera_feed', feed.id, null, req);
  ok(res, result);
}));

router.post('/:id/stop', requirePermission('ai.run'), wrap((req, res) => {
  const feed = feedWithDetails(req.params.id);
  if (!feed) return notFound(res);
  if (!canAccessClass(req.user, feed.class_id)) return forbidden(res);
  feedRunner.stopFeed(feed.id);
  audit(req.user.id, 'CAMERA_FEED_STOP', 'camera_feed', feed.id, null, req);
  ok(res, { stopped: true });
}));

router.post('/:id/end', requirePermission('ai.run'), wrap((req, res) => {
  const feed = feedWithDetails(req.params.id);
  if (!feed) return notFound(res);
  if (!canAccessClass(req.user, feed.class_id)) return forbidden(res);
  feedRunner.stopFeed(feed.id);
  run("UPDATE camera_feeds SET status = 'ended', ended_at = ? WHERE id = ?", [now(), feed.id]);
  audit(req.user.id, 'CAMERA_FEED_END', 'camera_feed', feed.id, null, req);
  ok(res, { message: 'Feed ended' });
}));

// Delete a camera feed (and its uploaded photo file if any)
router.delete('/:id', requirePermission('ai.run'), wrap((req, res) => {
  const feed = feedWithDetails(req.params.id);
  if (!feed) return notFound(res);
  if (!canAccessClass(req.user, feed.class_id)) return forbidden(res);
  feedRunner.stopFeed(feed.id);
  if (feed.photo_path) {
    const filePath = path.join(config.uploadDir, feed.photo_path.replace(/^\/uploads\//, ''));
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* best effort */ }
  }
  run('DELETE FROM camera_feeds WHERE id = ?', [feed.id]);
  audit(req.user.id, 'CAMERA_FEED_DELETE', 'camera_feed', feed.id, { session_id: feed.session_id, source_type: feed.source_type }, req);
  ok(res, { deleted: true });
}));

module.exports = router;
