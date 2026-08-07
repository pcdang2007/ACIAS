import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAsync, Loading, ErrorBox, Empty, Badge, Modal, fmtDate } from '../components/ui';

const empty = { code: '', title: '', subject_id: '', teacher_id: '', class_id: '', scheduled_at: '', status: 'scheduled' };

export default function Lessons() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsync(async () => {
    const [lessons, subjects, classes, users] = await Promise.all([
      api('/lessons'), api('/subjects'), api('/classes'), api('/users').catch(() => [])
    ]);
    return { lessons, subjects, classes, teachers: users.filter((u) => ['HOMEROOM_TEACHER', 'SUBJECT_TEACHER'].includes(u.role_code)) };
  }, []);
  const [form, setForm] = useState(empty);
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState(null);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  function toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function openEdit(l) {
    setForm({
      code: l.code || '',
      title: l.title,
      subject_id: l.subject_id ? String(l.subject_id) : '',
      teacher_id: l.teacher_id ? String(l.teacher_id) : '',
      class_id: l.class_id ? String(l.class_id) : '',
      scheduled_at: toLocalInput(l.scheduled_at),
      status: l.status || 'scheduled'
    });
    setEditing(l.id);
    setShow(true);
  }

  async function save(e) {
    e.preventDefault();
    const body = {
      ...form,
      subject_id: form.subject_id ? Number(form.subject_id) : null,
      teacher_id: form.teacher_id ? Number(form.teacher_id) : null,
      class_id: form.class_id ? Number(form.class_id) : null,
      scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null
    };
    try {
      if (editing) await api(`/lessons/${editing}`, { method: 'PUT', body });
      else await api('/lessons', { method: 'POST', body });
      setShow(false);
      setForm(empty);
      setEditing(null);
      reload();
    } catch (err) {
      alert(err.message);
    }
  }

  async function remove(l) {
    if (!window.confirm(`Delete lesson "${l.title}"? Its sessions will also be deleted.`)) return;
    try {
      await api(`/lessons/${l.id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      alert(err.message);
    }
  }

  async function startSession(lesson) {
    try {
      const body = { lesson_id: lesson.id, class_id: lesson.class_id, subject_id: lesson.subject_id, teacher_id: lesson.teacher_id };
      const res = await api('/sessions', { method: 'POST', body });
      navigate(`/sessions/${res.id}/live`);
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div>
      <h1>Lessons</h1>
      <div className="spread mb">
        <span className="muted">{data.lessons.length} lessons</span>
        <button className="btn primary" onClick={() => setShow(true)}>+ New lesson</button>
      </div>
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Code</th><th>Title</th><th>Subject</th><th>Class</th><th>Teacher</th><th>Scheduled</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {data.lessons.map((l) => (
              <tr key={l.id}>
                <td>{l.code}</td>
                <td>{l.title}</td>
                <td>{l.subject_name || '-'}</td>
                <td>{l.class_name || '-'}</td>
                <td>{l.teacher_name || '-'}</td>
                <td>{fmtDate(l.scheduled_at)}</td>
                <td><Badge tone={l.status === 'scheduled' ? 'blue' : l.status === 'completed' ? 'green' : 'gray'}>{l.status}</Badge></td>
                <td><button className="btn small primary" onClick={() => startSession(l)}>Start session</button></td>
                <td>
                  <button className="btn small" onClick={() => openEdit(l)}>Edit</button>
                  <button className="btn small danger" onClick={() => remove(l)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.lessons.length === 0 && <Empty text="No lessons yet." />}
      </div>

      {show && (
        <Modal title={editing ? 'Edit lesson' : 'New lesson'} onClose={() => { setShow(false); setEditing(null); setForm(empty); }}>
          <form onSubmit={save}>
            <div className="form-row">
              <div className="field"><label>Title</label><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /></div>
              <div className="field"><label>Code</label><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="L-..." /></div>
            </div>
            <div className="form-row">
              <div className="field"><label>Subject</label>
                <select value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })}>
                  <option value="">-</option>{data.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Class</label>
                <select value={form.class_id} onChange={(e) => setForm({ ...form, class_id: e.target.value })}>
                  <option value="">-</option>{data.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Teacher</label>
                <select value={form.teacher_id} onChange={(e) => setForm({ ...form, teacher_id: e.target.value })}>
                  <option value="">-</option>{data.teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="field"><label>Scheduled at</label><input type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} /></div>
            </div>
            <button className="btn primary" type="submit">Save</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
