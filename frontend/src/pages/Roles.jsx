import { useState } from 'react';
import { api } from '../api/client';
import { useAsync, Loading, ErrorBox, Empty, Badge, Modal } from '../components/ui';

export default function Roles() {
  const { data, loading, error, reload } = useAsync(async () => {
    const [roles, perms] = await Promise.all([api('/roles'), api('/roles/permissions')]);
    return { roles, perms };
  }, []);
  const [detail, setDetail] = useState(null);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  async function open(r) {
    setDetail(await api(`/roles/${r.id}`));
  }

  async function togglePermission(roleId, code) {
    const current = detail.permissions.some((p) => p.code === code);
    const perms = detail.permissions.map((p) => p.code);
    if (current) {
      await api(`/roles/${roleId}`, { method: 'PUT', body: { permissions: perms.filter((c) => c !== code) } });
    } else {
      await api(`/roles/${roleId}`, { method: 'PUT', body: { permissions: [...perms, code] } });
    }
    open({ id: roleId });
  }

  return (
    <div>
      <h1>Roles & Permissions</h1>
      <p className="muted">RBAC hierarchy: Admin [0] → Homeroom Teacher [1a]/Parent [1b] → Subject Teacher [2] → Student [3] → Guest [4]</p>
      <div className="grid cols-2">
        <div className="card">
          <table className="tbl">
            <thead><tr><th>Role</th><th>Level</th><th>Description</th><th></th></tr></thead>
            <tbody>
              {data.roles.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.name}</strong></td>
                  <td><Badge tone={r.level === 0 ? 'red' : 'blue'}>[{r.level}]</Badge></td>
                  <td>{r.description}</td>
                  <td><button className="btn small" onClick={() => open(r)}>Permissions</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {detail && (
          <div className="card">
            <div className="spread mb">
              <h3 style={{ margin: 0 }}>{detail.name} — permissions ({detail.permissions.length})</h3>
              <button className="btn small" onClick={() => setDetail(null)}>Close</button>
            </div>
            <div className="pill-row">
              {data.perms.map((p) => {
                const on = detail.permissions.some((x) => x.code === p.code);
                return (
                  <button key={p.code} className={`btn small ${on ? 'success' : ''}`} onClick={() => togglePermission(detail.id, p.code)}>
                    {on ? '✓ ' : ''}{p.code}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
