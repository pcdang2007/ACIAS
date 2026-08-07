import { useState } from 'react';
import { api } from '../api/client';
import { useAsync, Loading, ErrorBox, Empty, Badge, Modal } from '../components/ui';

const TYPES = ['webcam', 'ip_camera', 'smartphone', 'usb_camera', 'microphone', 'audio_recorder'];

export default function Devices() {
  const { data, loading, error, reload } = useAsync(() => api('/devices'), []);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'webcam', stream_url: '', location: '' });
  const [editing, setEditing] = useState(null);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  function openNew() { setForm({ name: '', type: 'webcam', stream_url: '', location: '' }); setEditing(null); setShow(true); }
  function openEdit(d) {
    setForm({ name: d.name, type: d.type, stream_url: d.stream_url || '', location: d.location || '' });
    setEditing(d.id);
    setShow(true);
  }

  async function save(e) {
    e.preventDefault();
    try {
      if (editing) await api(`/devices/${editing}`, { method: 'PUT', body: form });
      else await api('/devices', { method: 'POST', body: form });
      setShow(false);
      setForm({ name: '', type: 'webcam', stream_url: '', location: '' });
      setEditing(null);
      reload();
    } catch (err) {
      alert(err.message);
    }
  }

  async function toggleStatus(d) {
    const next = d.status === 'online' ? 'offline' : 'online';
    try {
      await api(`/devices/${d.id}`, { method: 'PUT', body: { status: next } });
      reload();
    } catch (err) {
      alert(err.message);
    }
  }

  async function remove(id) {
    if (!window.confirm('Delete this device? Seats assigned to it will be unassigned.')) return;
    try {
      await api(`/devices/${id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div>
      <h1>Devices</h1>
      <p className="muted">Input devices: webcam, IP camera, smartphone, USB camera, microphone, audio recorder.</p>
      <div className="spread mb">
        <span className="muted">{data.length} devices</span>
        <button className="btn primary" onClick={openNew}>+ Register device</button>
      </div>
      <div className="grid cols-3">
        {data.map((d) => (
          <div className="card" key={d.id}>
            <div className="spread">
              <h3 style={{ margin: 0 }}>{d.name}</h3>
              <Badge tone={d.status === 'online' ? 'green' : 'gray'}>{d.status}</Badge>
            </div>
            <div className="muted mt">{d.type}</div>
            <div className="muted">{d.location || '—'}</div>
            <div className="muted" style={{ fontSize: 12 }}>{d.stream_url || 'no stream url'}</div>
            <div className="flex mt">
              <button className="btn small" onClick={() => toggleStatus(d)}>Toggle status</button>
              <button className="btn small" onClick={() => openEdit(d)}>Edit</button>
              <button className="btn small danger" onClick={() => remove(d.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
      {data.length === 0 && <Empty text="No devices registered." />}

      {show && (
        <Modal title={editing ? 'Edit device' : 'Register device'} onClose={() => setShow(false)}>
          <form onSubmit={save}>
            <div className="form-row">
              <div className="field"><label>Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
              <div className="field"><label>Type</label>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="field"><label>Stream URL</label><input value={form.stream_url} onChange={(e) => setForm({ ...form, stream_url: e.target.value })} placeholder="rtsp://..." /></div>
              <div className="field"><label>Location</label><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
            </div>
            <button className="btn primary" type="submit">{editing ? 'Save' : 'Register'}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
