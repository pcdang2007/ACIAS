import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAsync, Loading, ErrorBox, Empty, Badge, Modal, fmtDate } from '../components/ui';

export default function Sessions() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const presetClass = params.get('class_id') || '';

  const { data, loading, error, reload } = useAsync(async () => {
    const [sessions, classes, lessons, questions, users] = await Promise.all([
      api('/sessions'), api('/classes'), api('/lessons'), api('/questions'), api('/users').catch(() => [])
    ]);
    return { sessions, classes, lessons, questions, teachers: users.filter((u) => ['HOMEROOM_TEACHER', 'SUBJECT_TEACHER'].includes(u.role_code)) };
  }, []);

  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ lesson_id: '', class_id: presetClass, subject_id: '', device_id: '', notes: '' });

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  async function create(e) {
    e.preventDefault();
    try {
      const body = {
        lesson_id: form.lesson_id ? Number(form.lesson_id) : null,
        class_id: form.class_id ? Number(form.class_id) : null,
        subject_id: form.subject_id ? Number(form.subject_id) : null,
        notes: form.notes
      };
      const res = await api('/sessions', { method: 'POST', body });
      setShow(false);
      navigate(`/sessions/${res.id}/live`);
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div>
      <h1>Sessions</h1>
      <div className="spread mb">
        <span className="muted">{data.sessions.length} sessions</span>
        <button className="btn primary" onClick={() => setShow(true)}>+ New session</button>
      </div>
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Class</th><th>Lesson</th><th>Subject</th><th>Teacher</th><th>Start</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {data.sessions.map((s) => (
              <tr key={s.id}>
                <td>{s.class_name}</td>
                <td>{s.lesson_title || '-'}</td>
                <td>{s.subject_name || '-'}</td>
                <td>{s.teacher_name}</td>
                <td>{fmtDate(s.start_time)}</td>
                <td>
                  <Badge tone={s.status === 'live' ? 'green' : s.status === 'ended' ? 'gray' : 'amber'}>{s.status}</Badge>
                </td>
                <td>
                  <button className="btn small primary" onClick={() => navigate(`/sessions/${s.id}/live`)}>
                    {s.status === 'live' ? 'Open live view' : s.status === 'ended' ? 'View results' : 'Continue'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.sessions.length === 0 && <Empty text="No sessions yet. Create one to start a lesson." />}
      </div>

      {show && (
        <Modal title="New session" onClose={() => setShow(false)}>
          <form onSubmit={create}>
            <div className="form-row">
              <div className="field"><label>Class</label>
                <select value={form.class_id} onChange={(e) => setForm({ ...form, class_id: e.target.value })} required>
                  <option value="">Select class</option>
                  {data.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Lesson</label>
                <select value={form.lesson_id} onChange={(e) => setForm({ ...form, lesson_id: e.target.value })}>
                  <option value="">-</option>
                  {data.lessons.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="field"><label>Notes</label><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <button className="btn primary" type="submit">Create session</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
