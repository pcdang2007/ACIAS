'use strict';

const express = require('express');
const { row, rows, run, now } = require('../db/database');
const { authRequired, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { wrap, ok, created, bad, notFound } = require('./helpers');

const router = express.Router();
router.use(authRequired);

router.get('/', requirePermission('role.read'), wrap((req, res) => {
  const roles = rows('SELECT * FROM roles ORDER BY level');
  ok(res, roles);
}));

router.get('/permissions', requirePermission('role.read'), wrap((req, res) => {
  ok(res, rows('SELECT * FROM permissions ORDER BY code'));
}));

router.get('/:id', requirePermission('role.read'), wrap((req, res) => {
  const r = row('SELECT * FROM roles WHERE id = ?', [req.params.id]);
  if (!r) return notFound(res);
  r.permissions = rows(
    `SELECT p.code, p.name FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?`,
    [r.id]
  );
  ok(res, r);
}));

router.post('/', requirePermission('role.write'), wrap((req, res) => {
  const { code, name, level, description, permissions } = req.body || {};
  if (!code || !name || level == null) return bad(res, 'code, name, level are required');
  const id = run('INSERT INTO roles (code, name, level, description) VALUES (?, ?, ?, ?)', [code, name, level, description]).lastInsertRowid;
  if (Array.isArray(permissions)) {
    for (const p of permissions) {
      const perm = row('SELECT id FROM permissions WHERE code = ?', [p]);
      if (perm) run('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [id, perm.id]);
    }
  }
  audit(req.user.id, 'CREATE_ROLE', 'role', id, req.body, req);
  created(res, { id });
}));

router.put('/:id', requirePermission('role.write'), wrap((req, res) => {
  const { name, level, description, permissions } = req.body || {};
  run('UPDATE roles SET name = COALESCE(?, name), level = COALESCE(?, level), description = COALESCE(?, description) WHERE id = ?', [name, level, description, req.params.id]);
  if (Array.isArray(permissions)) {
    run('DELETE FROM role_permissions WHERE role_id = ?', [req.params.id]);
    for (const p of permissions) {
      const perm = row('SELECT id FROM permissions WHERE code = ?', [p]);
      if (perm) run('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [req.params.id, perm.id]);
    }
  }
  audit(req.user.id, 'UPDATE_ROLE', 'role', req.params.id, req.body, req);
  ok(res, { message: 'Role updated' });
}));

router.delete('/:id', requirePermission('role.write'), wrap((req, res) => {
  run('DELETE FROM roles WHERE id = ?', [req.params.id]);
  audit(req.user.id, 'DELETE_ROLE', 'role', req.params.id, null, req);
  ok(res, { message: 'Role deleted' });
}));

module.exports = router;
