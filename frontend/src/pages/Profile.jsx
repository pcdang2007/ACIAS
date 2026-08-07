import { useState } from 'react';
import { api } from '../api/client';
import { useAsync, Loading, ErrorBox, Badge, fmtDate } from '../components/ui';
import { useAuth } from '../context/AuthContext';

export default function Profile() {
  const { user } = useAuth();
  const { data, loading, error } = useAsync(() => api('/auth/me'), []);
  const [form, setForm] = useState({ full_name: '', email: '', phone: '' });
  const [msg, setMsg] = useState(null);
  const [pw, setPw] = useState({ current_password: '', new_password: '' });

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const profile = data || user;

  async function saveProfile(e) {
    e.preventDefault();
    try {
      await api('/auth/me/profile', { method: 'PUT', body: form });
      setMsg({ tone: 'success', text: 'Profile updated' });
    } catch (err) {
      setMsg({ tone: 'error', text: err.message });
    }
  }

  async function changePw(e) {
    e.preventDefault();
    setMsg(null);
    try {
      await api('/auth/change-password', { method: 'POST', body: pw });
      setPw({ current_password: '', new_password: '' });
      setMsg({ tone: 'success', text: 'Password changed' });
    } catch (err) {
      setMsg({ tone: 'error', text: err.message });
    }
  }

  return (
    <div>
      <h1>My Profile</h1>
      {msg && <div className={`alert ${msg.tone}`}>{msg.text}</div>}
      <div className="grid cols-2">
        <div className="card">
          <div className="mb">
            <div className="flex"><h3 style={{ margin: 0 }}>{profile.full_name}</h3> <Badge tone="blue">{profile.role_code}</Badge></div>
            <div className="muted mt">@{profile.username} · joined {fmtDate(profile.created_at)}</div>
          </div>
          <form onSubmit={saveProfile}>
            <div className="field mb"><label>Full name</label><input value={form.full_name || profile.full_name || ''} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
            <div className="form-row">
              <div className="field"><label>Email</label><input value={form.email || profile.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div className="field"><label>Phone</label><input value={form.phone || profile.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            </div>
            <button className="btn primary" type="submit">Save profile</button>
          </form>
        </div>

        <div className="card">
          <h3 className="mb" style={{ margin: 0 }}>Change password</h3>
          <form onSubmit={changePw} className="mt">
            <div className="field mb"><label>Current password</label><input type="password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} required /></div>
            <div className="field mb"><label>New password</label><input type="password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} required /></div>
            <button className="btn primary" type="submit">Change password</button>
          </form>
        </div>
      </div>
    </div>
  );
}
