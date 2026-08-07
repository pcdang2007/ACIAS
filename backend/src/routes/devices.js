'use strict';

const express = require('express');
const { row, rows, run, now } = require('../db/database');
const { authRequired, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { wrap, ok, created, bad, notFound } = require('./helpers');

const router = express.Router();
router.use(authRequired);

router.get('/', requirePermission('device.read'), wrap((req, res) => {
  ok(res, rows('SELECT * FROM devices ORDER BY id'));
}));

router.post('/', requirePermission('device.write'), wrap((req, res) => {
  const { name, type, stream_url, location, status } = req.body || {};
  if (!name || !type) return bad(res, 'name and type are required');
  const id = run('INSERT INTO devices (name, type, stream_url, location, status, registered_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    name, type, stream_url || null, location || null, status || 'offline', req.user.id, now()
  ]).lastInsertRowid;
  audit(req.user.id, 'CREATE_DEVICE', 'device', id, req.body, req);
  created(res, { id });
}));

router.put('/:id', requirePermission('device.write'), wrap((req, res) => {
  const { name, type, stream_url, location, status } = req.body || {};
  run('UPDATE devices SET name = COALESCE(?, name), type = COALESCE(?, type), stream_url = COALESCE(?, stream_url), location = COALESCE(?, location), status = COALESCE(?, status) WHERE id = ?', [
    name, type, stream_url, location, status, req.params.id
  ]);
  audit(req.user.id, 'UPDATE_DEVICE', 'device', req.params.id, req.body, req);
  ok(res, { message: 'Device updated' });
}));

router.delete('/:id', requirePermission('device.write'), wrap((req, res) => {
  const d = row('SELECT id FROM devices WHERE id = ?', [req.params.id]);
  if (!d) return notFound(res);
  run('UPDATE seats SET camera_id = NULL WHERE camera_id = ?', [d.id]);
  run('DELETE FROM devices WHERE id = ?', [d.id]);
  audit(req.user.id, 'DELETE_DEVICE', 'device', d.id, null, req);
  ok(res, { message: 'Device deleted' });
}));

module.exports = router;
