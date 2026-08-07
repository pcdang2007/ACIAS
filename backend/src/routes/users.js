'use strict';

const bcrypt = require('bcryptjs');
const express = require('express');
const { row, run, rows, now } = require('../db/database');
const { authRequired, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { wrap, ok, created, bad, notFound } = require('./helpers');

const router = express.Router();
router.use(authRequired);

router.get('/', requirePermission('user.read'), wrap((req, res) => {
  const users = rows(
    `SELECT u.id, u.username, u.full_name, u.email, u.phone, u.role_id, u.class_id, u.student_id, u.status, u.created_at,
            r.code AS role_code, r.name AS role_name
     FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.id`
  );
  ok(res, users);
}));

router.get('/:id', requirePermission('user.read'), wrap((req, res) => {
  const u = row(
    `SELECT u.id, u.username, u.full_name, u.email, u.phone, u.role_id, u.class_id, u.student_id, u.status, u.created_at,
            r.code AS role_code, r.name AS role_name
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    [req.params.id]
  );
  if (!u) return notFound(res);
  ok(res, u);
}));

router.post('/', requirePermission('user.write'), wrap((req, res) => {
  const { username, password, full_name, email, phone, role_id, class_id, student_id } = req.body || {};
  if (!username || !password || !full_name || !role_id) return bad(res, 'username, password, full_name, role_id are required');
  if (row('SELECT 1 AS ok FROM users WHERE username = ?', [username])) return bad(res, 'Username already exists');
  const id = run(
    'INSERT INTO users (username, password_hash, full_name, email, phone, role_id, class_id, student_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [username, bcrypt.hashSync(password, 10), full_name, email, phone, role_id, class_id, student_id, 'active', now()]
  ).lastInsertRowid;
  audit(req.user.id, 'CREATE_USER', 'user', id, req.body, req);
  created(res, { id, message: 'User created' });
}));

router.put('/:id', requirePermission('user.write'), wrap((req, res) => {
  const { full_name, email, phone, role_id, class_id, status, student_id } = req.body || {};
  run(
    'UPDATE users SET full_name = COALESCE(?, full_name), email = COALESCE(?, email), phone = COALESCE(?, phone), role_id = COALESCE(?, role_id), class_id = ?, student_id = COALESCE(?, student_id), status = COALESCE(?, status), updated_at = ? WHERE id = ?',
    [full_name, email, phone, role_id, class_id ?? row('SELECT class_id FROM users WHERE id = ?', [req.params.id]).class_id, student_id, status, now(), req.params.id]
  );
  audit(req.user.id, 'UPDATE_USER', 'user', req.params.id, req.body, req);
  ok(res, { message: 'User updated' });
}));

router.post('/:id/reset-password', requirePermission('user.write'), wrap((req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 6) return bad(res, 'Password must be at least 6 characters');
  run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [bcrypt.hashSync(password, 10), now(), req.params.id]);
  audit(req.user.id, 'RESET_PASSWORD', 'user', req.params.id, null, req);
  ok(res, { message: 'Password reset' });
}));

router.delete('/:id', requirePermission('user.write'), wrap((req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return bad(res, 'You cannot delete yourself');
  run('DELETE FROM users WHERE id = ?', [id]);
  audit(req.user.id, 'DELETE_USER', 'user', id, null, req);
  ok(res, { message: 'User deleted' });
}));

module.exports = router;
