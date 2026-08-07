import { useState } from 'react';
import { api } from '../api/client';
import { useAsync, Loading, ErrorBox, Empty, Badge, fmtDate } from '../components/ui';

export default function AuditLogs() {
  const { data, loading, error, reload } = useAsync(async () => {
    const [logs, users] = await Promise.all([api('/audit?limit=300'), api('/users')]);
    return { logs, users };
  }, []);
  const [entity, setEntity] = useState('');

  if (loading) return <Loading />;
  if (error) return (
    <div>
      <h1>Audit Logs</h1>
      <ErrorBox error={error} />
      <button className="btn" onClick={reload}>Retry</button>
    </div>
  );

  const filtered = entity ? data.logs.filter((l) => l.entity === entity) : data.logs;

  return (
    <div>
      <h1>Audit Logs</h1>
      <div className="mb flex">
        <label className="muted">Filter entity:</label>
        <select value={entity} onChange={(e) => setEntity(e.target.value)}>
          <option value="">All</option>
          {[...new Set(data.logs.map((l) => l.entity))].filter(Boolean).map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      </div>
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>Entity ID</th><th>IP</th></tr></thead>
          <tbody>
            {filtered.map((l) => (
              <tr key={l.id}>
                <td>{fmtDate(l.created_at)}</td>
                <td>{l.user_name || `#${l.user_id || '-'}`}</td>
                <td><Badge tone="blue">{l.action}</Badge></td>
                <td>{l.entity || '-'}</td>
                <td>{l.entity_id ?? '-'}</td>
                <td className="muted">{l.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <Empty text="No audit entries." />}
      </div>
    </div>
  );
}
