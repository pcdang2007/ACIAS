import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAsync, Loading, ErrorBox, Empty, Modal, fmtDate } from '../components/ui';

const empty = { name: '', grade: '', room: '', subjects: '', homeroom_teacher_id: '', academic_year: '' };

export default function Classes() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useAsync(async () => {
    const [classes, teachers] = await Promise.all([
      api('/classes'),
      api('/users').catch(() => [])
    ]);
    return { classes, teachers: teachers.filter((u) => ['HOMEROOM_TEACHER', 'SUBJECT_TEACHER'].includes(u.role_code)) };
  }, []);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState(null);
  const [show, setShow] = useState(false);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  function openNew() { setForm(empty); setEditing(null); setShow(true); }
  function openEdit(c) {
    setForm({ name: c.name, grade: c.grade || '', room: c.room || '', subjects: c.subjects || '', homeroom_teacher_id: c.homeroom_teacher_id ? String(c.homeroom_teacher_id) : '', academic_year: c.academic_year || '' });
    setEditing(c.id);
    setShow(true);
  }

  async function save(e) {
    e.preventDefault();
    const body = { ...form, homeroom_teacher_id: form.homeroom_teacher_id ? Number(form.homeroom_teacher_id) : null };
    try {
      if (editing) await api(`/classes/${editing}`, { method: 'PUT', body });
      else await api('/classes', { method: 'POST', body });
      setShow(false);
      reload();
    } catch (err) {
      alert(err.message);
    }
  }

  async function remove(id) {
    if (!window.confirm('Delete this class? All students, lessons and sessions in it will also be deleted.')) return;
    try {
      await api(`/classes/${id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div>
      <h1>Classes</h1>
      <div className="spread mb">
        <span className="muted">{data.classes.length} classes</span>
        <button className="btn primary" onClick={openNew}>+ New class</button>
      </div>
      <div className="grid cols-3">
        {data.classes.map((c) => (
          <div className="card" key={c.id}>
            <div className="spread">
              <h3 style={{ margin: 0 }}>{c.name}</h3>
              <span className="muted">{c.grade || ''}</span>
            </div>
            <p className="muted" style={{ margin: '8px 0' }}>Room {c.room || '—'} · {c.academic_year || '—'}</p>
            <div className="muted mb">Homeroom: {c.homeroom_teacher_name || '—'}</div>
            <div className="flex">
              <button className="btn small primary" onClick={() => navigate('/seats?class_id=' + c.id)}>Seating</button>
              <button className="btn small" onClick={() => navigate('/sessions?class_id=' + c.id)}>Sessions</button>
              <button className="btn small" onClick={() => openEdit(c)}>Edit</button>
              <button className="btn small danger" onClick={() => remove(c.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
      {data.classes.length === 0 && <Empty text="No classes yet" />}

      {show && (
        <Modal title={editing ? 'Edit class' : 'New class'} onClose={() => setShow(false)}>
          <form onSubmit={save}>
            <div className="form-row">
              <div className="field"><label>Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
              <div className="field"><label>Grade</label><input value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} /></div>
            </div>
            <div className="form-row">
              <div className="field"><label>Room</label><input value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} /></div>
              <div className="field"><label>Academic year</label><input value={form.academic_year} onChange={(e) => setForm({ ...form, academic_year: e.target.value })} /></div>
            </div>
            <div className="form-row">
              <div className="field"><label>Subjects (codes, comma separated)</label><input value={form.subjects} onChange={(e) => setForm({ ...form, subjects: e.target.value })} /></div>
              <div className="field"><label>Homeroom teacher</label>
                <select value={form.homeroom_teacher_id} onChange={(e) => setForm({ ...form, homeroom_teacher_id: e.target.value })}>
                  <option value="">-</option>
                  {data.teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                </select>
              </div>
            </div>
            <button className="btn primary" type="submit">Save</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
