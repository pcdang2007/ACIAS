import { useState } from 'react';
import { api } from '../api/client';
import { useAsync, Loading, ErrorBox, Empty, Badge, fmtDate } from '../components/ui';

const PERIODS = [
  ['lesson', 'Lesson'], ['day', 'Day'], ['week', 'Week'], ['month', 'Month'],
  ['semester', 'Semester'], ['year', 'School year']
];

export default function Reports() {
  const { data, loading, error, reload } = useAsync(async () => {
    const [reports, classes, students] = await Promise.all([api('/reports'), api('/classes'), api('/students')]);
    return { reports, classes, students };
  }, []);

  const [form, setForm] = useState({ type: 'month', scope_type: 'class', scope_id: '', period: '2026-08' });
  const [detail, setDetail] = useState(null);
  const [msg, setMsg] = useState(null);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  function periodHint() {
    switch (form.type) {
      case 'day': return 'YYYY-MM-DD';
      case 'week': return 'YYYY-W##';
      case 'month': return 'YYYY-MM';
      case 'semester': return 'YYYY-S1 / YYYY-S2';
      case 'year': return 'YYYY';
      default: return 'date';
    }
  }

  async function generate(e) {
    e.preventDefault();
    setMsg(null);
    try {
      const res = await api('/reports/generate', {
        method: 'POST',
        body: { type: form.type, scope_type: form.scope_type, scope_id: form.scope_id ? Number(form.scope_id) : null, period: form.period }
      });
      setMsg({ tone: 'success', text: `Report #${res.id} generated` });
      reload();
    } catch (err) {
      setMsg({ tone: 'error', text: err.message });
    }
  }

  async function openDetail(r) {
    const full = await api(`/reports/${r.id}`);
    setDetail(full);
  }

  function download(r) {
    window.open(`/api/reports/${r.id}/export?token=${encodeURIComponent(localStorage.getItem('acias_token'))}`, '_blank');
  }

  return (
    <div>
      <h1>Reports</h1>
      {msg && <div className={`alert ${msg.tone}`}>{msg.text}</div>}
      <div className="grid cols-2 mb">
        <div className="card">
          <h3 className="mb" style={{ margin: 0 }}>Generate a report</h3>
          <form onSubmit={generate} className="mt">
            <div className="form-row">
              <div className="field"><label>Period type</label>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="field"><label>Scope</label>
                <select value={form.scope_type} onChange={(e) => setForm({ ...form, scope_type: e.target.value, scope_id: '' })}>
                  <option value="class">Class</option>
                  <option value="student">Student</option>
                  <option value="global">Global</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              {form.scope_type === 'class' && (
                <div className="field"><label>Class</label>
                  <select value={form.scope_id} onChange={(e) => setForm({ ...form, scope_id: e.target.value })}>
                    <option value="">All</option>
                    {data.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              {form.scope_type === 'student' && (
                <div className="field"><label>Student</label>
                  <select value={form.scope_id} onChange={(e) => setForm({ ...form, scope_id: e.target.value })}>
                    <option value="">-</option>
                    {data.students.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                  </select>
                </div>
              )}
              <div className="field"><label>Period <span className="muted">({periodHint()})</span></label>
                <input value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} required />
              </div>
            </div>
            <button className="btn primary" type="submit">Generate report</button>
          </form>
        </div>

        <div className="card">
          <h3 className="mb" style={{ margin: 0 }}>Saved reports</h3>
          <table className="tbl">
            <thead><tr><th>Title</th><th>Period</th><th>Generated</th><th></th></tr></thead>
            <tbody>
              {data.reports.map((r) => (
                <tr key={r.id}>
                  <td>{r.title}</td>
                  <td>{r.period}</td>
                  <td>{fmtDate(r.created_at)}</td>
                  <td className="flex">
                    <button className="btn small" onClick={() => openDetail(r)}>View</button>
                    <button className="btn small" onClick={() => download(r)}>CSV</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.reports.length === 0 && <Empty text="No reports yet." />}
        </div>
      </div>

      {detail && (
        <div className="card">
          <div className="spread mb">
            <h3 style={{ margin: 0 }}>{detail.title}</h3>
            <button className="btn small" onClick={() => setDetail(null)}>Close</button>
          </div>
          <div className="grid cols-4 mb">
            {Object.entries(detail.summary).filter(([k]) => typeof detail.summary[k] === 'number').map(([k, v]) => (
              <div className="card stat-card" key={k}><div className="label">{k.replace(/_/g, ' ')}</div><div className="value">{v}</div></div>
            ))}
          </div>
          {detail.content && detail.content.trend && detail.content.trend.length > 0 && (
            <table className="tbl">
              <thead><tr><th>Bucket</th><th>Correct rate</th><th>Response (ms)</th></tr></thead>
              <tbody>
                {detail.content.trend.map((t) => (
                  <tr key={t.bucket}><td>{t.bucket}</td><td>{t.correct_rate}%</td><td>{t.response_time_ms}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          {detail.content && detail.content.details && (
            <div className="mt">
              <h4>Detected students</h4>
              <pre className="muted" style={{ fontSize: 12, overflowX: 'auto' }}>{JSON.stringify(detail.content.details, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
