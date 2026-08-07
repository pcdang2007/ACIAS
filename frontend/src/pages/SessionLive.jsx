import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, openRealtime } from '../api/client';
import { useAsync, Loading, ErrorBox, Empty, Badge, Modal, fmtDate } from '../components/ui';

const MODE_LABEL = { '1': 'Fingers → A/B/C/D', '2': 'Fingers + left/right hand', '3': 'Hand raise + prioritization' };

function cameraUrlKind(url) {
  if (!url) return null;
  const u = String(url).toLowerCase();
  if (/^rtsp:\/\//.test(u)) return 'rtsp';
  if (/\.m3u8(\?|$)/.test(u)) return 'hls';
  if (/\.(jpg|jpeg|mjpg|mjpeg)(\?|$)/.test(u) || /(mjpg|mjpeg)/.test(u)) return 'mjpeg';
  if (/\.(mp4|webm|ogv|ogg|mov)(\?|$)/.test(u)) return 'video';
  if (/^https?:\/\//.test(u)) return 'video';
  return null;
}

export default function SessionLive() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, reload, setData } = useAsync(async () => {
    const [summary, questions, bankQuestions, students, feeds] = await Promise.all([
      api(`/sessions/${id}/live`),
      api(`/sessions/${id}/questions`),
      api('/questions'),
      api('/students'),
      api(`/camera?session_id=${id}`)
    ]);
    return { summary, questions, bankQuestions, students, feeds };
  }, [id]);

  const [showQ, setShowQ] = useState(false);
  const [qForm, setQForm] = useState({ source: 'bank', question_id: '', content: '', points: 10, recognition_mode: '1', duration: 15 });
  const [suggestions, setSuggestions] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [events, setEvents] = useState([]);
  const [msg, setMsg] = useState(null);
  const [liveFeed, setLiveFeed] = useState(null);
  const [feedResult, setFeedResult] = useState(null);
  const videoRef = useRef(null);
  const mediaRef = useRef(null);
  const pollRef = useRef(null);

  const isLive = data && data.summary && data.summary.session.status === 'live';

  useEffect(() => {
    const ws = openRealtime((m) => {
      if (m.event === 'answer' && String(m.payload.session_id) === id) {
        setEvents((p) => [{ ...m.payload, kind: 'answer' }, ...p].slice(0, 30));
        if (m.payload.session_question_id === (data && data.summary && data.summary.open_question && data.summary.open_question.id)) {
          loadAnswers(m.payload.session_question_id);
        }
      }
      if (m.event === 'interaction' && String(m.payload.session_id) === id) {
        setEvents((p) => [{ ...m.payload, kind: 'interaction' }, ...p].slice(0, 30));
      }
      if (m.event === 'question_closed') {
        reload();
      }
    });
    return () => ws.close();
  }, [id, data && data.summary && data.summary.open_question && data.summary.open_question.id]);

  useEffect(() => {
    const t = setInterval(() => { if (isLive) reload(); }, 5000);
    return () => clearInterval(t);
  }, [isLive]);

  useEffect(() => {
    if (data && data.feeds && data.feeds.length > 0 && !liveFeed) {
      const active = data.feeds.find((f) => f.status === 'active');
      if (active) setLiveFeed(active);
    }
  }, [data, liveFeed]);

  useEffect(() => {
    if (!liveFeed) return;
    pollRef.current = setInterval(async () => {
      try {
        const d = await api(`/camera/${liveFeed.id}`);
        if (d.last_result) setFeedResult(d.last_result);
      } catch { /* offline tolerance */ }
    }, 3000);
    return () => clearInterval(pollRef.current);
  }, [liveFeed && liveFeed.id]);

  useEffect(() => () => {
    clearInterval(pollRef.current);
    if (mediaRef.current) { mediaRef.current.getTracks().forEach((t) => t.stop()); mediaRef.current = null; }
  }, []);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const { summary, questions, bankQuestions } = data;
  const session = summary.session;
  const openQ = summary.open_question;

  async function loadAnswers(qid) {
    const list = await api(`/sessions/questions/${qid}/answers`);
    setAnswers(list);
  }

  async function loadSuggestions() {
    if (!openQ) return;
    const list = await api(`/sessions/questions/${openQ.id}/suggestions`);
    setSuggestions(list);
  }

  async function addQuestion(e) {
    e.preventDefault();
    setMsg(null);
    try {
      let body;
      if (qForm.source === 'bank') {
        const q = bankQuestions.find((x) => x.id === Number(qForm.question_id));
        body = { question_id: q.id, content: q.content, type: q.type, points: Number(qForm.points) || q.points, recognition_mode: qForm.recognition_mode, duration: Number(qForm.duration) || q.duration };
      } else {
        body = { content: qForm.content, type: 'multiple_choice', points: Number(qForm.points), recognition_mode: qForm.recognition_mode, duration: Number(qForm.duration) };
      }
      const res = await api(`/sessions/${id}/questions`, { method: 'POST', body: { ...body, class_id: session.class_id } });
      setShowQ(false);
      setSuggestions(res.suggestions || null);
      setMsg({ tone: 'success', text: 'Question started. AI is watching for answers...' });
      reload();
    } catch (err) {
      setMsg({ tone: 'error', text: err.message });
    }
  }

  async function closeQuestion() {
    if (!openQ) return;
    await api(`/sessions/questions/${openQ.id}/close`, { method: 'POST' });
    await loadAnswers(openQ.id);
    reload();
  }

  async function startMyWebcam() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMsg({ tone: 'error', text: 'Camera not supported (requires HTTPS or localhost).' });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      mediaRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
    } catch (err) {
      setMsg({ tone: 'error', text: 'Camera denied: ' + err.message });
    }
  }

  function stopMyWebcam() {
    if (mediaRef.current) { mediaRef.current.getTracks().forEach((t) => t.stop()); mediaRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function startSession() {
    await api(`/sessions/${id}/start`, { method: 'POST' });
    reload();
  }

  async function endSession() {
    if (!window.confirm('End this session?')) return;
    await api(`/sessions/${id}/end`, { method: 'POST' });
    reload();
  }

  async function autoAttendance() {
    try {
      await api('/attendance/auto', { method: 'POST', body: { session_id: id, class_id: session.class_id } });
      setMsg({ tone: 'success', text: 'Attendance marked via AI detection' });
    } catch (err) {
      setMsg({ tone: 'error', text: err.message });
    }
  }

  const live = summary.live_stats;

  return (
    <div>
      <h1>Live session <span className="muted">· {session.class_name} · {session.lesson_title || '-'}</span></h1>
      {msg && <div className={`alert ${msg.tone}`}>{msg.text}</div>}
      <div className="spread mb">
        <div className="flex">
          <Badge tone={isLive ? 'green' : session.status === 'ended' ? 'gray' : 'amber'}>{session.status.toUpperCase()}</Badge>
          <span className="muted">Started {fmtDate(session.start_time)}</span>
        </div>
        <div className="flex">
          {!isLive && session.status !== 'ended' && <button className="btn success" onClick={startSession}>Start session</button>}
          <button className="btn" onClick={() => navigate(`/camera?session_id=${id}`)}>Who records · camera monitor</button>
          {session.status !== 'ended' && <button className="btn" onClick={autoAttendance}>Auto attendance</button>}
          <button className="btn" onClick={closeQuestion} disabled={!openQ}>Close current question</button>
          {isLive && <button className="btn danger" onClick={endSession}>End session</button>}
        </div>
      </div>

      <div className="grid cols-4 mb">
        <div className="card stat-card"><div className="label">Answers</div><div className="value">{live.total_answers}</div></div>
        <div className="card stat-card"><div className="label">Correct rate</div><div className="value">{live.correct_rate}%</div></div>
        <div className="card stat-card"><div className="label">Avg response</div><div className="value">{live.avg_reaction_ms} ms</div></div>
        <div className="card stat-card"><div className="label">Hand raises / speech</div><div className="value">{live.hand_raises} / {live.speech_events}</div></div>
      </div>

      <div className="card mb">
        <div className="spread mb">
          <h3 style={{ margin: 0 }}>
            Live camera
            {session.lesson_title && <span className="muted"> · {session.lesson_title}</span>}
          </h3>
          <div className="flex">
            {liveFeed && <Badge tone="green">active feed #{liveFeed.id}</Badge>}
            <button className="btn small" onClick={() => navigate(`/camera?session_id=${id}`)}>Open camera monitor</button>
          </div>
        </div>
        <div className="grid cols-2">
          <div>
            {liveFeed ? (
              <div className="feed-frame">
                {liveFeed.source_type === 'photo' ? (
                  <img src={liveFeed.photo_path} alt="Camera feed" />
                ) : liveFeed.stream_url && cameraUrlKind(liveFeed.stream_url) === 'video' ? (
                  <video src={liveFeed.stream_url} autoPlay muted controls playsInline style={{ width: '100%' }} />
                ) : liveFeed.stream_url && cameraUrlKind(liveFeed.stream_url) === 'mjpeg' ? (
                  <img src={liveFeed.stream_url} alt="MJPEG stream" style={{ width: '100%' }} />
                ) : (
                  <div className="feed-camera">
                    <div className="muted">{liveFeed.device_name || 'Camera'} — {liveFeed.stream_url ? cameraUrlKind(liveFeed.stream_url) || 'unsupported stream' : 'no stream URL'}</div>
                  </div>
                )}
              </div>
            ) : (
              <div className="feed-frame feed-camera">
                <div className="muted">No active camera feed for this session</div>
                <div className="muted" style={{ fontSize: 12 }}>Start one from the camera monitor page</div>
              </div>
            )}
          </div>
          <div>
            {feedResult && feedResult.stages ? (
              <div className="stages">
                {feedResult.stages.map((st) => (
                  <div className="stage" key={st.name}>
                    <div className="spread">
                      <strong>{st.label}</strong>
                      <span className="muted" style={{ fontSize: 12 }}>{st.ms} ms</span>
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {st.name === 'person_detection' && `${(st.result || []).length || 0} persons`}
                      {st.name === 'hand_detection' && `${(st.result || {}).hands_detected || 0} hand(s)`}
                      {st.name === 'finger_counting' && st.result ? `${st.result.finger_count} finger(s) → ${st.result.letter || '?'}` : ''}
                      {st.name === 'answer_recognition' && `${(st.result || {}).method || '-'} ${(st.result || {}).letter ? `\u2192 ${st.result.letter}` : (st.result || {}).raised ? '(raised)' : ''}`}
                      {!['person_detection', 'hand_detection', 'finger_counting', 'answer_recognition'].includes(st.name) && `${JSON.stringify(st.result).slice(0, 60)}`}
                    </div>
                  </div>
                ))}
              </div>
            ) : liveFeed ? (
              <div className="muted" style={{ padding: 16 }}>Waiting for AI pipeline results…</div>
            ) : (
              <div className="muted" style={{ padding: 16 }}>Start a camera feed to see AI detection results here.</div>
            )}
          </div>
        </div>
      </div>

      <div className="grid cols-2 mb">
        <div className="card">
          <div className="spread mb">
            <h3 style={{ margin: 0 }}>Current question</h3>
            <button className="btn small primary" onClick={() => setShowQ(true)}>+ Ask a question</button>
          </div>
          {openQ ? (
            <>
              <p style={{ fontSize: 15 }}>{openQ.content}</p>
              <div className="flex mb">
                <Badge tone="blue">mode: {MODE_LABEL[openQ.recognition_mode] || openQ.recognition_mode}</Badge>
                <Badge tone="amber">{openQ.points} pts</Badge>
                <Badge tone="green">{openQ.status}</Badge>
              </div>
              <button className="btn" onClick={loadSuggestions}>Run prioritization (X′/Y′/Z′)</button>
            </>
          ) : (
            <Empty text="No open question. Ask one to start collecting responses." />
          )}

          {suggestions && (
            <div className="mt">
              <h4>Call-to-answer ranking <span className="muted">(spec §III.C)</span></h4>
              <table className="tbl">
                <thead><tr><th>#</th><th>Student</th><th>S</th><th>X′</th><th>Y′</th><th>Z′</th><th>Reaction</th></tr></thead>
                <tbody>
                  {suggestions.slice(0, 8).map((s) => {
                    const stu = data.students.find((x) => x.id === s.student_id);
                    return (
                      <tr key={s.student_id}>
                        <td>{s.rank}</td>
                        <td>{stu ? stu.full_name : `#${s.student_id}`}</td>
                        <td><strong>{s.score}</strong></td>
                        <td>{s.X_prime}</td>
                        <td>{s.Y_prime}</td>
                        <td>{s.Z_prime}</td>
                        <td>{s.avg_reaction_ms ? `${s.avg_reaction_ms} ms` : '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="mb" style={{ margin: 0 }}>Answers to current question</h3>
          {answers.length === 0 && <Empty text="No answers recorded yet (AI vision pipeline listens for raised hands / fingers)." />}
          <table className="tbl">
            <thead><tr><th>Student</th><th>Answer</th><th>Correct</th><th>Score</th><th>Reaction</th><th>Method</th></tr></thead>
            <tbody>
              {answers.map((a) => (
                <tr key={a.id}>
                  <td>{a.full_name}</td>
                  <td>{a.answer_value || '-'}</td>
                  <td>{a.is_correct ? <Badge tone="green">Yes</Badge> : <Badge tone="red">No</Badge>}</td>
                  <td>{a.score}</td>
                  <td>{a.reaction_ms ? `${a.reaction_ms} ms` : '-'}</td>
                  <td><Badge tone="gray">{a.detection_method}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          {openQ && <button className="btn small mt" onClick={() => loadAnswers(openQ.id)}>Refresh answers</button>}
        </div>
      </div>

      <div className="card">
        <h3 className="mb" style={{ margin: 0 }}>Session questions</h3>
        <table className="tbl">
          <thead><tr><th>#</th><th>Content</th><th>Mode</th><th>Points</th><th>Status</th><th>Started</th></tr></thead>
          <tbody>
            {questions.map((q) => (
              <tr key={q.id}>
                <td>{q.id}</td>
                <td>{q.content}</td>
                <td>{MODE_LABEL[q.recognition_mode] || q.recognition_mode}</td>
                <td>{q.points}</td>
                <td><Badge tone={q.status === 'open' ? 'green' : 'gray'}>{q.status}</Badge></td>
                <td>{fmtDate(q.started_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card mt">
        <h3 className="mb" style={{ margin: 0 }}>Realtime event stream (WebSocket)</h3>
        <div className="events">
          {events.length === 0 && <Empty text="Waiting for AI events..." />}
          {events.map((e, i) => (
            <div className="ev" key={i}>
              <Badge tone={e.kind === 'answer' ? 'green' : 'blue'}>{e.kind === 'answer' ? 'answer' : e.type}</Badge>
              <span className="muted">student #{e.student_id}{e.answer_value ? ` → ${e.answer_value}` : ''} {e.reaction_ms ? `(${e.reaction_ms} ms)` : ''}</span>
            </div>
          ))}
        </div>
      </div>

      {showQ && (
        <Modal title="Ask a question" onClose={() => setShowQ(false)}>
          <form onSubmit={addQuestion}>
            <div className="form-row">
              <div className="field"><label>Source</label>
                <select value={qForm.source} onChange={(e) => setQForm({ ...qForm, source: e.target.value })}>
                  <option value="bank">From question bank</option>
                  <option value="custom">Custom question</option>
                </select>
              </div>
            </div>
            {qForm.source === 'bank' ? (
              <div className="field mb"><label>Question</label>
                <select value={qForm.question_id} onChange={(e) => setQForm({ ...qForm, question_id: e.target.value })} required>
                  <option value="">Select...</option>
                  {bankQuestions.map((q) => <option key={q.id} value={q.id}>{q.content}</option>)}
                </select>
              </div>
            ) : (
              <div className="field mb"><label>Content</label><textarea rows="2" value={qForm.content} onChange={(e) => setQForm({ ...qForm, content: e.target.value })} required /></div>
            )}
            <div className="form-row">
              <div className="field"><label>Recognition mode</label>
                <select value={qForm.recognition_mode} onChange={(e) => setQForm({ ...qForm, recognition_mode: e.target.value })}>
                  <option value="1">1 - fingers → A/B/C/D</option>
                  <option value="2">2 - fingers + left/right hand</option>
                  <option value="3">3 - hand raise + prioritization</option>
                </select>
              </div>
              <div className="field"><label>Points (A)</label><input type="number" value={qForm.points} onChange={(e) => setQForm({ ...qForm, points: e.target.value })} /></div>
              <div className="field"><label>Duration (s)</label><input type="number" value={qForm.duration} onChange={(e) => setQForm({ ...qForm, duration: e.target.value })} /></div>
            </div>
            <button className="btn primary" type="submit">Start question</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
