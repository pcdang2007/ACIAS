'use strict';

const express = require('express');
const { row, rows, run, now, transaction } = require('../db/database');
const { authRequired, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { wrap, ok, created, bad, notFound } = require('./helpers');

const router = express.Router();
router.use(authRequired);

router.get('/', requirePermission('subject.read'), wrap((req, res) => {
  ok(res, rows('SELECT * FROM subjects ORDER BY code'));
}));

router.post('/', requirePermission('subject.write'), wrap((req, res) => {
  const { code, name } = req.body || {};
  if (!code || !name) return bad(res, 'code and name are required');
  const id = run('INSERT INTO subjects (code, name) VALUES (?, ?)', [code, name]).lastInsertRowid;
  audit(req.user.id, 'CREATE_SUBJECT', 'subject', id, req.body, req);
  created(res, { id });
}));

router.put('/:id', requirePermission('subject.write'), wrap((req, res) => {
  const { name } = req.body || {};
  run('UPDATE subjects SET name = COALESCE(?, name) WHERE id = ?', [name, req.params.id]);
  audit(req.user.id, 'UPDATE_SUBJECT', 'subject', req.params.id, req.body, req);
  ok(res, { message: 'Subject updated' });
}));

router.delete('/:id', requirePermission('subject.write'), wrap((req, res) => {
  const s = row('SELECT id FROM subjects WHERE id = ?', [req.params.id]);
  if (!s) return notFound(res);
  transaction(() => {
    run('UPDATE questions SET subject_id = NULL WHERE subject_id = ?', [s.id]);
    run('UPDATE question_banks SET subject_id = NULL WHERE subject_id = ?', [s.id]);
    run('UPDATE lessons SET subject_id = NULL WHERE subject_id = ?', [s.id]);
    run('UPDATE sessions SET subject_id = NULL WHERE subject_id = ?', [s.id]);
    run('DELETE FROM subjects WHERE id = ?', [s.id]);
  });
  audit(req.user.id, 'DELETE_SUBJECT', 'subject', s.id, null, req);
  ok(res, { message: 'Subject deleted' });
}));

module.exports = router;
