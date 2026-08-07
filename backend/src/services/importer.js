'use strict';

const XLSX = require('xlsx');
const { row, rows, run, now, transaction } = require('../db/database');

const COLUMN_MAP = {
  student_code: ['student_code', 'code', 'mahs', 'ma hoc sinh'],
  full_name: ['full_name', 'name', 'hoten', 'ho va ten'],
  gender: ['gender', 'gioitinh', 'sex'],
  birth_date: ['birth_date', 'birthdate', 'ngaysinh'],
  class_id: ['class_id', 'class', 'lop'],
  seat_row: ['seat_row', 'seatrow', 'row', 'hang', 'day'],
  seat_col: ['seat_col', 'seatcol', 'col', 'column', 'cot'],
  notes: ['notes', 'ghichu', 'note']
};

function normalizeHeader(h) {
  if (h == null) return '';
  return String(h).trim().toLowerCase().replace(/[\s_]+/g, ' ');
}

function findKey(header) {
  if (header == null) return null;
  const raw = String(header).trim();
  const n = raw.toLowerCase().replace(/[\s_]+/g, ' ');
  for (const [key, aliases] of Object.entries(COLUMN_MAP)) {
    if (aliases.includes(raw) || aliases.includes(n)) return key;
  }
  return null;
}

function mapRow(rowObj) {
  const out = {};
  for (const [key, aliases] of Object.entries(COLUMN_MAP)) {
    for (const [rawKey, value] of Object.entries(rowObj)) {
      const norm = normalizeHeader(rawKey);
      if (aliases.includes(norm) || aliases.includes(rawKey)) {
        out[key] = value;
        break;
      }
    }
  }
  return out;
}

/**
 * Parse a worksheet into plain row objects.
 * Supports an optional fixed-class marker row like `class_id,10A1` (or `class,10A1`)
 * before the header, which becomes the default class for rows without their own class.
 * Also supports seat_row / seat_col columns for seating imports.
 */
function parseSheet(sheet) {
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  let defaultClass = null;
  let headerIndex = -1;

  for (let i = 0; i < aoa.length; i++) {
    const r = aoa[i];
    if (!r || !r.length) continue;
    const flat = r.filter((v) => v != null && String(v).trim() !== '');
    if (flat.length === 2 && findKey(String(flat[0]).trim()) === 'class_id') {
      defaultClass = String(flat[1]).trim();
      continue;
    }
    if (r.some((v) => findKey(v) === 'student_code')) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) throw new Error('No header row found (expected a student_code column)');

  const header = aoa[headerIndex].map((v) => findKey(v));
  const out = [];
  for (let i = headerIndex + 1; i < aoa.length; i++) {
    const r = aoa[i];
    if (!r || !r.length || r.every((v) => v == null || String(v).trim() === '')) continue;
    const obj = {};
    header.forEach((key, idx) => {
      if (!key) return;
      const v = r[idx];
      if (v != null && String(v).trim() !== '') obj[key] = v;
    });
    if (!obj.class_id && defaultClass) obj.class_id = defaultClass;
    out.push(obj);
  }
  return out;
}

function classIdFromName(name) {
  if (!name) return null;
  const c = row('SELECT id FROM classes WHERE id = ? OR name = ?', [name, name]);
  return c ? c.id : null;
}

/**
 * Import students from an array of plain objects or an uploaded file buffer.
 *
 * Existing students (matched by student_code) are UPDATED; new ones are created.
 * Rows may carry seat_row / seat_col to assign or move students to a seat within
 * their class (moves are logged in seat_history). Seat conflicts are rejected.
 *
 * Returns { imported, updated, moved, failed }.
 */
function importStudents(payload, req) {
  let records = [];
  if (Array.isArray(payload)) {
    records = payload.map(mapRow);
  } else if (payload && payload.fileBuffer) {
    const wb = XLSX.read(payload.fileBuffer, { type: 'buffer' });
    records = parseSheet(wb.Sheets[wb.SheetNames[0]]);
  } else if (payload && payload.filePath) {
    const wb = XLSX.readFile(payload.filePath);
    records = parseSheet(wb.Sheets[wb.SheetNames[0]]);
  }

  const result = { imported: 0, updated: 0, moved: 0, failed: [] };

  transaction(() => {
    // ---- Pass 1: validate rows and resolve classes ----
    const decisions = [];
    for (const rec of records) {
      const m = mapRow(rec);
      const student_code = m.student_code != null ? String(m.student_code).trim() : '';
      const full_name = m.full_name != null ? String(m.full_name).trim() : '';
      if (!student_code || !full_name) {
        result.failed.push({ record: m, reason: 'missing student_code or full_name' });
        continue;
      }
      const existing = row('SELECT id, class_id FROM students WHERE student_code = ?', [student_code]);
      let classId = null;
      if (m.class_id != null) {
        classId = classIdFromName(m.class_id);
        if (classId == null) {
          result.failed.push({ record: m, reason: `unknown class ${m.class_id}` });
          continue;
        }
      } else if (existing) {
        classId = existing.class_id;
      } else {
        result.failed.push({ record: m, reason: 'class_id is required for new students' });
        continue;
      }
      const sr = parseInt(m.seat_row, 10);
      const sc = parseInt(m.seat_col, 10);
      decisions.push({
        m,
        student_code,
        full_name,
        existing,
        classId,
        seatRow: Number.isInteger(sr) ? sr : null,
        seatCol: Number.isInteger(sc) ? sc : null,
        seatFail: null
      });
    }

    // Seat targets by student code (for conflict detection across the whole file)
    const seatByCode = new Map();
    for (const d of decisions) {
      if (d.seatRow != null && d.seatCol != null) {
        seatByCode.set(d.student_code, { classId: d.classId, row: d.seatRow, col: d.seatCol });
      }
    }

    // Reject duplicate seat targets within the file
    const seenSeats = new Map();
    for (const d of decisions) {
      if (d.seatRow == null || d.seatCol == null) continue;
      const key = `${d.classId}:${d.seatRow}:${d.seatCol}`;
      const owner = seenSeats.get(key);
      if (owner && owner !== d.student_code) {
        d.seatFail = `duplicate seat (row ${d.seatRow}, col ${d.seatCol}) in import`;
      } else {
        seenSeats.set(key, d.student_code);
      }
    }

    // Reject rows whose target seat is occupied by a student that is not moving
    for (const d of decisions) {
      if (d.seatFail || d.seatRow == null || d.seatCol == null) continue;
      const occupant = row(
        'SELECT student_id FROM seats WHERE class_id = ? AND seat_row = ? AND seat_col = ? AND active = 1',
        [d.classId, d.seatRow, d.seatCol]
      );
      if (!occupant || occupant.student_id == null) continue;
      if (d.existing && occupant.student_id === d.existing.id) continue;
      const occ = row('SELECT student_code FROM students WHERE id = ?', [occupant.student_id]);
      const occTarget = occ ? seatByCode.get(occ.student_code) : null;
      const sameTarget = occTarget && occTarget.classId === d.classId && occTarget.row === d.seatRow && occTarget.col === d.seatCol;
      if (!occTarget || sameTarget) {
        d.seatFail = `seat (row ${d.seatRow}, col ${d.seatCol}) occupied by ${occ ? occ.student_code : '#' + occupant.student_id}`;
      }
    }

    // ---- Pass 2: insert / update students ----
    const seatOps = [];
    for (const d of decisions) {
      if (d.seatFail) {
        result.failed.push({ record: d.m, reason: d.seatFail });
        continue;
      }
      const gender = d.m.gender != null ? String(d.m.gender) : null;
      const birth_date = d.m.birth_date != null ? String(d.m.birth_date) : null;
      const notes = d.m.notes != null ? String(d.m.notes) : null;
      let studentId;
      if (d.existing) {
        run(
          'UPDATE students SET full_name = COALESCE(?, full_name), gender = COALESCE(?, gender), birth_date = COALESCE(?, birth_date), class_id = COALESCE(?, class_id), notes = COALESCE(?, notes) WHERE id = ?',
          [d.full_name, gender, birth_date, d.classId, notes, d.existing.id]
        );
        studentId = d.existing.id;
        result.updated += 1;
      } else {
        studentId = run(
          'INSERT INTO students (student_code, full_name, gender, birth_date, class_id, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [d.student_code, d.full_name, gender, birth_date, d.classId, notes, now()]
        ).lastInsertRowid;
        result.imported += 1;
      }
      if (d.seatRow != null && d.seatCol != null) {
        seatOps.push({ studentId, classId: d.classId, row: d.seatRow, col: d.seatCol });
      }
    }

    // ---- Pass 3: apply seating changes ----
    if (seatOps.length) {
      const oldSeats = new Map();
      for (const op of seatOps) {
        const cur = row('SELECT id, seat_row, seat_col FROM seats WHERE student_id = ?', [op.studentId]);
        if (cur) oldSeats.set(op.studentId, cur);
      }

      const targets = [];
      const targetSeatIds = new Set();
      for (const op of seatOps) {
        const t = row('SELECT id FROM seats WHERE class_id = ? AND seat_row = ? AND seat_col = ?', [op.classId, op.row, op.col]);
        if (t) {
          targets.push({ ...op, seatId: t.id });
          targetSeatIds.add(t.id);
        } else {
          targets.push({ ...op, seatId: null });
        }
      }

      // Clear old seats of moving students unless that seat is itself a target
      for (const op of seatOps) {
        const cur = oldSeats.get(op.studentId);
        if (cur && !targetSeatIds.has(cur.id)) run('UPDATE seats SET student_id = NULL WHERE id = ?', [cur.id]);
      }

      for (const t of targets) {
        if (t.seatId) run('UPDATE seats SET student_id = ? WHERE id = ?', [t.studentId, t.seatId]);
        else run('INSERT INTO seats (class_id, student_id, seat_row, seat_col, active) VALUES (?, ?, ?, ?, 1)', [t.classId, t.studentId, t.row, t.col]);
      }

      for (const t of targets) {
        const old = oldSeats.get(t.studentId);
        const changed = !old || old.seat_row !== t.row || old.seat_col !== t.col;
        if (changed) {
          run(
            'INSERT INTO seat_history (class_id, student_id, from_seat_id, to_seat_id, reason, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [t.classId, t.studentId, old ? old.id : null, t.seatId, 'bulk import', req.user ? req.user.id : null, now()]
          );
          result.moved += 1;
        }
      }
    }
  });

  return result;
}

module.exports = { importStudents };
