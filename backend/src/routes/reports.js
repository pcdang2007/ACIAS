'use strict';

const express = require('express');
const { row, rows } = require('../db/database');
const { authRequired, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { wrap, ok, created, bad, notFound } = require('./helpers');
const reportService = require('../services/report');

const router = express.Router();
router.use(authRequired);

router.get('/', requirePermission('report.read'), wrap((req, res) => {
  let reports = reportService.listReports();
  if (req.user.role_code === 'PARENT') {
    const student = row('SELECT id FROM students WHERE parent_user_id = ?', [req.user.id]);
    reports = reports.filter((r) => (r.scope_type === 'student' && r.scope_id === (student && student.id)) || r.scope_type === 'class');
  }
  if (req.user.role_code === 'STUDENT') {
    const student = row('SELECT id FROM students WHERE user_id = ?', [req.user.id]);
    reports = reports.filter((r) => r.scope_type === 'student' && r.scope_id === (student && student.id));
  }
  ok(res, reports);
}));

router.post('/generate', requirePermission('report.write'), wrap((req, res) => {
  const { type, scope_type, scope_id, period } = req.body || {};
  if (!type || !period) return bad(res, 'type and period are required');
  const report = reportService.generateReport({ type, scopeType: scope_type, scopeId: scope_id, period, userId: req.user.id });
  audit(req.user.id, 'GENERATE_REPORT', 'report', report.id, req.body, req);
  created(res, report);
}));

router.get('/:id', requirePermission('report.read'), wrap((req, res) => {
  const r = reportService.getReport(req.params.id);
  if (!r) return notFound(res);
  ok(res, r);
}));

router.get('/:id/export', requirePermission('report.read'), wrap((req, res) => {
  const r = reportService.getReport(req.params.id);
  if (!r) return notFound(res);
  const rows_ = [['Metric', 'Value']];
  for (const [k, v] of Object.entries(r.summary)) rows_.push([k, String(v)]);
  if (r.content && r.content.trend) {
    rows_.push([]);
    rows_.push(['Trend bucket', 'Value']);
    for (const t of r.content.trend) rows_.push([String(t.bucket), String(t.value)]);
  }
  const csv = rows_.map((r_) => r_.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="report-${r.id}.csv"`);
  res.send('\uFEFF' + csv);
}));

module.exports = router;
