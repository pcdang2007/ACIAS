import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, openRealtime } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useAsync, Loading, ErrorBox, StatCard, Badge, fmtDate } from '../components/ui';

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const role = user.role_code;
  const isAdmin = role === 'ADMIN';
  const canTeacher = ['ADMIN', 'HOMEROOM_TEACHER', 'SUBJECT_TEACHER'].includes(role);

  const { data, loading, error } = useAsync(async () => {
    const [classes, sessions, students, reports, indicators, ai] = await Promise.all([
      api('/classes'),
      api('/sessions'),
      api('/students'),
      api('/reports'),
      api('/statistics/indicators'),
      api('/ai/status')
    ]);
    const liveCount = sessions.filter((s) => s.status === 'live').length;
    return { classes, sessions, students, reports, indicators, ai, liveCount };
  }, []);

  const [events, setEvents] = useState([]);

  useEffect(() => {
    const ws = openRealtime((msg) => {
      if (['interaction', 'answer', 'audio', 'question_closed'].includes(msg.event)) {
        setEvents((prev) => [{ event: msg.event, payload: msg.payload, ts: new Date() }, ...prev].slice(0, 40));
      }
    });
    return () => ws.close();
  }, []);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const liveSessions = data.sessions.filter((s) => s.status === 'live');

  return (
    <div>
      <h1>Welcome back, {user.full_name}</h1>
      <div className="grid cols-4 mb">
        <StatCard label="Classes" value={data.classes.length} />
        <StatCard label="Students" value={data.students.length} />
        <StatCard label="Sessions" value={data.sessions.length} />
        <StatCard label="Live now" value={data.liveCount} color={data.liveCount ? '#12b886' : undefined} />
      </div>
      <div className="grid cols-4 mb">
        <StatCard label="Participation" value={`${data.indicators.participation_rate}%`} />
        <StatCard label="Correct answers" value={`${data.indicators.correct_answer_rate}%`} />
        <StatCard label="Avg response" value={`${data.indicators.response_time_ms} ms`} />
        <StatCard label="Reports" value={data.reports.length} />
      </div>

      <div className="grid cols-2">
        <div className="card">
          <div className="spread mb">
            <h3 style={{ margin: 0 }}>Live Sessions</h3>
            {canTeacher && <button className="btn small primary" onClick={() => navigate('/sessions')}>Manage sessions</button>}
          </div>
          {liveSessions.length === 0 ? (
            <div className="empty">No session is running. Start one from the Sessions page.</div>
          ) : (
            <table className="tbl">
              <thead><tr><th>Class</th><th>Lesson</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {liveSessions.map((s) => (
                  <tr key={s.id}>
                    <td>{s.class_name}</td>
                    <td>{s.lesson_title || s.subject_name || '-'}</td>
                    <td><Badge tone="green">LIVE</Badge></td>
                    <td><button className="btn small" onClick={() => navigate(`/sessions/${s.id}/live`)}>Open live view</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h3 className="mb" style={{ margin: 0 }}>Realtime AI Events</h3>
          <div className="events">
            {events.length === 0 && <div className="empty">Events appear here when a live session runs.</div>}
            {events.map((e, i) => (
              <div className="ev" key={i}>
                <span className="ts">{e.ts.toLocaleTimeString()}</span>
                <Badge tone={e.event === 'answer' ? 'green' : e.event === 'audio' ? 'blue' : 'amber'}>{e.event}</Badge>
                <span className="muted">
                  {e.event === 'answer' ? `student #${e.payload.student_id} answered ${e.payload.answer_value || ''}` :
                   e.event === 'interaction' ? `${e.payload.type} · student #${e.payload.student_id}` :
                   e.event === 'audio' ? `${e.payload.command || 'utterance'}${e.payload.transcript ? ` · "${e.payload.transcript}"` : ''}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {canTeacher && (
        <div className="card mt">
          <h3>Quick actions</h3>
          <div className="pill-row mt">
            <button className="btn primary" onClick={() => navigate('/sessions')}>Start / resume a session</button>
            <button className="btn" onClick={() => navigate('/questions')}>Add a question</button>
            <button className="btn" onClick={() => navigate('/reports')}>Generate a report</button>
            <button className="btn" onClick={() => navigate('/seats')}>Edit seating chart</button>
          </div>
        </div>
      )}

      {!isAdmin && (
        <div className="card mt">
          <h3>Recent reports</h3>
          <table className="tbl">
            <thead><tr><th>Title</th><th>Period</th><th>Generated</th></tr></thead>
            <tbody>
              {data.reports.slice(0, 5).map((r) => (
                <tr key={r.id}>
                  <td>{r.title}</td>
                  <td>{r.period}</td>
                  <td>{fmtDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
