'use strict';

const { row, run, now } = require('../db/database');
const { runVisionMonitor } = require('./vision');
const { broadcast } = require('../services/hub');

/**
 * "Who records" feed processor.
 * Drives the vision pipeline for a camera_feeds row and streams each stage
 * to the WebSocket hub as a `pipeline` event, persisting the last result.
 */

const INTERVAL_MS = 2000;
const activeFeeds = new Map();

function feedDetail(feedId) {
  return row(
    `SELECT f.*, s.class_id, s.status AS session_status,
            d.name AS device_name, d.stream_url, d.type AS device_type
     FROM camera_feeds f
     LEFT JOIN sessions s ON s.id = f.session_id
     LEFT JOIN devices d ON d.id = f.device_id
     WHERE f.id = ?`,
    [feedId]
  );
}

function tick(feedId) {
  const feed = feedDetail(feedId);
  if (!feed || feed.status !== 'active' || !feed.session_status) {
    stopFeed(feedId);
    return;
  }
  const result = runVisionMonitor(feed.session_id, '3');
  run('UPDATE camera_feeds SET last_result = ? WHERE id = ?', [JSON.stringify(result), feedId]);
  broadcast('pipeline', {
    feed_id: feedId,
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
}

function startFeed(feedId) {
  if (activeFeeds.has(feedId)) return { started: true, reason: 'already running', interval_ms: INTERVAL_MS };
  const timer = setInterval(() => {
    try {
      tick(feedId);
    } catch (err) {
      stopFeed(feedId);
      broadcast('pipeline_error', { feed_id: feedId, message: err.message, timestamp: now() });
    }
  }, INTERVAL_MS);
  activeFeeds.set(feedId, timer);
  return { started: true, interval_ms: INTERVAL_MS };
}

function stopFeed(feedId) {
  const timer = activeFeeds.get(feedId);
  if (timer) {
    clearInterval(timer);
    activeFeeds.delete(feedId);
  }
  return { stopped: true };
}

function stopAllFeeds() {
  for (const [, t] of activeFeeds) clearInterval(t);
  activeFeeds.clear();
}

function activeFeedCount() {
  return activeFeeds.size;
}

module.exports = { startFeed, stopFeed, stopAllFeeds, activeFeedCount };
