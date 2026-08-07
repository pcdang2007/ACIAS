import { createContext, useContext, useEffect, useState } from 'react';
import { api, getStoredUser, setAuth, clearAuth } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getStoredUser());
  const [loading, setLoading] = useState(false);

  async function login(username, password) {
    setLoading(true);
    try {
      const data = await api('/auth/login', { method: 'POST', body: { username, password } });
      setAuth(data.token, data.user);
      setUser(data.user);
      return data.user;
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    clearAuth();
    setUser(null);
  }

  function can(perm) {
    if (!user) return false;
    if (user.role_code === 'ADMIN') return true;
    return user.permissions ? user.permissions.includes(perm) : false;
  }

  useEffect(() => {
    if (!user) return;
    api('/auth/me')
      .then(setUser)
      .catch(() => {});
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
