import { useEffect, useState, useCallback } from 'react';

export function useAsync(fn, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.resolve(fn())
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [tick, ...deps]);

  return { data, error, loading, reload, setData };
}

export function Loading() {
  return <div className="empty">Loading...</div>;
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="alert error">{error.message}</div>;
}

export function Empty({ text = 'No data' }) {
  return <div className="empty">{text}</div>;
}

export function StatCard({ label, value, hint, color }) {
  return (
    <div className="card stat-card">
      <div className="label">{label}</div>
      <div className="value" style={color ? { color } : undefined}>{value}</div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function Badge({ tone = 'gray', children }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 12, maxWidth: 560, width: '100%', maxHeight: '85vh', overflowY: 'auto', padding: 22, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div className="spread mb">
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button className="btn small" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function fmtDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
