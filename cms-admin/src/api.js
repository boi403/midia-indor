import axios from 'axios';

// Em desenvolvimento (Vite na 5173) a API fica na porta 3000 da mesma máquina;
// em produção o backend pode estar em outra porta (env PORT) ou atrás de um
// proxy reverso (80/443), então usamos sempre a própria origem da página.
export const API_ROOT = import.meta.env.VITE_API_URL
  || (import.meta.env.DEV ? `${location.protocol}//${location.hostname}:3000` : window.location.origin);

const TOKEN_KEY = 'cms_token';
const CLIENT_KEY = 'cms_client_id';

// localStorage pode estar bloqueado (aba anônima, política do navegador): o
// painel continua funcionando, só não lembra a sessão.
const memory = {};
function read(key) {
  try { return localStorage.getItem(key); } catch { return memory[key] ?? null; }
}
function write(key, value) {
  try {
    if (value) localStorage.setItem(key, String(value)); else localStorage.removeItem(key);
  } catch {
    if (value) memory[key] = String(value); else delete memory[key];
  }
}

export const session = {
  get token() { return read(TOKEN_KEY); },
  set token(v) { write(TOKEN_KEY, v); },
  get clientId() { return read(CLIENT_KEY); },
  set clientId(v) { write(CLIENT_KEY, v); },
};

const api = axios.create({ baseURL: `${API_ROOT}/api` });

api.interceptors.request.use((config) => {
  const t = session.token;
  if (t) config.headers.Authorization = `Bearer ${t}`;
  // administrador age sobre o cliente escolhido no topo do painel
  // (uma chamada pode definir o próprio X-Client-Id, inclusive vazio = todos)
  if (session.clientId && config.headers['X-Client-Id'] === undefined) config.headers['X-Client-Id'] = session.clientId;
  return config;
});

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

api.interceptors.response.use((r) => r, (err) => {
  if (err.response?.status === 401 && !err.config.url.includes('/auth/login')) onUnauthorized();
  return Promise.reject(err);
});

export function errorMessage(err, fallback = 'Algo deu errado. Tente novamente.') {
  return err?.response?.data?.error || (err?.request && !err.response ? 'Servidor indisponível. Verifique se o backend está rodando.' : fallback);
}

export const wsUrl = (path) => `${API_ROOT.replace(/^http/, 'ws')}${path}`;
export const playerUrl = (query = '') => `${API_ROOT}/tv${query}`;

export default api;
