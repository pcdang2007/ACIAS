import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAsync, Loading, ErrorBox, Empty, Modal, fmtDate } from '../components/ui';

export default function Seats() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('class_id') || '';

  const { data, loading, error, reload } = useAsync(async () => {
    const classes = await api('/classes');
    let seatsData = { seats: [], history: [] };
    let students = [];
    if (selected) {
      [seatsData, students] = await Promise.all([
        api(`/seats?class_id=${selected}`),
        api(`/students?class_id=${selected}`)
      ]);
    }
    return { classes, seats: seatsData.seats, history: seatsData.history, students };
  }, [selected]);

  const [assign, setAssign] = useState(null);
  const [gridOpen, setGridOpen] = useState(false);
  const [gridForm, setGridForm] = useState({ rows: 5, cols: 8 });

  const grid = useMemo(() => {
    if (!data) return [];
    const rows = [];
    for (const s of data.seats) {
      rows[s.seat_row] = rows[s.seat_row] || [];
      rows[s.seat_row][s.seat_col] = s;
    }
    return rows;
  }, [data]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  async function assignStudent(seatId, studentId) {
    try {
      await api(`/seats/${seatId}`, { method: 'PUT', body: { student_id: studentId ? Number(studentId) : null } });
      setAssign(null);
      reload();
    } catch (err) {
      alert(err.message);
    }
  }

  async function clearSeat(seatId) {
    await assignStudent(seatId, '');
  }

  async function createGrid(e) {
    e.preventDefault();
    try {
      await api('/seats/grid', { method: 'POST', body: { class_id: Number(selected), rows: Number(gridForm.rows), cols: Number(gridForm.cols) } });
      setGridOpen(false);
      reload();
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div>
      <h1>Seating Chart</h1>
      <div className="mb flex">
        <label className="muted">Class:</label>
        <select value={selected} onChange={(e) => setParams(e.target.value ? { class_id: e.target.value } : {})}>
          <option value="">Select a class</option>
          {data.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {selected && (
        <div className="grid cols-2">
          <div className="card">
            <div className="spread">
              <h3>Seat map <span className="muted">(front of class on top)</span></h3>
              <button className="btn small" onClick={() => setGridOpen(true)}>Create grid</button>
            </div>
            {grid.length === 0 ? (
              <Empty text="No seats configured for this class. Create a blank grid to get started." />
            ) : (
              <div className="front-arrow" title="Front of class">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="20" y1="12" x2="4" y2="12" />
                  <polyline points="11 5 4 12 11 19" />
                </svg>
              </div>
            )}
            {grid.length > 0 && (
              <div className="seat-grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, grid.reduce((m, r) => Math.max(m, (r || []).length), 0))}, minmax(90px, 1fr))` }}>
                {grid.map((row, ri) =>
                  (row || []).map((seat, ci) => seat ? (
                    <div className={`seat ${seat.student_id ? '' : 'free'}`} key={seat.id}>
                      <div className="pos">R{seat.seat_row}-C{seat.seat_col}</div>
                      <div className="hl">{seat.student_id ? seat.full_name : 'Free'}</div>
                      {seat.student_id && <div className="muted" style={{ fontSize: 11 }}>{seat.student_code}</div>}
                      <div className="flex" style={{ justifyContent: 'center', marginTop: 4 }}>
                        <button className="btn small" title="Assign student" onClick={() => setAssign(seat)}>
                          <svg className="bico" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                            <line x1="19" y1="8" x2="19" y2="14" />
                            <line x1="22" y1="11" x2="16" y2="11" />
                          </svg>
                          <span className="btxt">Assign</span>
                        </button>
                        {seat.student_id && <button className="btn small danger" title="Clear seat" onClick={() => clearSeat(seat.id)}>
                          <svg className="bico" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                          <span className="btxt">Clear</span>
                        </button>}
                      </div>
                    </div>
                  ) : <div key={`${ri}-${ci}`} />
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <h3>Seat change history</h3>
            <table className="tbl">
              <thead><tr><th>Student</th><th>From → To</th><th>Reason</th><th>Changed at</th></tr></thead>
              <tbody>
                {data.history.slice(0, 20).map((h) => (
                  <tr key={h.id}>
                    <td>#{h.student_id}</td>
                    <td>{h.from_seat_id ? `#${h.from_seat_id}` : '—'} → #{h.to_seat_id || '—'}</td>
                    <td>{h.reason}</td>
                    <td>{fmtDate(h.changed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.history.length === 0 && <Empty text="No changes recorded yet." />}
          </div>
        </div>
      )}

      {gridOpen && (
        <Modal title="Create seating grid" onClose={() => setGridOpen(false)}>
          <form onSubmit={createGrid}>
            <div className="form-row">
              <div className="field"><label>Rows</label><input type="number" min="1" max="50" value={gridForm.rows} onChange={(e) => setGridForm({ ...gridForm, rows: e.target.value })} required /></div>
              <div className="field"><label>Columns</label><input type="number" min="1" max="50" value={gridForm.cols} onChange={(e) => setGridForm({ ...gridForm, cols: e.target.value })} required /></div>
            </div>
            <div className="muted mb" style={{ fontSize: 12 }}>Creates {gridForm.rows} × {gridForm.cols} empty seat positions for this class. Existing seats are kept.</div>
            <div className="flex"><button className="btn primary" type="submit">Create</button></div>
          </form>
        </Modal>
      )}

      {assign && (
        <Modal title={`Assign student to seat R${assign.seat_row}-C${assign.seat_col}`} onClose={() => setAssign(null)}>
          <div className="field mb">
            <label>Student</label>
            <select value="" onChange={(e) => { const v = e.target.value; if (v) assignStudent(assign.id, v); }}>
              <option value="">Select...</option>
              {data.students.map((s) => <option key={s.id} value={s.id}>{s.full_name} ({s.student_code})</option>)}
            </select>
          </div>
          <button className="btn" onClick={() => { assignStudent(assign.id, ''); setAssign(null); }}>Leave empty</button>
        </Modal>
      )}
    </div>
  );
}
