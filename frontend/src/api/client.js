const TOKEN_KEY = 'acias_token';
const USER_KEY = 'acias_user';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuth(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export async function api(path, { method = 'GET', body, headers = {}, params } = {}) {
  let url = `/api${path}`;
  if (params) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.append(k, v);
    });
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`,
        ...headers
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new Error('Cannot reach the server. Check that the backend is running and try again.');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    if (res.status === 401) clearAuth();
    throw err;
  }
  return data;
}

export async function uploadFile(path, file, field = 'file', extra = {}) {
  const form = new FormData();
  form.append(field, file);
  Object.entries(extra).forEach(([k, v]) => form.append(k, v));
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: form
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data && data.error) || 'Upload failed');
  return data;
}

export function openRealtime(onEvent) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const token = encodeURIComponent(getToken() || '');
  const ws = new WebSocket(`${proto}://${location.host}/ws?token=${token}`);
  ws.onmessage = (msg) => {
    let parsed;
    try {
      parsed = JSON.parse(msg.data);
    } catch {
      return;
    }
    if (parsed && parsed.event === 'session_kicked') {
      clearAuth();
      if (!location.pathname.startsWith('/login')) location.href = '/login';
      return;
    }
    onEvent(parsed);
  };
  return ws;
}
