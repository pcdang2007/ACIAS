'use strict';

const bcrypt = require('bcryptjs');
const express = require('express');
const { row, run, rows, now } = require('../db/database');
const { authRequired, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { createSession, revokeSession, revokeAllForUser } = require('../services/sessions');
const { wrap, ok, bad, notFound, forbidden } = require('./helpers');

const router = express.Router();

router.post('/login', wrap((req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return bad(res, 'username and password are required');
  const user = row(
    `SELECT u.id, u.username, u.password_hash, u.full_name, u.email, u.role_id, u.class_id, u.student_id, u.status,
            r.code AS role_code, r.name AS role_name, r.level AS role_level
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.username = ?`,
    [username]
  );
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  if (user.status !== 'active') return forbidden(res, 'Account is disabled');
  const token = createSession(user, req);
  audit(user.id, 'LOGIN', 'user', user.id, { username }, req);
  delete user.password_hash;
  ok(res, { token, user });
}));

router.post('/logout', authRequired, wrap((req, res) => {
  revokeSession(req.sessionSid);
  audit(req.user.id, 'LOGOUT', 'user', req.user.id, null, req);
  ok(res, { message: 'Logged out' });
}));

router.get('/me', authRequired, wrap((req, res) => {
  const user = row(
    `SELECT u.id, u.username, u.full_name, u.email, u.phone, u.role_id, u.class_id, u.student_id, u.created_at,
            r.code AS role_code, r.name AS role_name, r.level AS role_level
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    [req.user.id]
  );
  ok(res, user);
}));

router.put('/me/profile', authRequired, wrap((req, res) => {
  const { full_name, email, phone, avatar } = req.body || {};
  run('UPDATE users SET full_name = COALESCE(?, full_name), email = COALESCE(?, email), phone = COALESCE(?, phone), avatar = COALESCE(?, avatar), updated_at = ? WHERE id = ?', [
    full_name, email, phone, avatar, now(), req.user.id
  ]);
  audit(req.user.id, 'UPDATE_PROFILE', 'user', req.user.id, req.body, req);
  ok(res, { message: 'Profile updated' });
}));

router.post('/change-password', authRequired, wrap((req, res) => {
  const { current_password, new_password } = req.body || {};
  const user = row('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!bcrypt.compareSync(current_password || '', user.password_hash)) return bad(res, 'Current password is incorrect');
  if (!new_password || new_password.length < 6) return bad(res, 'New password must be at least 6 characters');
  run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [bcrypt.hashSync(new_password, 10), now(), req.user.id]);
  revokeAllForUser(req.user.id);
  audit(req.user.id, 'CHANGE_PASSWORD', 'user', req.user.id, null, req);
  ok(res, { message: 'Password changed, please sign in again' });
}));

module.exports = router;
