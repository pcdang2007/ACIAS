'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { WebSocketServer } = require('ws');
const config = require('./config');
const { getDb, run, rows } = require('./db/database');
const { subscribe } = require('./services/hub');
const { authRequired, attachUser } = require('./middleware/auth');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: '25mb' }));

if (!fs.existsSync(config.uploadDir)) fs.mkdirSync(config.uploadDir, { recursive: true });
app.use('/uploads', express.static(config.uploadDir));

const upload = multer({ storage: multer.memoryStorage() });

// Health / meta
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), provider: config.aiProvider });
});

// Import endpoints (Excel/CSV upload)
app.post('/api/import/students', authRequired, upload.single('file'), (req, res) => {
  const importer = require('./services/importer');
  try {
    const result = req.file
      ? importer.importStudents({ fileBuffer: req.file.buffer }, req)
      : importer.importStudents(req.body.rows, req);
    const { audit } = require('./middleware/audit');
    audit(req.user.id, 'IMPORT_STUDENTS_FILE', 'student', null, { filename: req.file && req.file.originalname, ...result }, req);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: `Import failed: ${err.message}` });
  }
});

// Sample import file downloads (CSV / XLSX)
// Templates: multi (mixed classes, insert/update), single (one fixed class),
// seats (empty seat positions for a single class)
app.get('/api/import/samples', authRequired, (req, res) => {
  const XLSX = require('xlsx');
  const format = String(req.query.format || 'csv').toLowerCase();
  const template = String(req.query.template || 'multi').toLowerCase();
  const classParam = String(req.query.class_id || req.query.class || '');

  const classNames = rows('SELECT id, name FROM classes ORDER BY id').map((c) => c);
  const chosen = classParam
    ? classNames.find((c) => String(c.id) === classParam || c.name === classParam) || classNames[0]
    : classNames[0];
  const cls = chosen || { id: null, name: '10A1' };

  function jsonRowsToAoa(list, header) {
    return [header].concat(list.map((o) => header.map((h) => (o[h] !== undefined ? o[h] : ''))));
  }

  let aoa;
  let filename;
  if (template === 'seats') {
    const empties = cls.id
      ? rows(
          'SELECT seat_row, seat_col FROM seats WHERE class_id = ? AND (student_id IS NULL OR active = 0) ORDER BY seat_row, seat_col LIMIT 20',
          [cls.id]
        )
      : [];
    const sampleSeats = (empties.length ? empties : [{ seat_row: 1, seat_col: 1 }, { seat_row: 1, seat_col: 2 }]).map((s, i) => ({
      student_code: i === 0 ? 'HS201' : '',
      full_name: i === 0 ? 'Nguyen Van Sample' : '',
      seat_row: s.seat_row,
      seat_col: s.seat_col
    }));
    aoa = [[`class_id`, cls.name]].concat(jsonRowsToAoa(sampleSeats, ['student_code', 'full_name', 'seat_row', 'seat_col']));
    filename = `seat_assignment_template_${template}.`;
  } else if (template === 'single') {
    aoa = [
      ['class_id', cls.name],
      ['student_code', 'full_name', 'gender', 'birth_date', 'seat_row', 'seat_col', 'notes'],
      ['HS201', 'Nguyen Van Sample', 'Male', '2011-02-14', '', '', 'Example row - replace with real students'],
      ['HS202', 'Tran Thi Template', 'Female', '2011-05-30', '', '', '']
    ];
    filename = 'students_import_single_class.';
  } else {
    const sampleRows = [
      {
        student_code: 'HS201',
        full_name: 'Nguyen Van Sample',
        gender: 'Male',
        birth_date: '2011-02-14',
        class_id: classNames[0] ? classNames[0].name : '10A1',
        notes: 'Example row - replace with real students'
      },
      {
        student_code: 'HS202',
        full_name: 'Tran Thi Template',
        gender: 'Female',
        birth_date: '2011-05-30',
        class_id: classNames[1] ? classNames[1].name : '10A2',
        notes: ''
      }
    ];
    aoa = jsonRowsToAoa(sampleRows, ['student_code', 'full_name', 'gender', 'birth_date', 'class_id', 'notes']);
    filename = 'students_import_multi_class.';
  }

  try {
    if (format === 'xlsx') {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      XLSX.utils.book_append_sheet(wb, ws, 'Students');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}xlsx"`);
      return res.send(buf);
    }
    if (format === 'xls') {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      XLSX.utils.book_append_sheet(wb, ws, 'Students');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xls' });
      res.setHeader('Content-Type', 'application/vnd.ms-excel');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}xls"`);
      return res.send(buf);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const csv = XLSX.utils.sheet_to_csv(ws);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}csv"`);
    return res.send(csv);
  } catch (err) {
    return res.status(400).json({ error: `Sample generation failed: ${err.message}` });
  }
});

// Routes
const routes = {
  '/api/auth': require('./routes/auth'),
  '/api/users': require('./routes/users'),
  '/api/roles': require('./routes/roles'),
  '/api/classes': require('./routes/classes'),
  '/api/students': require('./routes/students'),
  '/api/subjects': require('./routes/subjects'),
  '/api/questions': require('./routes/questions'),
  '/api/lessons': require('./routes/lessons'),
  '/api/sessions': require('./routes/sessions'),
  '/api/answers': require('./routes/answers'),
  '/api/interactions': require('./routes/interactions'),
  '/api/seats': require('./routes/seats'),
  '/api/attendance': require('./routes/attendance'),
  '/api/reports': require('./routes/reports'),
  '/api/appeals': require('./routes/appeals'),
  '/api/devices': require('./routes/devices'),
  '/api/camera': require('./routes/camera'),
  '/api/audit': require('./routes/audit'),
  '/api/statistics': require('./routes/statistics'),
  '/api/ai': require('./routes/ai')
};
for (const [mount, r] of Object.entries(routes)) app.use(mount, r);

// Error handler
app.use((err, req, res, next) => {
  console.error('API error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ---- WebSocket for realtime events (spec section VII) ----
const { registerClient } = require('./services/hub');
const { sidOfToken } = require('./services/sessions');
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  // Bind this socket to its session so single-session kicks can reach it
  try {
    const query = req.url ? new URL(req.url, 'http://localhost').searchParams : null;
    const token = query ? query.get('token') : null;
    if (token) registerClient(sidOfToken(token), ws);
  } catch { /* ignore malformed upgrade */ }
  ws.send(JSON.stringify({ event: 'connected', payload: { message: 'ACIAS realtime channel ready' } }));
});

const unsubscribe = subscribe(({ event, payload }) => {
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(JSON.stringify({ event, payload }));
    }
  }
});

const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    if (!client.isAlive) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, 30000);

// SSE for non-WebSocket clients
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write('event: connected\ndata: {}\n\n');
  const off = subscribe(({ event, payload }) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  });
  req.on('close', off);
});

function start() {
  getDb();
  server.listen(config.port, () => {
    console.log(`ACIAS backend listening on http://localhost:${config.port}`);
    console.log(`  REST API   : http://localhost:${config.port}/api`);
    console.log(`  WebSocket  : ws://localhost:${config.port}/ws`);
    console.log(`  SSE        : http://localhost:${config.port}/api/events`);
  });
}

function stop() {
  clearInterval(heartbeat);
  unsubscribe();
  require('./ai/engine').stopAll();
  require('./ai/feed').stopAllFeeds();
  if (server.listening) server.close();
}

if (require.main === module) {
  start();
}

module.exports = { app, server, start, stop };
