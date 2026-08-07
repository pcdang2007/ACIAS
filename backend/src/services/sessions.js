'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { row, rows, run, now } = require('../db/database');
const config = require('../config');
const { kickSession } = require('./hub');

function getClientIp(req) {
  if (!req) return '';
  return req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
}

function decodeToken(token) {
  try {
    return jwt.decode(token);
  } catch {
    return null;
  }
}

function sidOfToken(token) {
  const p = decodeToken(token);
  return p ? p.sid || null : null;
}

function activeSids(userId) {
  return rows('SELECT sid FROM auth_sessions WHERE user_id = ? AND revoked_at IS NULL', [userId]).map((s) => s.sid);
}

function kickActive(userId, payload) {
  for (const sid of activeSids(userId)) kickSession(sid, payload);
}

/**
 * Sign in a user. Each login gets a unique session id (sid) embedded in the
 * token. Any previous active session for the same user is kicked (and
 * notified) and revoked, so an account can only be logged in from one location.
 */
function createSession(user, req) {
  const sid = crypto.randomUUID();
  const token = jwt.sign(
    { id: user.id, username: user.username, roleCode: user.roleCode, roleId: user.roleId, sid },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
  const payload = decodeToken(token);
  const expiresAt = payload && payload.exp ? new Date(payload.exp * 1000).toISOString() : null;
  const ip = getClientIp(req);
  kickActive(user.id, { message: `Signed in from ${ip}`, ip });
  run('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [now(), user.id]);
  run(
    'INSERT INTO auth_sessions (user_id, sid, ip, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL)',
    [user.id, sid, ip, now(), expiresAt]
  );
  return token;
}

function revokeSession(sid) {
  if (!sid) return;
  run('UPDATE auth_sessions SET revoked_at = ? WHERE sid = ? AND revoked_at IS NULL', [now(), sid]);
}

function revokeAllForUser(userId) {
  kickActive(userId, { message: 'Your sessions have been signed out', ip: '' });
  run('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [now(), userId]);
}

function isSessionActive(token) {
  const payload = decodeToken(token);
  if (!payload || !payload.sid || !payload.id) return false;
  return !!row(
    'SELECT 1 AS ok FROM auth_sessions WHERE sid = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?',
    [payload.sid, payload.id, now()]
  );
}

module.exports = { sidOfToken, createSession, revokeSession, revokeAllForUser, isSessionActive };
