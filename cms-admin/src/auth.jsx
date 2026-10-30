import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import api, { session, setUnauthorizedHandler } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!session.token);
  const [clientId, setClientIdState] = useState(session.clientId);

  const logout = useCallback((fromUnauthorized) => {
    // revoga o token no servidor (token_version++) antes de apagar a sessão local,
    // pra um token já vazado não continuar valendo os 30 dias restantes dele.
    // Precisa do header explícito: o interceptor de api.js lê session.token de
    // forma assíncrona, e a linha de baixo já apaga o token antes disso rodar
    // — sem o header aqui, a chamada saía sem Authorization, o servidor
    // respondia 401 e o token_version nunca era incrementado (o "Sair" não
    // revogava nada). Se já estamos saindo por causa de um 401, o token já
    // está morto no servidor: não tem por que chamar de novo.
    const token = session.token;
    if (token && !fromUnauthorized) {
      api.post('/auth/logout', null, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    }
    session.token = null;
    session.clientId = null;
    setClientIdState(null);
    setUser(null);
  }, []);

  useEffect(() => { setUnauthorizedHandler(() => logout(true)); }, [logout]);

  // Sincroniza o logout entre abas: se outra aba apagar o token (clicou em
  // "Sair" ou recebeu um 401), esta também limpa o usuário em memória — sem
  // isso, esta aba continuava com a sessão e o WebSocket abertos até a
  // próxima chamada de API cair em 401 por conta própria.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'cms_token' && !e.newValue) logout(true);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [logout]);

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
