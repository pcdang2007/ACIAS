'use strict';

const express = require('express');
const { row, rows, run, transaction, now } = require('../db/database');
const { authRequired, requirePermission } = require('../middleware/auth');
const { audit } = require('../middleware/audit');
const { wrap, ok, created, bad, notFound, canAccessClass } = require('./helpers');

const router = express.Router();
router.use(authRequired);

router.get('/', requirePermission('seat.read'), wrap((req, res) => {
  const { class_id } = req.query;
  if (!class_id) return bad(res, 'class_id query is required');
  if (!canAccessClass(req.user, class_id)) return res.status(403).json({ error: 'Forbidden' });
  const seats = rows(
    `SELECT s.id, s.class_id, s.student_id, s.seat_row, s.seat_col, s.camera_id, s.active,
            st.student_code, st.full_name, st.gender
     FROM seats s LEFT JOIN students st ON st.id = s.student_id
     WHERE s.class_id = ? ORDER BY s.seat_row, s.seat_col`,
    [class_id]
  );
  const history = rows('SELECT * FROM seat_history WHERE class_id = ? ORDER BY id DESC LIMIT 50', [class_id]);
  ok(res, { seats, history });
}));

router.post('/', requirePermission('seat.write'), wrap((req, res) => {
  const { class_id, student_id, seat_row, seat_col, camera_id } = req.body || {};
  if (!class_id || seat_row == null || seat_col == null) return bad(res, 'class_id, seat_row, seat_col are required');
  const existing = row('SELECT * FROM seats WHERE class_id = ? AND seat_row = ? AND seat_col = ?', [class_id, seat_row, seat_col]);
  if (existing) return bad(res, 'Seat already occupied');
  const id = run('INSERT INTO seats (class_id, student_id, seat_row, seat_col, camera_id, active) VALUES (?, ?, ?, ?, ?, 1)', [
    class_id, student_id || null, seat_row, seat_col, camera_id || null
  ]).lastInsertRowid;
  audit(req.user.id, 'CREATE_SEAT', 'seat', id, req.body, req);
  created(res, { id });
}));

// Create or resize a blank grid of empty seats for a class (rows x cols positions).
// Shrinking removes only empty (unassigned, no camera) seats outside the new bounds;
// assigned or camera seats outside the bounds are kept.
router.post('/grid', requirePermission('seat.write'), wrap((req, res) => {
  const { class_id, rows: r, cols: c } = req.body || {};
  const rowsNum = parseInt(r, 10);
  const colsNum = parseInt(c, 10);
  if (!class_id || !Number.isInteger(rowsNum) || !Number.isInteger(colsNum)) return bad(res, 'class_id, rows, cols are required');
  if (rowsNum < 1 || rowsNum > 50 || colsNum < 1 || colsNum > 50) return bad(res, 'rows and cols must be between 1 and 50');
  if (!canAccessClass(req.user, class_id)) return res.status(403).json({ error: 'Forbidden' });
  transaction(() => {
    const existingSeats = rows('SELECT id, seat_row, seat_col, student_id, camera_id FROM seats WHERE class_id = ?', [class_id]);
    const existing = new Set(existingSeats.map((s) => `${s.seat_row}:${s.seat_col}`));
    let removedCount = 0;
    for (const s of existingSeats) {
      if (s.seat_row <= rowsNum && s.seat_col <= colsNum) continue;
      if (s.student_id != null || s.camera_id != null) continue;
      run('DELETE FROM seats WHERE id = ?', [s.id]);
      removedCount++;
    }
    let createdCount = 0;
    for (let ri = 1; ri <= rowsNum; ri++) {
      for (let ci = 1; ci <= colsNum; ci++) {
        if (existing.has(`${ri}:${ci}`)) continue;
        run('INSERT INTO seats (class_id, student_id, seat_row, seat_col, active) VALUES (?, NULL, ?, ?, 1)', [class_id, ri, ci]);
        createdCount++;
      }
    }
    audit(req.user.id, 'CREATE_SEAT_GRID', 'seat', null, { class_id, rows: rowsNum, cols: colsNum, created: createdCount, removed: removedCount }, req);
    ok(res, {
      message: `${createdCount} seats created, ${removedCount} seats removed`,
      created: createdCount,
      removed: removedCount
    });
  });
}));

router.put('/:id', requirePermission('seat.write'), wrap((req, res) => {
  const { student_id, seat_row, seat_col, camera_id, active } = req.body || {};
  const seat = row('SELECT * FROM seats WHERE id = ?', [req.params.id]);
  if (!seat) return notFound(res);

  const target = student_id === undefined ? seat.student_id : student_id;
  const currentHolder = seat.student_id != null ? seat.student_id : null;
  // The student being placed, and their current seat elsewhere (if any)
  const placed = target != null ? row('SELECT * FROM seats WHERE student_id = ?', [target]) : null;
  const displaced = currentHolder != null && target != null && currentHolder !== target ? currentHolder : null;

  // Clear the placed student's previous seat (different seat)
  if (placed && placed.id !== seat.id) {
    run('UPDATE seats SET student_id = NULL WHERE id = ?', [placed.id]);
  }
  // Keep updating seat_row/col/camera/active as before
  run(
    'UPDATE seats SET student_id = ?, seat_row = COALESCE(?, seat_row), seat_col = COALESCE(?, seat_col), camera_id = ?, active = COALESCE(?, active) WHERE id = ?',
    [target, seat_row, seat_col, camera_id ?? seat.camera_id, active, req.params.id]
  );

  // History: only when the occupant actually changed
  const changed = target !== currentHolder || (placed && placed.id !== seat.id);
  if (changed) {
    if (displaced != null) {
      run('INSERT INTO seat_history (class_id, student_id, from_seat_id, to_seat_id, reason, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        seat.class_id, displaced, seat.id, null, 'seat reassigned', req.user.id, now()
      ]);
    }
    if (target != null) {
      run('INSERT INTO seat_history (class_id, student_id, from_seat_id, to_seat_id, reason, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        seat.class_id, target, placed && placed.id !== seat.id ? placed.id : null, seat.id, 'seat assigned', req.user.id, now()
      ]);
    } else if (currentHolder != null) {
      run('INSERT INTO seat_history (class_id, student_id, from_seat_id, to_seat_id, reason, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        seat.class_id, currentHolder, seat.id, null, 'seat cleared', req.user.id, now()
      ]);
    }
  }

  audit(req.user.id, 'UPDATE_SEAT', 'seat', req.params.id, req.body, req);
  ok(res, { message: 'Seat updated' });
}));

/**
 * Change seat for a student, recording history (spec section II.B).
 */
router.post('/move', requirePermission('seat.write'), wrap((req, res) => {
  const { student_id, from_seat_id, to_seat_id, reason } = req.body || {};
  if (!student_id || !to_seat_id) return bad(res, 'student_id and to_seat_id are required');
  const to = row('SELECT * FROM seats WHERE id = ?', [to_seat_id]);
  const from = from_seat_id ? row('SELECT * FROM seats WHERE id = ?', [from_seat_id]) : null;
  if (!to) return notFound(res);
  if (to.student_id) return bad(res, 'Target seat is occupied');
  const prevHolder = row('SELECT * FROM seats WHERE student_id = ?', [student_id]);
  run('UPDATE seats SET student_id = ? WHERE id = ?', [student_id, to_seat_id]);
  if (from) run('UPDATE seats SET student_id = NULL WHERE id = ?', [from_seat_id]);
  if (prevHolder && prevHolder.id !== to_seat_id) run('UPDATE seats SET student_id = NULL WHERE id = ?', [prevHolder.id]);
  run('INSERT INTO seat_history (class_id, student_id, from_seat_id, to_seat_id, reason, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    to.class_id, student_id, from ? from.id : null, to.id, reason || 'seat change', req.user.id, now()
  ]);
  audit(req.user.id, 'MOVE_STUDENT_SEAT', 'seat', to_seat_id, req.body, req);
  ok(res, { message: 'Seat moved' });
}));

router.delete('/:id', requirePermission('seat.write'), wrap((req, res) => {
  run('DELETE FROM seats WHERE id = ?', [req.params.id]);
  audit(req.user.id, 'DELETE_SEAT', 'seat', req.params.id, null, req);
  ok(res, { message: 'Seat deleted' });
}));

module.exports = router;
