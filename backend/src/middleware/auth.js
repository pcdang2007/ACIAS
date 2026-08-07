'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { row } = require('../db/database');
const { isSessionActive } = require('../services/sessions');

function attachUser(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query.token || '';
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = row(
      `SELECT u.id, u.username, u.full_name, u.email, u.role_id, u.class_id, u.student_id,
              r.code AS role_code, r.name AS role_name, r.level AS role_level
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND u.status = 'active'`,
      [payload.id]
    );
    if (!user) return null;
    // Single-session enforcement: token must carry a live session sid
    if (!isSessionActive(token)) return null;
    req.sessionSid = payload.sid || null;
    req.user = user;
    return user;
  } catch {
    return null;
  }
}

function authRequired(req, res, next) {
  const user = attachUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  next();
}

function optionalAuth(req, res, next) {
  attachUser(req);
  next();
}

function hasPermission(user, permCode) {
  if (!user) return false;
  const p = row(
    `SELECT 1 AS ok FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = ? AND p.code = ?`,
    [user.role_id, permCode]
  );
  return !!p;
}

function requirePermission(permCode) {
  return (req, res, next) => {
    const user = req.user || attachUser(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    if (hasPermission(user, permCode)) {
      req.user = user;
      return next();
    }
    return res.status(403).json({ error: `Forbidden: missing permission "${permCode}"` });
  };
}

function requireRole(codes) {
  const set = new Set(codes);
  return (req, res, next) => {
    const user = req.user || attachUser(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    if (set.has(user.role_code)) {
      req.user = user;
      return next();
    }
    return res.status(403).json({ error: 'Forbidden: insufficient role' });
  };
}

module.exports = { attachUser, authRequired, optionalAuth, hasPermission, requirePermission, requireRole };
