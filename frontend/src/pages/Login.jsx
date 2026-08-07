import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login, loading } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      const user = await login(username, password);
      navigate(user.role_code === 'GUEST' ? '/statistics' : '/');
    } catch (err) {
      setError(err.message);
    }
  }

  function fill(u, p) {
    setUsername(u);
    setPassword(p);
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h2>ACIAS</h2>
        <p className="muted" style={{ marginTop: -8 }}>AI Classroom Interaction Analytics System</p>
        {error && <div className="alert error">{error}</div>}
        <div className="field mb">
          <label>Username</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </div>
        <div className="field mb">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
        <div className="demo-user">
          <strong>Demo accounts</strong><br />
          Admin: <a href="#" onClick={(e) => { e.preventDefault(); fill('admin', 'admin123'); }}>admin / admin123</a><br />
          Teacher: <a href="#" onClick={(e) => { e.preventDefault(); fill('teacher.math', 'password123'); }}>teacher.math / password123</a><br />
          Student: <a href="#" onClick={(e) => { e.preventDefault(); fill('hs001', 'password123'); }}>hs001 / password123</a><br />
          Parent: <a href="#" onClick={(e) => { e.preventDefault(); fill('parent.hs001', 'password123'); }}>parent.hs001 / password123</a>
        </div>
      </form>
    </div>
  );
}
