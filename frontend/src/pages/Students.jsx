import { useRef, useState } from 'react';
import { api, uploadFile } from '../api/client';
import { useAsync, Loading, ErrorBox, Empty, Badge, Modal, fmtDate } from '../components/ui';

const empty = { student_code: '', full_name: '', gender: '', birth_date: '', class_id: '', notes: '' };

export default function Students() {
  const { data, loading, error, reload } = useAsync(async () => {
    const [students, classes] = await Promise.all([api('/students'), api('/classes')]);
    return { students, classes };
  }, []);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [msg, setMsg] = useState(null);
  const [tpl, setTpl] = useState('multi');
  const [tplClass, setTplClass] = useState('');
  const fileRef = useRef();

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const { students, classes } = data;
  const sampleClass = tplClass || (classes[0] ? String(classes[0].id) : '');
  const sampleParams = (format) => {
    const p = new URLSearchParams({ format, template: tpl, token: localStorage.getItem('acias_token') || '' });
    if (tpl !== 'multi' && sampleClass) p.set('class_id', sampleClass);
    return p.toString();
  };

  function openNew() {
    setForm({ ...empty, class_id: classes[0] ? String(classes[0].id) : '' });
    setEditing(null);
  }
  function openEdit(s) {
    setForm({ student_code: s.student_code, full_name: s.full_name, gender: s.gender || '', birth_date: s.birth_date || '', class_id: String(s.class_id), notes: s.notes || '' });
    setEditing(s.id);
  }

  async function save(e) {
    e.preventDefault();
    setMsg(null);
    const body = { ...form, class_id: form.class_id ? Number(form.class_id) : null };
    try {
      if (editing) await api(`/students/${editing}`, { method: 'PUT', body });
      else await api('/students', { method: 'POST', body });
      setMsg({ tone: 'success', text: 'Saved' });
      setEditing(null);
      reload();
    } catch (err) {
      setMsg({ tone: 'error', text: err.message });
    }
  }

  async function remove(id) {
    if (!window.confirm('Delete this student?')) return;
    try {
      await api(`/students/${id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      alert(err.message);
    }
  }

  async function onImportFile(file) {
    if (!file) return;
    setMsg(null);
    try {
      const res = await uploadFile('/import/students', file, 'file');
      setMsg({ tone: 'success', text: `Imported ${res.imported}, updated ${res.updated}, moved ${res.moved}, failed ${res.failed.length}` });
      reload();
    } catch (err) {
      setMsg({ tone: 'error', text: err.message });
    }
  }

  return (
    <div>
      <h1>Students</h1>
      {msg && <div className={`alert ${msg.tone}`}>{msg.text}</div>}
      <div className="spread mb">
        <div className="flex" style={{ flexWrap: 'wrap' }}>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => onImportFile(e.target.files[0])} />
          <button className="btn" onClick={() => fileRef.current.click()}>Import Excel/CSV</button>
          <div className="field" style={{ flex: '0 0 auto', minWidth: 190, margin: 0 }}>
            <select value={tpl} onChange={(e) => setTpl(e.target.value)}>
              <option value="multi">Multiple classes</option>
              <option value="single">Single class update</option>
              <option value="seats">Seat assignment</option>
            </select>
          </div>
          {tpl !== 'multi' && (
            <div className="field" style={{ flex: '0 0 auto', minWidth: 130, margin: 0 }}>
              <select value={sampleClass} onChange={(e) => setTplClass(e.target.value)}>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <a className="btn" href={`/api/import/samples?${sampleParams('csv')}`} download>Sample CSV</a>
          <a className="btn" href={`/api/import/samples?${sampleParams('xlsx')}`} download>Sample XLSX</a>
        </div>
        <button className="btn primary" onClick={openNew}>+ Add student</button>
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr><th>Code</th><th>Full name</th><th>Gender</th><th>Class</th><th>Birth date</th><th>Account</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id}>
                <td>{s.student_code}</td>
                <td>{s.full_name}</td>
                <td>{s.gender || '-'}</td>
                <td>{s.class_name || `#${s.class_id}`}</td>
                <td>{s.birth_date || '-'}</td>
                <td>{s.account_name ? <Badge tone="blue">{s.account_name}</Badge> : '-'}</td>
                <td className="flex">
                  <button className="btn small" onClick={() => openEdit(s)}>Edit</button>
                  <button className="btn small danger" onClick={() => remove(s.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {students.length === 0 && <Empty text="No students yet. Import from Excel/CSV or add manually." />}
      </div>

      {(editing !== null || form.student_code) && (
        <Modal title={editing ? 'Edit student' : 'Add student'} onClose={() => { setEditing(null); setForm(empty); }}>
          <form onSubmit={save}>
            <div className="form-row">
              <div className="field"><label>Student code</label><input value={form.student_code} onChange={(e) => setForm({ ...form, student_code: e.target.value })} required /></div>
              <div className="field"><label>Full name</label><input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></div>
            </div>
            <div className="form-row">
              <div className="field"><label>Gender</label>
                <select value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                  <option value="">-</option><option>Male</option><option>Female</option>
                </select>
              </div>
              <div className="field"><label>Birth date</label><input type="date" value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} /></div>
              <div className="field"><label>Class</label>
                <select value={form.class_id} onChange={(e) => setForm({ ...form, class_id: e.target.value })} required>
                  {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="field mb"><label>Notes</label><textarea rows="2" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <div className="flex"><button className="btn primary" type="submit">Save</button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
