'use strict';

const { run, now } = require('../db/database');

function audit(userId, action, entity, entityId, detail, req) {
  const ip = req ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '') : '';
  run(
    'INSERT INTO audit_logs (user_id, action, entity, entity_id, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [userId || null, action, entity || null, entityId ?? null, detail ? JSON.stringify(detail) : null, ip, now()]
  );
}

function auditMiddleware(action, entity) {
  return (req, res, next) => {
    const original = res.json.bind(res);
    res.json = (body) => {
      audit(
        req.user ? req.user.id : null,
        action,
        entity,
        body && typeof body === 'object' && body.id != null ? body.id : req.params.id || null,
        { method: req.method, body: req.body },
        req
      );
      return original(body);
    };
    next();
  };
}

module.exports = { audit, auditMiddleware };
