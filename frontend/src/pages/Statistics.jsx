import { useState } from 'react';
import { api } from '../api/client';
import { useAsync, Loading, ErrorBox, Empty, Badge } from '../components/ui';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export default function Statistics() {
  const [classId, setClassId] = useState('');
  const { data, loading, error, reload } = useAsync(async () => {
    const classes = await api('/classes');
    let indicators = null;
    let trend = [];
    let detect = null;
    let students = [];
    if (classId) {
      [indicators, trend, detect, students] = await Promise.all([
        api(`/statistics/indicators?class_id=${classId}`),
        api(`/statistics/trend?class_id=${classId}&unit=session`),
        api(`/statistics/detect?class_id=${classId}`),
        api(`/students?class_id=${classId}`)
      ]);
    } else {
      indicators = await api('/statistics/indicators');
      detect = await api('/statistics/detect');
    }
    return { classes, indicators, trend, detect, students };
  }, [classId]);

  const [studentId, setStudentId] = useState('');
  const { data: sdata, reload: sreload } = useAsync(async () => {
    if (!studentId) return null;
    return api(`/statistics/student/${studentId}`);
  }, [studentId]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const ind = data.indicators || {};
  const det = data.detect || {};

  return (
    <div>
      <h1>Statistics & Analytics</h1>
      <div className="mb flex">
        <label className="muted">Class scope:</label>
        <select value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">Global</option>
          {data.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="grid cols-4 mb">
        <div className="card stat-card"><div className="label">Participation rate</div><div className="value">{ind.participation_rate}%</div></div>
        <div className="card stat-card"><div className="label">Correct answer rate</div><div className="value">{ind.correct_answer_rate}%</div></div>
        <div className="card stat-card"><div className="label">Response time</div><div className="value">{ind.response_time_ms} ms</div></div>
        <div className="card stat-card"><div className="label">Stability index</div><div className="value">{ind.stability_index}</div></div>
      </div>
      <div className="grid cols-4 mb">
        <div className="card stat-card"><div className="label">Activeness</div><div className="value">{ind.activeness}</div></div>
        <div className="card stat-card"><div className="label">Interaction level</div><div className="value">{ind.interaction_level}%</div></div>
        <div className="card stat-card"><div className="label">Speaking frequency</div><div className="value">{ind.speech_frequency}</div></div>
        <div className="card stat-card"><div className="label">Total interactions</div><div className="value">{ind.total_interactions}</div></div>
      </div>

      <div className="grid cols-2 mb">
        <div className="card">
          <h3 className="mb" style={{ margin: 0 }}>Trend (correct answer rate per session)</h3>
          {data.trend.length === 0 ? <Empty text="Run a live session to see a trend." /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="bucket" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="correct_rate" fill="#3b5bdb" name="Correct %" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <h3 className="mb" style={{ margin: 0 }}>Automatic student detection</h3>
          {['low_interaction', 'consistently_incorrect', 'decreasing', 'outstanding'].map((k) => (
            <div key={k} className="mb">
              <Badge tone={k === 'outstanding' ? 'green' : k === 'decreasing' ? 'amber' : k === 'consistently_incorrect' ? 'red' : 'gray'}>
                {k.replace(/_/g, ' ')} ({det[k] ? det[k].length : 0})
              </Badge>
              <div className="mt" style={{ fontSize: 12.5 }}>
                {det[k] && det[k].map((x) => `#${x.student_id}${x.accuracy != null ? ` (${x.accuracy}%)` : ''}`).join(', ') || 'none'}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3 className="mb" style={{ margin: 0 }}>Per-student detail</h3>
        <div className="mb flex">
          <label className="muted">Student:</label>
          <select value={studentId} onChange={(e) => { setStudentId(e.target.value); sreload(); }}>
            <option value="">Select...</option>
            {data.students.map((s) => <option key={s.id} value={s.id}>{s.full_name} ({s.student_code})</option>)}
          </select>
        </div>
        {sdata && (
          <div className="grid cols-2">
            <div>
              {Object.entries(sdata.indicators).filter(([, v]) => typeof v === 'number').map(([k, v]) => (
                <div key={k} className="flex" style={{ justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dashed #eee' }}>
                  <span className="muted">{k.replace(/_/g, ' ')}</span><strong>{v}</strong>
                </div>
              ))}
            </div>
            <table className="tbl">
              <thead><tr><th>Answer</th><th>Correct</th><th>Score</th><th>Reaction</th></tr></thead>
              <tbody>
                {sdata.recent_answers.map((a) => (
                  <tr key={a.id || a.created_at}>
                    <td>{a.answer_value || '-'}</td>
                    <td>{a.is_correct ? <Badge tone="green">Y</Badge> : <Badge tone="red">N</Badge>}</td>
                    <td>{a.score}</td>
                    <td>{a.reaction_ms ? `${a.reaction_ms} ms` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
