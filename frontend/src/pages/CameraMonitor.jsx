import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, uploadFile, openRealtime } from '../api/client';
import { useAsync, Loading, ErrorBox, Empty, Badge, fmtDate } from '../components/ui';
import { initDetector, isReady, detectFrame, drawOverlays, getBackend } from '../ai/detector';

function stageSummary(st) {
  const r = st.result || {};
  switch (st.name) {
    case 'person_detection':
      return `${r.length || 0} persons detected`;
    case 'seat_tracking':
      return `${(r.tracked_seats || []).length} seats tracked · ${r.persons_detected || 0} persons in frame`;
    case 'pose_estimation':
      return Array.isArray(r) ? r.map((p) => `${p.id}: ${p.pose}`).join(', ') : `${r.pose || '-'} · ${r.keypoints_visible || 0} keypoints visible`;
    case 'raised_hand':
      return `${r.raised_count || 0} raised hand(s)${r.persons?.length ? `: ${r.persons.join(', ')}` : ''}`;
    case 'answer_recognition':
      return `${r.method || '-'}${r.raised ? ` · ${r.raised} raised` : ''} · ${Math.round((r.confidence || 0) * 100)}%`;
    default:
      return '';
  }
}

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

function renderBox(p) {
  const b = p.bbox || {};
  return (
    <div key={p.id} className="det-box" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }} title={`${p.id} · ${Math.round(p.confidence * 100)}%`} />
  );
}

function feedLabel(f) {
  return f.source_type === 'photo' ? 'photo' : f.device_name || `device #${f.device_id}`;
}

export default function CameraMonitor() {
  const [params] = useSearchParams();
  const [selected, setSelected] = useState(params.get('session_id') || '');
  const [deviceId, setDeviceId] = useState('');
  const [photo, setPhoto] = useState(null);
  const [feed, setFeed] = useState(null);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [myCam, setMyCam] = useState(false);
  const [msg, setMsg] = useState(null);
  const [mlReady, setMlReady] = useState(false);
  const [mlLoading, setMlLoading] = useState(false);
  const [mlDetection, setMlDetection] = useState(null);
  const [facingMode, setFacingMode] = useState('environment');
  const [mirror, setMirror] = useState(false);
  const fileRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const frameTimerRef = useRef(null);
  const mediaRef = useRef(null);
  const sendFrameRef = useRef(null);
  const busyRef = useRef(false);
  sendFrameRef.current = sendFrame;

  const { data, loading, error, reload } = useAsync(async () => {
    const [sessions, devices, feeds] = await Promise.all([
      api('/sessions'),
      api('/devices'),
      api(`/camera${selected ? `?session_id=${selected}` : ''}`)
    ]);
    return { sessions, devices, feeds };
  }, [selected]);

  const session = useMemo(
    () => (data ? data.sessions.find((s) => String(s.id) === String(selected)) : null),
    [data, selected]
  );
  const defaultCameraId = session ? session.device_id : null;
  const isDefaultCamera = feed && feed.device_id && defaultCameraId && feed.device_id === defaultCameraId;
  const cameraKind = feed && feed.source_type === 'camera' ? cameraUrlKind(feed.stream_url) : null;

  useEffect(() => {
    const ws = openRealtime((m) => {
      if (m.event === 'pipeline' && feed && m.payload.feed_id === feed.id) {
        setResult(m.payload);
      }
    });
    return () => ws.close();
  }, [feed && feed.id]);

  useEffect(() => {
    if (!feed) return;
    const t = setInterval(async () => {
      try {
        const d = await api(`/camera/${feed.id}`);
        if (d.last_result) setResult(d.last_result);
        if (d.status === 'ended') setRunning(false);
      } catch { /* offline tolerance */ }
    }, 4000);
    return () => clearInterval(t);
  }, [feed && feed.id]);

  useEffect(() => {
    if (myCam && mediaRef.current && videoRef.current) {
      videoRef.current.srcObject = mediaRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [myCam]);

  useEffect(() => {
    if (!selected && data && data.sessions && data.sessions.length > 0) {
      setSelected(String(data.sessions[0].id));
    }
  }, [data, selected]);

  useEffect(() => {
    clearInterval(frameTimerRef.current);
    frameTimerRef.current = null;
    if (mediaRef.current) {
      mediaRef.current.getTracks().forEach((t) => t.stop());
      mediaRef.current = null;
    }
    setMyCam(false);
  }, [feed && feed.id]);

  useEffect(() => () => {
    clearInterval(frameTimerRef.current);
    if (mediaRef.current) mediaRef.current.getTracks().forEach((t) => t.stop());
  }, []);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  async function createPhotoFeed(e) {
    e.preventDefault();
    if (!photo || !selected) return;
    try {
      const f = await uploadFile('/camera/photos', photo, 'photo', { session_id: selected });
      setFeed(f);
      setMsg({ tone: 'success', text: 'Photo uploaded — AI monitor ready.' });
      setPhoto(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setMsg({ tone: 'error', text: err.message });
    }
  }

  async function createDeviceFeed() {
    if (!deviceId || !selected) return;
    try {
      const f = await api('/camera', { method: 'POST', body: { session_id: Number(selected), device_id: Number(deviceId) } });
      setFeed(f);
      setMsg({ tone: 'success', text: f.reused ? 'Feed already exists for this camera — opened it.' : 'Camera feed created — AI monitor ready.' });
      reload();
    } catch (err) {
      setMsg({ tone: 'error', text: err.message });
    }
  }

  async function startProc() {
    if (!feed) return;
    try {
      await api(`/camera/${feed.id}/start`, { method: 'POST' });
      setRunning(true);
      setMsg({ tone: 'success', text: 'Streaming AI pipeline… watch the stages below.' });
    } catch (err) {
      setMsg({ tone: 'error', text: err.message });
    }
  }

  async function stopProc() {
    if (!feed) return;
    await api(`/camera/${feed.id}/stop`, { method: 'POST' });
    setRunning(false);
  }

  async function runNow() {
    if (!feed) return;
    try {
      const r = await api(`/camera/${feed.id}/process`, { method: 'POST' });
      setResult(r);
      setMsg({ tone: 'success', text: 'Pipeline run complete.' });
    } catch (err) {
      setMsg({ tone: 'error', text: err.message });
    }
  }

  async function acquireCamera(mode) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMsg({ tone: 'error', text: 'Camera capture is not supported here (requires HTTPS or localhost).' });
      return false;
    }
    try {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: mode,
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 }
          }
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode } });
      }
      const prev = mediaRef.current;
      if (prev && prev !== stream) prev.getTracks().forEach((t) => t.stop());
      mediaRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      setFacingMode(mode);
      setMirror(mode === 'user');
      return true;
    } catch (err) {
      setMsg({ tone: 'error', text: 'Camera access failed: ' + err.message });
      return false;
    }
  }

  function flipCamera() {
    if (!mediaRef.current) return;
    const next = facingMode === 'environment' ? 'user' : 'environment';
    setMsg({ tone: 'info', text: `Switching to the ${next === 'user' ? 'front' : 'rear'} camera…` });
    acquireCamera(next);
  }

  async function startMyCamera() {
    if (!feed) return;
    const started = await acquireCamera('environment');
    if (!started) return;
    setMyCam(true);
    frameTimerRef.current = setInterval(() => sendFrameRef.current && sendFrameRef.current(), 2000);
    if (!isReady()) {
      setMlLoading(true);
      setMsg({ tone: 'info', text: 'Loading YOLOv8-pose model (~13 MB, first time only)…' });
      try {
        await initDetector();
        setMlReady(true);
        setMlLoading(false);
        setMsg({ tone: 'success', text: 'Camera active + YOLOv8-pose detection — accurate multi-person + skeleton + raised hand.' });
      } catch (mlErr) {
        setMlLoading(false);
        setMsg({ tone: 'warn', text: 'Camera active but ML failed to load (' + mlErr.message + '). Using server-side mock pipeline instead.' });
      }
    } else {
      setMsg({ tone: 'success', text: 'Camera active — ML detection running.' });
    }
  }

  function stopMyCamera() {
    clearInterval(frameTimerRef.current);
    frameTimerRef.current = null;
    if (mediaRef.current) {
      mediaRef.current.getTracks().forEach((t) => t.stop());
      mediaRef.current = null;
    }
    setMyCam(false);
    setMlDetection(null);
    const o = overlayRef.current;
    if (o) { const ctx = o.getContext('2d'); ctx.clearRect(0, 0, o.width, o.height); }
  }

  async function sendFrame() {
    if (busyRef.current) return;
    const v = videoRef.current;
    const c = canvasRef.current;
    const o = overlayRef.current;
    if (!v || !c || !v.videoWidth || v.readyState < 2) return;
    busyRef.current = true;
    try {
      if (c.width !== v.videoWidth) c.width = v.videoWidth;
      if (c.height !== v.videoHeight) c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      const frameData = c.toDataURL('image/jpeg', 0.85);

      if (isReady() && o) {
        try {
          const det = await detectFrame(v, performance.now());
          setMlDetection(det);
          const octx = o.getContext('2d');
          if (o.width !== v.videoWidth) o.width = v.videoWidth;
          if (o.height !== v.videoHeight) o.height = v.videoHeight;
          drawOverlays(octx, o.width, o.height, det);
          await api(`/camera/${feed.id}/detections`, { method: 'POST', body: { persons: det.persons, frame: det.frame } });
        } catch { /* ML frame drop is fine */ }
      } else {
        try {
          const r = await api(`/camera/${feed.id}/frames`, { method: 'POST', body: { frame: frameData } });
          setResult(r);
        } catch { /* a dropped frame is fine */ }
      }
    } finally {
      busyRef.current = false;
    }
  }

  async function endFeed() {
    if (!feed) return;
    if (!window.confirm('End this feed? Processing will stop.')) return;
    await api(`/camera/${feed.id}/end`, { method: 'POST' });
    setRunning(false);
    setFeed(null);
    setResult(null);
    reload();
  }

  async function deleteFeed(f) {
    const idx = data.feeds.findIndex((x) => x.id === f.id);
    if (!window.confirm(`Delete Feed ${idx + 1} (${feedLabel(f)})? This cannot be undone.`)) return;
    try {
      await api(`/camera/${f.id}`, { method: 'DELETE' });
      if (feed && feed.id === f.id) { setFeed(null); setResult(null); setRunning(false); }
      setMsg({ tone: 'success', text: `Feed ${idx + 1} deleted.` });
      reload();
    } catch (err) {
      setMsg({ tone: 'error', text: err.message });
    }
  }

  function openFeed(f) {
    setFeed(f);
    setResult(f.last_result || null);
    setRunning(false);
  }

  const devices = data.devices;
  const activeIdx = feed ? data.feeds.findIndex((f) => f.id === feed.id) : -1;
  const activeFeedName = activeIdx >= 0 ? `Feed ${activeIdx + 1}` : (feed ? `#${feed.id}` : '');

  return (
    <div>
      <h1>Who records <span className="muted">· camera &amp; AI monitor</span></h1>
      {msg && <div className={`alert ${msg.tone}`}>{msg.text}</div>}

      <div className="grid cols-2 mb">
        <div className="card">
          <h3 style={{ margin: 0 }} className="mb">Source</h3>
          <div className="field mb">
            <label>Session</label>
            <select value={selected} onChange={(e) => { setSelected(e.target.value); setFeed(null); setResult(null); }}>
              <option value="">Select a session</option>
              {data.sessions.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.class_name || '-'} {s.lesson_title ? `· ${s.lesson_title}` : ''}</option>)}
            </select>
          </div>
          {session && (
            <div className="muted mb" style={{ fontSize: 12 }}>
              Default camera: <Badge tone="gray">{session.device_name || 'none'}</Badge>
            </div>
          )}
          <div className="spread mb">
            <h4 style={{ margin: 0 }}>Upload a photo</h4>
            <span className="muted" style={{ fontSize: 12 }}>JPEG / PNG / WebP, ≤ 10MB</span>
          </div>
          <form onSubmit={createPhotoFeed}>
            <div className="flex">
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhoto(e.target.files[0] || null)} />
              <button className="btn primary" type="submit" disabled={!selected || !photo}>Upload &amp; monitor</button>
            </div>
          </form>

          <div className="spread mt mb">
            <h4 style={{ margin: 0 }}>Stream from a camera</h4>
            <span className="muted" style={{ fontSize: 12 }}>{devices.length} registered</span>
          </div>
          <div className="flex">
            <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              <option value="">Select device…</option>
              {devices.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.type})</option>)}
            </select>
            <button className="btn primary" onClick={createDeviceFeed} disabled={!selected || !deviceId}>Use this camera</button>
          </div>
        </div>

        <div className="card">
          <div className="spread mb">
            <h3 style={{ margin: 0 }}>Feeds for this session</h3>
            {feed && (
              <div className="flex">
                <button className="btn small" onClick={runNow}>Run now</button>
                {running
                  ? <button className="btn small" onClick={stopProc}>Stop stream</button>
                  : <button className="btn small success" onClick={startProc} disabled={feed.status === 'ended'}>Start stream</button>}
                <button className="btn small danger" onClick={endFeed}>End feed</button>
              </div>
            )}
          </div>
          {feed && (
            <div className="alert info">
              Active feed <strong>{activeFeedName}</strong> · {feedLabel(feed)} · <Badge tone={feed.status === 'active' ? 'green' : 'gray'}>{feed.status}</Badge>
              {session && <span className="muted"> · {session.class_name}{session.lesson_title ? ` · ${session.lesson_title}` : ''}</span>}
              {running && <span className="muted"> · streaming…</span>}
            </div>
          )}
          {data.feeds.length === 0 ? (
            <Empty text="No feeds yet. Upload a photo or stream from a camera above." />
          ) : (
            <div className="pill-row">
              {data.feeds.map((f, i) => (
                <button key={f.id} className={`btn small ${feed && feed.id === f.id ? 'primary' : ''}`} onClick={() => openFeed(f)} title={`feed #${f.id} · created ${fmtDate(f.created_at)}`}>
                  Feed {i + 1} · {feedLabel(f)}
                  <Badge tone={f.status === 'active' ? 'green' : 'gray'}>{f.status}</Badge>
                  <span className="feed-delete-x" onClick={(e) => { e.stopPropagation(); deleteFeed(f); }} title="Delete feed">&times;</span>
                </button>
              ))}
            </div>
          )}
          {data.feeds.length > 0 && <div className="muted mt" style={{ fontSize: 12 }}>Created {fmtDate(data.feeds[0].created_at)}</div>}
        </div>
      </div>

      {feed && (
        <div className="grid cols-2 mb">
          <div className="card">
            <div className="spread mb">
              <h3 style={{ margin: 0 }}>
                Vision feed
                {isDefaultCamera && <span className="muted"> · default camera</span>}
                {session && session.lesson_title && <span className="muted"> · {session.lesson_title}</span>}
              </h3>
              <Badge tone={running || myCam ? 'green' : 'gray'}>{running || myCam ? 'processing' : 'paused'}</Badge>
            </div>
            {myCam ? (
              <div className="feed-frame">
                <div className="feed-stage" style={{ transform: mirror ? 'scaleX(-1)' : undefined }}>
                  <video ref={videoRef} autoPlay playsInline muted />
                  <canvas ref={canvasRef} style={{ display: 'none' }} />
                  <canvas ref={overlayRef} className="overlay-canvas" />
                  {mlDetection && mlDetection.persons.map(renderBox)}
                </div>
                {mlLoading && <div className="ml-loading">Loading ML models…</div>}
                {mlReady && <div className="ml-badge">YOLOv8-pose ML</div>}
              </div>
            ) : feed.source_type === 'photo' ? (
              <div className="feed-frame">
                <img src={feed.photo_path} alt="Uploaded frame" />
                {(result && result.person_detection || []).map(renderBox)}
              </div>
            ) : cameraKind === 'video' ? (
              <div className="feed-frame">
                <video src={feed.stream_url} autoPlay muted controls playsInline />
                {(result && result.person_detection || []).map(renderBox)}
              </div>
            ) : cameraKind === 'mjpeg' ? (
              <div className="feed-frame">
                <img src={feed.stream_url} alt="MJPEG stream" />
                {(result && result.person_detection || []).map(renderBox)}
              </div>
            ) : cameraKind === 'rtsp' ? (
              <div className="feed-frame feed-camera">
                <div className="muted">rtsp:// cannot be played in a browser</div>
                <div className="muted" style={{ fontSize: 12 }}>{feed.stream_url}</div>
                <div className="muted" style={{ fontSize: 12 }}>Use a camera that exposes an http / MJPEG / HLS URL, or capture from your own camera below.</div>
              </div>
            ) : cameraKind === 'hls' ? (
              <div className="feed-frame feed-camera">
                <div className="muted">HLS (.m3u8) streams need a player — open the URL directly in Safari / VLC.</div>
                <div className="muted" style={{ fontSize: 12 }}>{feed.stream_url}</div>
              </div>
            ) : (
              <div className="feed-frame feed-camera">
                <div className="muted">No playable stream URL for this device</div>
                <div className="muted" style={{ fontSize: 12 }}>{feed.stream_url || 'no stream url'}</div>
                <div className="muted" style={{ fontSize: 12 }}>Capture from your own camera below to start streaming frames.</div>
              </div>
            )}
            {result && !mlDetection && <div className="muted mt" style={{ fontSize: 12 }}>frame {result.frame.width}×{result.frame.height} · {result.source || 'mock'} pipeline {result.elapsed_ms} ms</div>}
            {mlDetection && <div className="muted mt" style={{ fontSize: 12 }}>ML ({mlDetection.backend || getBackend()}): {mlDetection.persons.length} person(s) detected · {mlDetection.frame.width}×{mlDetection.frame.height} · {mlDetection.ms} ms/frame</div>}
            <div className="flex mt cam-actions">
              {!myCam
                ? <button className="btn small" onClick={startMyCamera} disabled={feed.status === 'ended' || mlLoading}>{mlLoading ? 'Loading ML…' : 'Start my camera'}</button>
                : <button className="btn small danger" onClick={stopMyCamera}>Stop my camera</button>}
              {myCam && (
                <button className="btn small" onClick={flipCamera} disabled={mlLoading}>
                  {facingMode === 'user' ? 'Switch to rear' : 'Switch to front'}
                </button>
              )}
              {myCam && (
                <button className="btn small" onClick={() => setMirror(!mirror)} disabled={mlLoading} title="Flip the preview so it reads like a mirror (selfie view).">
                  {mirror ? 'Un-mirror' : 'Mirror view'}
                </button>
              )}
              {cameraKind && <Badge tone="gray">{cameraKind.toUpperCase()}</Badge>}
            </div>
          </div>

          <div className="card">
            <div className="spread mb">
              <h3 style={{ margin: 0 }}>AI process</h3>
              <span className="muted" style={{ fontSize: 12 }}>live from WebSocket</span>
            </div>
            {!result && !mlDetection ? (
              <Empty text="No pipeline result yet. Press 'Run now' or 'Start stream'." />
            ) : mlDetection ? (
              <div className="stages">
                <div className="stage">
                  <div className="spread"><strong>Person detection</strong><span className="muted" style={{ fontSize: 12 }}>YOLOv8-pose</span></div>
                  <div className="muted" style={{ fontSize: 12 }}>{mlDetection.persons.length} person(s) detected</div>
                </div>
                {mlDetection.persons.map((p) => (
                  <div className="stage" key={p.id}>
                    <div className="spread"><strong>{p.id}</strong><span className="muted" style={{ fontSize: 12 }}>{Math.round(p.confidence * 100)}% · bbox {Math.round(p.bbox.w * 100)}×{Math.round(p.bbox.h * 100)}%</span></div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {p.pose?.label || 'unknown'} pose
                      {p.raisedHand && <span> · ✋ raised</span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="stages">
                {result.stages.map((st) => (
                  <div className="stage" key={st.name}>
                    <div className="spread">
                      <strong>{st.label}</strong>
                      <span className="muted" style={{ fontSize: 12 }}>{st.ms} ms</span>
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>{stageSummary(st)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
