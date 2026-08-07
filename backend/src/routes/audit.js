'use strict';

const express = require('express');
const { row, rows } = require('../db/database');
const { authRequired, requirePermission } = require('../middleware/auth');
const { wrap, ok, bad, notFound } = require('./helpers');

const router = express.Router();
router.use(authRequired);

router.get('/', requirePermission('audit.read'), wrap((req, res) => {
  const { entity, action, user_id, limit } = req.query;
  const cond = [];
  const params = [];
  if (entity) { cond.push('entity = ?'); params.push(entity); }
  if (action) { cond.push('action = ?'); params.push(action); }
  if (user_id) { cond.push('user_id = ?'); params.push(user_id); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const list = rows(
    `SELECT a.*, u.full_name AS user_name
     FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
     ${where} ORDER BY a.id DESC LIMIT ?`,
    [...params, parseInt(limit || '200', 10)]
  );
  ok(res, list);
}));

module.exports = router;
