import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import api, { session, setUnauthorizedHandler } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!session.token);
  const [clientId, setClientIdState] = useState(session.clientId);

  const logout = useCallback(() => {
    session.token = null;
    session.clientId = null;
    setClientIdState(null);
    setUser(null);
  }, []);

  useEffect(() => { setUnauthorizedHandler(logout); }, [logout]);

  // sessão persistente: revalida o token salvo ao abrir o painel
  useEffect(() => {
    if (!session.token) return;
    api.get('/auth/me')
      .then((r) => setUser(r.data.user))
      .catch(() => logout())
      .finally(() => setLoading(false));
  }, [logout]);

  const login = useCallback(async (email, password, role) => {
    const r = await api.post('/auth/login', { email, password, role });
    session.token = r.data.token;
    const u = r.data.user;
    if (u.role === 'client') { session.clientId = u.client_id; setClientIdState(String(u.client_id)); }
    setUser(u);
    return u;
  }, []);

  const selectClient = useCallback((id) => {
    session.clientId = id || null;
    setClientIdState(id ? String(id) : null);
  }, []);

  const value = useMemo(() => ({
    user, loading, login, logout, clientId, selectClient,
    isAdmin: user?.role === 'admin',
    base: user?.role === 'admin' ? '/admin' : '/cliente',
    // recursos do plano: administrador sempre tem acesso a tudo
    can: (feature) => user?.role === 'admin' || !!user?.client?.features?.[feature],
  }), [user, loading, login, logout, clientId, selectClient]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}

export function RequireRole({ role, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="boot">Carregando…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.role !== role) return <Navigate to={user.role === 'admin' ? '/admin' : '/cliente'} replace />;
  return children;
}
