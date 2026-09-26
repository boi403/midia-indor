// Utilidades compartilhadas pelas rotas.
const { get, run } = require('../database');

// Express 5 já encaminha rejeições de handlers async para o tratador de erro;
// este wrapper só padroniza a resposta de erros esperados.
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Monta URL absoluta de um arquivo enviado a partir do host da requisição,
// para funcionar tanto em localhost quanto a partir de TVs na rede local.
function publicUrl(req, url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return `${req.protocol}://${req.get('host')}${url.startsWith('/') ? '' : '/'}${url}`;
}

async function clientPlan(clientId) {
  const c = await get(`SELECT c.*, p.name AS plan_name, p.max_tvs, p.max_media, p.max_playlists, p.price_cents,
      p.feat_scheduling, p.feat_cameras, p.feat_reports, p.feat_api
    FROM clients c LEFT JOIN plans p ON p.id = c.plan_id WHERE c.id = ?`, [clientId]);
  if (!c) throw new HttpError(404, 'Cliente não encontrado.');
  c.tv_limit = c.max_tvs_override ?? c.max_tvs ?? null;
  return c;
}

// Recursos do plano só restringem o próprio cliente; o administrador pode
// operar qualquer recurso em nome do cliente.
async function requireFeature(req, feature, label) {
  if (req.user.role === 'admin') return;
  const c = await clientPlan(req.clientId);
  if (!c[`feat_${feature}`]) throw new HttpError(403, `${label} não está incluído no plano ${c.plan_name || 'atual'}.`);
}

async function checkLimit(clientId, kind) {
  const c = await clientPlan(clientId);
  const map = {
    tvs: ['tv_limit', "SELECT count(*) AS n FROM devices WHERE client_id = ? AND status != 'pending'", 'TVs'],
    media: ['max_media', 'SELECT count(*) AS n FROM midia WHERE client_id = ?', 'mídias'],
    playlists: ['max_playlists', 'SELECT count(*) AS n FROM playlists WHERE client_id = ?', 'playlists'],
  };
  const [field, sql, label] = map[kind];
  const limit = c[field];
  if (limit == null) return;
  const { n } = await get(sql, [clientId]);
  if (n >= limit) throw new HttpError(409, `Limite do plano atingido: ${n}/${limit} ${label}. Fale com o administrador para ampliar.`);
}

let notifier = () => {};
function setNotifier(fn) { notifier = fn; }

// Qualquer mudança de conteúdo do cliente incrementa a revisão e avisa as TVs.
async function bumpClient(clientId) {
  await run('UPDATE clients SET content_revision = content_revision + 1 WHERE id = ?', [clientId]);
  notifier({ clientId });
}
async function bumpDevice(deviceId) {
  await run('UPDATE devices SET config_revision = config_revision + 1 WHERE id = ?', [deviceId]);
  notifier({ deviceId });
}

const toInt = (v, def = null) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
};
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

module.exports = { HttpError, publicUrl, clientPlan, requireFeature, checkLimit, bumpClient, bumpDevice, setNotifier, toInt, clamp };
