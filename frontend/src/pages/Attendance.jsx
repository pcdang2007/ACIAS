import { useState } from 'react';
import { api } from '../api/client';
import { useAsync, Loading, ErrorBox, Empty, Badge, fmtDate } from '../components/ui';

const STATUS_TONE = { present: 'green', absent: 'red', late: 'amber', excused: 'gray' };

export default function Attendance() {
  const { data, loading, error, reload } = useAsync(async () => {
    const [sessions, classes, attendance] = await Promise.all([api('/sessions'), api('/classes'), api('/attendance')]);
    return { sessions, classes, attendance };
  }, []);
  const [sessionId, setSessionId] = useState('');
  const [msg, setMsg] = useState(null);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const filtered = sessionId ? data.attendance.filter((a) => String(a.session_id) === sessionId) : data.attendance;

  async function autoMark(sid) {
    setMsg(null);
    const s = data.sessions.find((x) => x.id === Number(sid));
    if (!s) return;
    try {
      const res = await api('/attendance/auto', { method: 'POST', body: { session_id: sid, class_id: s.class_id } });
      setMsg({ tone: 'success', text: res.message });
      reload();
    } catch (err) {
      setMsg({ tone: 'error', text: err.message });
    }
  }

  async function toggle(id, status) {
    const next = status === 'present' ? 'absent' : 'present';
    try {
      await api(`/attendance/${id}`, { method: 'PUT', body: { status: next } });
      reload();
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div>
      <h1>Attendance</h1>
      {msg && <div className={`alert ${msg.tone}`}>{msg.text}</div>}
      <div className="spread mb">
        <div className="flex">
          <label className="muted">Session:</label>
          <select value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
            <option value="">All sessions</option>
            {data.sessions.map((s) => <option key={s.id} value={s.id}>{s.class_name} · {s.lesson_title || s.id} ({s.status})</option>)}
          </select>
        </div>
        {sessionId && <button className="btn" onClick={() => autoMark(sessionId)}>AI auto-mark</button>}
      </div>

      <div className="card">
        <table className="tbl">
          <thead><tr><th>Student</th><th>Session</th><th>Status</th><th>Method</th><th>Timestamp</th><th></th></tr></thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.id}>
                <td>{a.full_name}</td>
                <td>{a.session_name || `#${a.session_id}`}</td>
                <td><Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge></td>
                <td><Badge tone="gray">{a.method}</Badge></td>
                <td>{fmtDate(a.timestamp)}</td>
                <td><button className="btn small" onClick={() => toggle(a.id, a.status)}>Toggle</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <Empty text="No attendance records. Open a session and use AI auto-mark." />}
      </div>
    </div>
  );
}
