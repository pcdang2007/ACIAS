import { useState } from 'react';
import { api } from '../api/client';
import { useAsync, Loading, ErrorBox, Empty, Badge, Modal } from '../components/ui';

export default function Subjects() {
  const { data, loading, error, reload } = useAsync(() => api('/subjects'), []);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ code: '', name: '' });
  const [editing, setEditing] = useState(null);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  function openNew() { setForm({ code: '', name: '' }); setEditing(null); setShow(true); }
  function openEdit(s) { setForm({ code: s.code, name: s.name }); setEditing(s.id); setShow(true); }

  async function save(e) {
    e.preventDefault();
    try {
      if (editing) await api(`/subjects/${editing}`, { method: 'PUT', body: { name: form.name } });
      else await api('/subjects', { method: 'POST', body: form });
      setShow(false);
      setForm({ code: '', name: '' });
      setEditing(null);
      reload();
    } catch (err) {
      alert(err.message);
    }
  }

  async function remove(id) {
    if (!window.confirm('Delete this subject? Related questions/lessons will lose their subject.')) return;
    try {
      await api(`/subjects/${id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div>
      <h1>Subjects</h1>
      <div className="spread mb">
        <span className="muted">{data.length} subjects</span>
        <button className="btn primary" onClick={openNew}>+ New subject</button>
      </div>
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Code</th><th>Name</th><th></th></tr></thead>
          <tbody>
            {data.map((s) => (
              <tr key={s.id}>
                <td><Badge tone="blue">{s.code}</Badge></td>
                <td>{s.name}</td>
                <td>
                  <button className="btn small" onClick={() => openEdit(s)}>Edit</button>
                  <button className="btn small danger" onClick={() => remove(s.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.length === 0 && <Empty text="No subjects." />}
      </div>

      {show && (
        <Modal title={editing ? 'Edit subject' : 'New subject'} onClose={() => setShow(false)}>
          <form onSubmit={save}>
            <div className="form-row">
              <div className="field"><label>Code</label><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required disabled={!!editing} /></div>
              <div className="field"><label>Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
            </div>
            <button className="btn primary" type="submit">Save</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
