import { useState } from 'react';
import { api } from '../api/client';
import { useAsync, Loading, ErrorBox, Empty, Badge, Modal, fmtDate } from '../components/ui';

const TONE = { pending: 'amber', approved: 'green', rejected: 'red' };

export default function Appeals() {
  const { data, loading, error, reload } = useAsync(async () => {
    const [appeals, reports, students] = await Promise.all([api('/appeals'), api('/reports'), api('/students')]);
    return { appeals, reports, students };
  }, []);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ report_id: '', student_id: '', reason: '' });

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  async function submit(e) {
    e.preventDefault();
    try {
      await api('/appeals', {
        method: 'POST',
        body: { report_id: form.report_id ? Number(form.report_id) : null, student_id: form.student_id ? Number(form.student_id) : null, reason: form.reason }
      });
      setShow(false);
      setForm({ report_id: '', student_id: '', reason: '' });
      reload();
    } catch (err) {
      alert(err.message);
    }
  }

  async function resolve(a, status) {
    const resolution = window.prompt(`Resolution for appeal #${a.id} (${status}):`, 'Reviewed');
    if (resolution == null) return;
    try {
      await api(`/appeals/${a.id}`, { method: 'PUT', body: { status, resolution } });
      reload();
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div>
      <h1>Appeals</h1>
      <div className="spread mb">
        <span className="muted">{data.appeals.length} appeals</span>
        <button className="btn primary" onClick={() => setShow(true)}>+ Submit appeal</button>
      </div>
      <div className="card">
        <table className="tbl">
          <thead><tr><th>#</th><th>Report</th><th>Student</th><th>Reason</th><th>Status</th><th>Submitted</th><th>Actions</th></tr></thead>
          <tbody>
            {data.appeals.map((a) => (
              <tr key={a.id}>
                <td>{a.id}</td>
                <td>{a.report_title || `#${a.report_id || '-'}`}</td>
                <td>{a.student_name || `#${a.student_id || '-'}`}</td>
                <td>{a.reason}</td>
                <td><Badge tone={TONE[a.status]}>{a.status}</Badge></td>
                <td>{fmtDate(a.created_at)}</td>
                <td className="flex">
                  {a.status === 'pending' && <>
                    <button className="btn small success" onClick={() => resolve(a, 'approved')}>Approve</button>
                    <button className="btn small danger" onClick={() => resolve(a, 'rejected')}>Reject</button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.appeals.length === 0 && <Empty text="No appeals." />}
      </div>

      {show && (
        <Modal title="Submit appeal" onClose={() => setShow(false)}>
          <form onSubmit={submit}>
            <div className="form-row">
              <div className="field"><label>Report</label>
                <select value={form.report_id} onChange={(e) => setForm({ ...form, report_id: e.target.value })}>
                  <option value="">-</option>
                  {data.reports.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
                </select>
              </div>
              <div className="field"><label>Student</label>
                <select value={form.student_id} onChange={(e) => setForm({ ...form, student_id: e.target.value })}>
                  <option value="">-</option>
                  {data.students.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </div>
            </div>
            <div className="field mb"><label>Reason</label><textarea rows="3" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required /></div>
            <button className="btn primary" type="submit">Submit</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
