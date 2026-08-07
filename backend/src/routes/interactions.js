'use strict';

const express = require('express');
const { row, rows } = require('../db/database');
const { authRequired, requirePermission } = require('../middleware/auth');
const { wrap, ok, bad, notFound, canAccessStudent } = require('./helpers');

const router = express.Router();
router.use(authRequired);

router.get('/', requirePermission('interaction.read'), wrap((req, res) => {
  const { session_id, student_id, type } = req.query;
  const cond = [];
  const params = [];
  if (session_id) { cond.push('i.session_id = ?'); params.push(session_id); }
  if (student_id) { cond.push('i.student_id = ?'); params.push(student_id); }
  if (type) { cond.push('i.type = ?'); params.push(type); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const list = rows(
    `SELECT i.*, st.full_name, st.student_code
     FROM interactions i JOIN students st ON st.id = i.student_id
     ${where} ORDER BY i.id DESC LIMIT 500`,
    params
  );
  const accessible = list.filter((i) => canAccessStudent(req.user, i.student_id));
  ok(res, accessible);
}));

module.exports = router;
