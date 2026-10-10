// Utilidades compartilhadas pelas rotas.
const { get, run } = require('../database');

// Express 5 já encaminha rejeições de handlers async para o tratador de erro;
// este wrapper só padroniza a resposta de erros esperados.
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Monta URL absoluta de um arquivo enviado a partir do host da requisição,
// para funcionar tanto em localhost quanto a partir de TVs na rede local.
// Uso restrito a URLs de mídia (não sensível: o pior caso é uma imagem que
// não carrega). Para links sensíveis (e-mail de redefinição de senha, URLs
// do Mercado Pago), use trustedUrl, que valida o Host.
function publicUrl(req, url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return `${req.protocol}://${req.get('host')}${url.startsWith('/') ? '' : '/'}${url}`;
}

// Hosts em que confiamos pra montar links sensíveis: o domínio público
// configurado (billing.public_host, atrás do túnel) e a rede local, onde o
// sistema roda hoje (painel/TVs acessando por localhost ou IP da LAN).
const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const LAN_HOST_RE = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/;

// Nunca confiar cegamente no cabeçalho Host: um atacante pode forjá-lo pra
// "envenenar" um link sensível (ex.: mandar pro e-mail da vítima um link de
// redefinição de senha apontando pro domínio do atacante, roubando o token
// quando ela clicar — leva a um "fuga"/roubo de conta mesmo sem a senha
// nunca ter sido exposta). Fecha em erro (fail closed) em vez de aceitar um
// host desconhecido.
function trustedHost(req) {
  const configured = require('./config').get().billing?.public_host;
  if (configured) return configured;
  const host = String(req.get('host') || '');
  const hostname = host.split(':')[0];
  if (LOCAL_HOST_RE.test(host) || LAN_HOST_RE.test(hostname)) return host;
  return null;
}

function trustedUrl(req, path) {
  const host = trustedHost(req);
  if (!host) throw new HttpError(400, 'Requisição de um endereço não reconhecido.');
  return `${req.protocol}://${host}${path.startsWith('/') ? '' : '/'}${path}`;
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

// Mensalidade por faixa de quantidade de TVs: 1 TV = R$250, 2 TVs = R$500,
// 3 ou mais = R$799. Configurável em config.json (billing.tiers); estes são
// só os valores padrão caso a config não defina a tabela.
const TIER_DEFAULTS = [
  { max_tvs: 1, price_cents: 25000 },
  { max_tvs: 2, price_cents: 50000 },
  { max_tvs: null, price_cents: 79900 }, // null = sem limite superior (3+)
];

function tierFeeCents(tvCount) {
  const config = require('./config');
  const tiers = config.get().billing?.tiers;
  const list = Array.isArray(tiers) && tiers.length ? tiers : TIER_DEFAULTS;
  for (const t of list) {
    if (t.max_tvs == null || tvCount <= t.max_tvs) return t.price_cents;
  }
  return list[list.length - 1].price_cents;
}

// Mesma contagem de TVs "reais" (exclui pareamentos pendentes) usada em checkLimit.
async function clientTvCount(clientId) {
  const { n } = await get("SELECT count(*) AS n FROM devices WHERE client_id = ? AND status != 'pending'", [clientId]);
  return n;
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

module.exports = { HttpError, publicUrl, trustedUrl, trustedHost, clientPlan, requireFeature, checkLimit, bumpClient, bumpDevice, setNotifier, toInt, clamp, tierFeeCents, clientTvCount };
