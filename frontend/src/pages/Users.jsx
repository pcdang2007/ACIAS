import { useState } from 'react';
import { api } from '../api/client';
import { useAsync, Loading, ErrorBox, Empty, Badge, Modal, fmtDate } from '../components/ui';

const ROLE_COLORS = { ADMIN: 'red', HOMEROOM_TEACHER: 'blue', SUBJECT_TEACHER: 'blue', PARENT: 'amber', STUDENT: 'green', GUEST: 'gray' };

export default function Users() {
  const { data, loading, error, reload } = useAsync(async () => {
    const [users, roles] = await Promise.all([api('/users'), api('/roles')]);
    return { users, roles };
  }, []);
  const [form, setForm] = useState({ username: '', password: '', full_name: '', email: '', phone: '', role_id: '' });
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState(null);
  const [currentUserId, setCurrentUserId] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('acias_user') || '{}').id;
    } catch {
      return null;
    }
  });

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  function openNew() { setForm({ username: '', password: '', full_name: '', email: '', phone: '', role_id: '' }); setEditing(null); setShow(true); }
  function openEdit(u) {
    setForm({ username: u.username, password: '', full_name: u.full_name, email: u.email || '', phone: u.phone || '', role_id: String(u.role_id) });
    setEditing(u.id);
    setShow(true);
  }

  async function save(e) {
    e.preventDefault();
    try {
      if (editing) {
        const body = { full_name: form.full_name, email: form.email, phone: form.phone, role_id: Number(form.role_id) };
        await api(`/users/${editing}`, { method: 'PUT', body });
      } else {
        await api('/users', { method: 'POST', body: { ...form, role_id: Number(form.role_id) } });
      }
      setShow(false);
      setForm({ username: '', password: '', full_name: '', email: '', phone: '', role_id: '' });
      setEditing(null);
      reload();
    } catch (err) {
      alert(err.message);
    }
  }

  async function resetPw(u) {
    const pw = window.prompt(`New password for ${u.username}:`, 'password123');
    if (!pw) return;
    try {
      await api(`/users/${u.id}/reset-password`, { method: 'POST', body: { password: pw } });
      alert('Password reset');
    } catch (err) {
      alert(err.message);
    }
  }

  async function remove(u) {
    if (u.id === currentUserId) { alert('You cannot delete your own account.'); return; }
    if (!window.confirm(`Delete user "${u.username}"?`)) return;
    try {
      await api(`/users/${u.id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div>
      <h1>Users</h1>
      <div className="spread mb">
        <span className="muted">{data.users.length} users</span>
        <button className="btn primary" onClick={openNew}>+ New user</button>
      </div>
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Username</th><th>Full name</th><th>Role</th><th>Email</th><th>Status</th><th>Created</th><th></th></tr></thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.full_name}</td>
                <td><Badge tone={ROLE_COLORS[u.role_code] || 'gray'}>{u.role_name}</Badge></td>
                <td>{u.email || '-'}</td>
                <td><Badge tone={u.status === 'active' ? 'green' : 'red'}>{u.status}</Badge></td>
                <td>{fmtDate(u.created_at)}</td>
                <td className="flex">
                  <button className="btn small" onClick={() => resetPw(u)}>Reset password</button>
                  <button className="btn small" onClick={() => openEdit(u)}>Edit</button>
                  <button className="btn small danger" onClick={() => remove(u)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {show && (
        <Modal title={editing ? 'Edit user' : 'New user'} onClose={() => setShow(false)}>
          <form onSubmit={save}>
            <div className="form-row">
              <div className="field"><label>Username</label><input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required disabled={!!editing} /></div>
              {!editing && (
                <div className="field"><label>Password</label><input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></div>
              )}
            </div>
            <div className="field mb"><label>Full name</label><input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></div>
            <div className="form-row">
              <div className="field"><label>Role</label>
                <select value={form.role_id} onChange={(e) => setForm({ ...form, role_id: e.target.value })} required>
                  <option value="">Select</option>
                  {data.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Email</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            </div>
            <button className="btn primary" type="submit">{editing ? 'Save' : 'Create'}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
