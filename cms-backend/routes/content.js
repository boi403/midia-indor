// Conteúdo do cliente: configuração da tela, mídias, slides, notícias e câmeras.
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const dns = require('dns');
const { run, get, all } = require('../database');
const { requireAuth, requireClientScope, signCameraLink, verifyCameraLink } = require('../lib/auth');
const { HttpError, publicUrl, checkLimit, requireFeature, bumpClient, toInt } = require('../lib/common');
const cameraStream = require('../lib/camera-stream');
const rateLimit = require('../lib/rate-limit');
const { deviceAuth } = require('./player');

const router = express.Router();
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// Extensões aceitas no upload. A extensão salva em disco nunca vem do nome
// original enviado pelo cliente — vem sempre da assinatura de bytes real do
// arquivo (ver validateUploadedFile), pra evitar um .html/.svg disfarçado.
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.webm'];

// Assinaturas (magic bytes) dos formatos aceitos, lidas dos primeiros ~16 bytes do arquivo.
const MAGIC_SIGNATURES = [
  { type: 'image', ext: '.jpg', check: (b) => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
  { type: 'image', ext: '.png', check: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 },
  { type: 'image', ext: '.gif', check: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 },
  { type: 'image', ext: '.webp', check: (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
  { type: 'video', ext: '.mp4', check: (b) => b.toString('latin1', 4, 8) === 'ftyp' },
  { type: 'video', ext: '.webm', check: (b) => b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3 },
];

// Confere o conteúdo real do arquivo (nunca o mimetype/nome mandado pelo navegador,
// que são controlados pelo atacante) e renomeia pra extensão correta antes de aceitar.
function validateUploadedFile(file) {
  const buf = Buffer.alloc(16);
  const fd = fs.openSync(file.path, 'r');
  try { fs.readSync(fd, buf, 0, 16, 0); } finally { fs.closeSync(fd); }
  const sig = MAGIC_SIGNATURES.find((s) => s.check(buf));
  if (!sig) {
    fs.unlinkSync(file.path);
    throw new HttpError(400, 'Arquivo inválido: o conteúdo não corresponde a uma imagem ou vídeo permitido.');
  }
  const newFilename = path.parse(file.filename).name + sig.ext;
  const newPath = path.join(uploadsDir, newFilename);
  if (newPath !== file.path) fs.renameSync(file.path, newPath);
  file.filename = newFilename;
  file.path = newPath;
  return sig.type; // 'image' | 'video'
}

const diskStorage = multer.diskStorage({
  destination: uploadsDir,
  // Extensão provisória: a definitiva é decidida depois por validateUploadedFile,
  // com base no conteúdo real do arquivo (nunca no nome enviado pelo cliente).
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}.upload`),
});
const uploadFilter = (req, file, cb) => cb(null, ALLOWED_EXTENSIONS.includes(path.extname(file.originalname).toLowerCase()));

const upload = multer({
  storage: diskStorage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  fileFilter: uploadFilter,
});

// Upload tipo "logo": sem checagem de cota por tenant, então usa um limite de
// tamanho bem mais apertado que o upload geral de mídia.
const uploadLogo = multer({
  storage: diskStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: uploadFilter,
});

const ORIENT = (v) => (['landscape', 'portrait'].includes(v) ? v : 'any');
const removeFile = (filename) => {
  const f = path.join(uploadsDir, path.basename(filename || ''));
  if (filename && fs.existsSync(f)) fs.unlinkSync(f);
};

// ---------- rotas públicas usadas pelo player ----------

// Stream MJPEG da câmera. A URL leva uma assinatura (sig) porque o <img> do
// player/preview não consegue mandar cabeçalho de autenticação.
const MAX_CAMERA_VIEWERS = 20; // o link assinado não é de uso único; limita espectadores simultâneos por câmera
router.get('/cameras/:id/stream.mjpg', rateLimit({ windowMs: 60000, max: 60, message: 'Muitas requisições.' }), async (req, res) => {
  if (!verifyCameraLink(req.params.id, req.query.exp, req.query.sig)) return res.status(403).end();
  if (cameraStream.clientCount(req.params.id) >= MAX_CAMERA_VIEWERS) return res.status(429).end();
  const cam = await get('SELECT id, url FROM cameras WHERE id = ?', [req.params.id]);
  if (!cam) return res.status(404).end();
  cameraStream.serve(req, res, cam);
});

// Proxy do feed RSS do cliente (resolve CORS para o player). Cache de 10 min
// por URL para várias TVs não multiplicarem as requisições ao portal; falhas
// ficam em cache por 2 min pra não travar toda TV no timeout quando o feed está fora.
const feedCache = new Map();
const feedFailureCache = new Map();
const feedInFlight = new Map(); // single-flight: uma única requisição em andamento por URL
const FEED_SUCCESS_TTL_MS = 10 * 60000;
const FEED_FAILURE_TTL_MS = 2 * 60000;

// Lê e normaliza a lista de URLs de feed do cliente (até 5), com fallback pro
// antigo news_feed_url (coluna única) pra quem configurou antes desta função existir.
function parseFeedUrls(client) {
  let urls = [];
  try { urls = JSON.parse(client?.news_feed_urls || '[]'); } catch { urls = []; }
  if (!Array.isArray(urls)) urls = [];
  urls = urls.map((u) => String(u || '').trim()).filter(Boolean);
  if (!urls.length && client?.news_feed_url) urls = [client.news_feed_url.trim()].filter(Boolean);
  return urls.slice(0, 5);
}

// Busca um feed (com cache/single-flight/cache-de-falha já existentes por URL),
// sem derrubar os outros feeds do cliente se este em particular falhar.
async function fetchOneFeed(feedUrl) {
  const hit = feedCache.get(feedUrl);
  if (hit && hit.at > Date.now() - FEED_SUCCESS_TTL_MS) return { items: hit.items };

  const failure = feedFailureCache.get(feedUrl);
  if (failure && failure.at > Date.now() - FEED_FAILURE_TTL_MS) return { items: hit?.items || [], error: failure.error };

  try {
    const items = await getFeedSingleFlight(feedUrl);
    feedCache.set(feedUrl, { at: Date.now(), items });
    feedFailureCache.delete(feedUrl);
    return { items };
  } catch (err) {
    feedFailureCache.set(feedUrl, { at: Date.now(), error: err.message });
    return { items: hit?.items || [], error: err.message };
  }
}

router.get('/news-feed', deviceAuth, async (req, res) => {
  const client = await get('SELECT news_feed_url, news_feed_urls FROM clients WHERE id = ?', [req.device.client_id]);
  const feedUrls = parseFeedUrls(client);
  if (!feedUrls.length) return res.json({ items: [] });

  const results = await Promise.all(feedUrls.map(fetchOneFeed));
  // intercala os feeds em vez de concatenar em blocos, pra nenhum dominar o ticker
  const lists = results.map((r) => r.items || []);
  const items = [];
  for (let i = 0; items.length < 20 && lists.some((l) => l.length > i); i++) {
    for (const l of lists) if (l[i]) items.push(l[i]);
  }
  const errors = results.map((r) => r.error).filter(Boolean);
  res.json(errors.length ? { items, errors } : { items });
});

// Junta requisições concorrentes à mesma URL numa única promessa em andamento.
function getFeedSingleFlight(feedUrl) {
  let p = feedInFlight.get(feedUrl);
  if (p) return p;
  p = fetchFeed(feedUrl).finally(() => feedInFlight.delete(feedUrl));
  feedInFlight.set(feedUrl, p);
  return p;
}

// Faixas privadas/loopback/link-local — feed não pode apontar pra rede interna (SSRF).
const PRIVATE_IPV4_CIDRS = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '169.254.0.0/16'];
function ipv4ToInt(ip) {
  const p = ip.split('.').map(Number);
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}
function inIpv4Cidr(ip, cidr) {
  const [range, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(range) & mask);
}
function isDisallowedIp(address, family) {
  if (family === 6 || address.includes(':')) {
    const a = address.toLowerCase();
    if (a === '::1') return true; // loopback IPv6
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
    if (mapped) return isDisallowedIp(mapped[1], 4);
    const firstGroup = a.split(':')[0];
    if (/^f[cd]/.test(firstGroup)) return true; // fc00::/7
    return false;
  }
  return PRIVATE_IPV4_CIDRS.some((cidr) => inIpv4Cidr(address, cidr));
}

// Só http(s) e hosts que não resolvam pra rede interna/privada.
async function assertSafeFeedUrl(feedUrl) {
  let parsed;
  try { parsed = new URL(feedUrl); } catch { throw new Error('URL do feed inválida.'); }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('Protocolo do feed não permitido.');
  const addresses = await dns.promises.lookup(parsed.hostname, { all: true });
  if (!addresses.length) throw new Error('Não foi possível resolver o host do feed.');
  if (addresses.some((a) => isDisallowedIp(a.address, a.family))) {
    throw new Error('Host do feed não permitido.');
  }
}

// Lê o corpo da resposta limitando o tamanho total (~1MB) pra não travar
// memória/tempo com uma resposta gigante de um feed mal configurado.
async function readBodyCapped(response, maxBytes) {
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) throw new Error('Resposta do feed excede o tamanho máximo permitido.');
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* já liberado */ }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

async function fetchFeed(feedUrl) {
  await assertSafeFeedUrl(feedUrl);
  const response = await fetch(feedUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MidiaIndoor/2.0)' }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Feed respondeu com status ${response.status}.`);
  const xml = await readBodyCapped(response, 1024 * 1024);
  const items = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  const titleRe = /<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]>|<title[^>]*>([^<]*)<\/title>/i;
  const descRe = /<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]>|<description[^>]*>([^<]*)<\/description>/i;
  const imgRe = /<enclosure[^>]+url="([^"]+)"[^>]*type="image[^"]*"|<media:content[^>]+url="([^"]+)"/i;
  const linkRe = /<link[^>]*>([^<]+)<\/link>|<link[^>]+href="([^"]+)"/i;
  const pick = (re, block) => { const m = re.exec(block) || []; return m[1] || m[2] || ''; };
  const decode = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();

  let m;
  while ((m = itemRe.exec(xml)) !== null && items.length < 10) {
    const block = m[1];
    const title = decode(pick(titleRe, block));
    if (title) items.push({ title, desc: decode(pick(descRe, block)).slice(0, 200), img: pick(imgRe, block), link: pick(linkRe, block) });
  }
  // Não é RSS: tenta extrair manchetes do HTML (ex.: portal da Prefeitura)
  if (items.length === 0 && xml.includes('<html')) {
    for (const b of xml.split('<a ')) {
      if (!/pmaa-slide-titulo|pmaa-galeria-titulo|not-titulo|card-noticia/.test(b)) continue;
      const titleMatch = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(b);
      if (!titleMatch) continue;
      let img = (/<img\s+[^>]*src="([^"]+)"/i.exec(b) || [])[1] || '';
      if (img && !img.startsWith('http')) img = new URL(feedUrl).origin + (img.startsWith('/') ? img : '/' + img);
      items.push({ link: (/href="([^"]+)"/.exec(b) || [])[1] || '', img, title: decode(titleMatch[1]), desc: '' });
      if (items.length >= 10) break;
    }
  }
  return items;
}

// ---------- daqui em diante: painel autenticado, escopo de um cliente ----------
router.use(requireAuth, requireClientScope);

// ---------- configuração da tela (identidade visual do cliente) ----------
router.get('/config', async (req, res) => {
  const c = await get(`SELECT id, name, tagline, primary_color, accent_color, logo_url, weather_lat, weather_lon, weather_city,
    news_feed_url, news_feed_urls, timezone, pinned_camera_id FROM clients WHERE id = ?`, [req.clientId]);
  if (!c) throw new HttpError(404, 'Cliente não encontrado.');
  res.json({ ...c, logo_full_url: publicUrl(req, c.logo_url), news_feed_urls: parseFeedUrls(c) });
});

router.put('/config', async (req, res) => {
  const b = req.body || {};
  const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
  const logo = b.logo_url ? String(b.logo_url).replace(/^https?:\/\/[^/]+(?=\/uploads\/)/, '') : null;
  const feedUrls = (Array.isArray(b.news_feed_urls) ? b.news_feed_urls : []).map((u) => String(u || '').trim()).filter(Boolean).slice(0, 5);
  await run(`UPDATE clients SET name = COALESCE(?, name), tagline = ?, primary_color = ?, accent_color = ?, logo_url = ?,
      weather_lat = ?, weather_lon = ?, weather_city = ?, news_feed_url = ?, news_feed_urls = ?, timezone = ? WHERE id = ?`, [
    b.name || null, b.tagline || '', b.primary_color || '#0E4C68', b.accent_color || '#C9A227', logo,
    num(b.weather_lat), num(b.weather_lon), b.weather_city || '', feedUrls[0] || null, JSON.stringify(feedUrls), b.timezone || 'America/Cuiaba', req.clientId,
  ]);
  await bumpClient(req.clientId);
  res.json({ success: true });
});

router.post('/upload', uploadLogo.single('file'), (req, res) => {
  if (!req.file) throw new HttpError(400, 'Envie uma imagem ou vídeo.');
  validateUploadedFile(req.file);
  const url = '/uploads/' + req.file.filename;
  res.json({ url, full_url: publicUrl(req, url) });
});

// ---------- mídias ----------
router.get('/midia', async (req, res) => {
  const rows = await all(`SELECT m.*, (SELECT count(*) FROM playlist_items pi JOIN playlists p ON p.id = pi.playlist_id
      WHERE p.client_id = m.client_id AND pi.kind = 'media' AND (pi.ref_id = CAST(m.id AS TEXT) OR pi.portrait_ref_id = CAST(m.id AS TEXT))) AS usage
    FROM midia m WHERE m.client_id = ? ORDER BY m.id DESC`, [req.clientId]);
  res.json(rows.map(m => ({ ...m, full_url: publicUrl(req, m.url) })));
});

router.post('/midia', async (req, res, next) => {
  try { await checkLimit(req.clientId, 'media'); } catch (e) { return next(e); }
  next();
}, upload.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Envie uma imagem ou vídeo.');
  const type = validateUploadedFile(req.file);
  const url = '/uploads/' + req.file.filename;
  const r = await run(`INSERT INTO midia (type, filename, url, duration_ms, title, original_name, bytes, orientation, client_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    type, req.file.filename, url, type === 'video' ? 30000 : 10000,
    req.body.title || path.parse(req.file.originalname).name, req.file.originalname, req.file.size, ORIENT(req.body.orientation), req.clientId,
  ]);
  if (req.body.add_to_playlist) {
    const pl = await get('SELECT id FROM playlists WHERE id = ? AND client_id = ?', [req.body.add_to_playlist, req.clientId]);
    if (pl) {
      const { pos } = await get('SELECT coalesce(max(position), -1) + 1 AS pos FROM playlist_items WHERE playlist_id = ?', [pl.id]);
      await run('INSERT INTO playlist_items (playlist_id, kind, ref_id, duration_ms, position) VALUES (?, ?, ?, ?, ?)', [pl.id, 'media', String(r.lastID), type === 'video' ? 30000 : 10000, pos]);
    }
  }
  await bumpClient(req.clientId);
  res.json({ id: r.lastID, type, url: publicUrl(req, url) });
});

router.patch('/midia/:id', async (req, res) => {
  const m = await get('SELECT * FROM midia WHERE id = ? AND client_id = ?', [req.params.id, req.clientId]);
  if (!m) throw new HttpError(404, 'Mídia não encontrada.');
  const b = req.body || {};
  await run('UPDATE midia SET duration_ms = ?, title = ?, orientation = ? WHERE id = ?', [
    Math.max(1000, toInt(b.duration_ms, m.duration_ms)), b.title ?? m.title, b.orientation ? ORIENT(b.orientation) : m.orientation, m.id,
  ]);
  await bumpClient(req.clientId);
  res.json({ success: true });
});

router.delete('/midia/:id', async (req, res) => {
  const m = await get('SELECT * FROM midia WHERE id = ? AND client_id = ?', [req.params.id, req.clientId]);
  if (!m) throw new HttpError(404, 'Mídia não encontrada.');
  await run('DELETE FROM midia WHERE id = ?', [m.id]);
  removeFile(m.filename);
  await run(`DELETE FROM playlist_items WHERE kind = 'media' AND ref_id = ? AND playlist_id IN (SELECT id FROM playlists WHERE client_id = ?)`, [String(m.id), req.clientId]);
  await run(`UPDATE playlist_items SET portrait_ref_id = NULL WHERE portrait_ref_id = ? AND playlist_id IN (SELECT id FROM playlists WHERE client_id = ?)`, [String(m.id), req.clientId]);
  await bumpClient(req.clientId);
  res.json({ success: true });
});

// ---------- slides ----------
router.get('/slides', async (req, res) => {
  const rows = await all('SELECT * FROM slides WHERE client_id = ? ORDER BY position, id', [req.clientId]);
  res.json(rows.map((s) => ({ ...s, bg_full_url: publicUrl(req, s.bg_url) })));
});

// Normaliza o bg_url recebido do painel (que manda a full_url) de volta pra
// caminho relativo, do mesmo jeito que /config já faz com o logo.
const relUploadPath = (url) => (url ? String(url).replace(/^https?:\/\/[^/]+(?=\/uploads\/)/, '') : null);

router.post('/slides', async (req, res) => {
  const b = req.body || {};
  const id = 's_' + Date.now() + Math.round(Math.random() * 1000);
  await run(`INSERT INTO slides (id, type, variant, widget, kick, title, text, config_json, duration_ms, position, orientation, client_id, bg_url)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
    id, b.type === 'widget' ? 'widget' : 'slide', b.variant || null, b.widget || null, b.kick || '', b.title || '', b.text || '',
    b.config_json || null, toInt(b.duration_ms, 10000), 99, ORIENT(b.orientation), req.clientId, relUploadPath(b.bg_url),
  ]);
  await bumpClient(req.clientId);
  res.json({ success: true, id });
});

router.put('/slides/:id', async (req, res) => {
  const b = req.body || {};
  const existing = await get('SELECT bg_url FROM slides WHERE id = ? AND client_id = ?', [req.params.id, req.clientId]);
  if (!existing) throw new HttpError(404, 'Slide não encontrado.');
  const bgUrl = relUploadPath(b.bg_url);
  const r = await run(`UPDATE slides SET kick = ?, title = ?, text = ?, config_json = ?, duration_ms = COALESCE(?, duration_ms), orientation = ?, bg_url = ?
    WHERE id = ? AND client_id = ?`, [b.kick, b.title, b.text, b.config_json, toInt(b.duration_ms), ORIENT(b.orientation), bgUrl, req.params.id, req.clientId]);
  if (!r.changes) throw new HttpError(404, 'Slide não encontrado.');
  if (existing.bg_url && existing.bg_url !== bgUrl) removeFile(existing.bg_url);
  await bumpClient(req.clientId);
  res.json({ success: true });
});

router.delete('/slides/:id', async (req, res) => {
  const existing = await get('SELECT bg_url FROM slides WHERE id = ? AND client_id = ?', [req.params.id, req.clientId]);
  const r = await run('DELETE FROM slides WHERE id = ? AND client_id = ?', [req.params.id, req.clientId]);
  if (!r.changes) throw new HttpError(404, 'Slide não encontrado.');
  if (existing?.bg_url) removeFile(existing.bg_url);
  await run(`DELETE FROM playlist_items WHERE kind = 'slide' AND ref_id = ? AND playlist_id IN (SELECT id FROM playlists WHERE client_id = ?)`, [req.params.id, req.clientId]);
  await bumpClient(req.clientId);
  res.json({ success: true });
});

// ---------- notícias (ticker) ----------
router.get('/noticias', async (req, res) => {
  res.json(await all('SELECT * FROM noticias WHERE client_id = ? ORDER BY id DESC', [req.clientId]));
});
router.post('/noticias', async (req, res) => {
  const texto = String(req.body?.texto || '').trim();
  if (!texto) throw new HttpError(400, 'Texto é obrigatório.');
  const r = await run('INSERT INTO noticias (texto, client_id) VALUES (?, ?)', [texto, req.clientId]);
  await bumpClient(req.clientId);
  res.json({ id: r.lastID, texto });
});
router.patch('/noticias/:id', async (req, res) => {
  const n = await get('SELECT * FROM noticias WHERE id = ? AND client_id = ?', [req.params.id, req.clientId]);
  if (!n) throw new HttpError(404, 'Notícia não encontrada.');
  const b = req.body || {};
  await run('UPDATE noticias SET texto = ?, enabled = ? WHERE id = ?', [
    String(b.texto ?? n.texto).trim() || n.texto, b.enabled === undefined ? n.enabled : (b.enabled ? 1 : 0), n.id,
  ]);
  await bumpClient(req.clientId);
  res.json({ success: true });
});
router.delete('/noticias/:id', async (req, res) => {
  await run('DELETE FROM noticias WHERE id = ? AND client_id = ?', [req.params.id, req.clientId]);
  await bumpClient(req.clientId);
  res.json({ success: true });
});

// ---------- câmeras ----------
const camerasRouter = express.Router();
camerasRouter.use(async (req, res, next) => { await requireFeature(req, 'cameras', 'Câmeras ao vivo'); next(); });

camerasRouter.get('/', async (req, res) => {
  const rows = await all('SELECT * FROM cameras WHERE client_id = ? ORDER BY position, id', [req.clientId]);
  const cfg = await get('SELECT pinned_camera_id FROM clients WHERE id = ?', [req.clientId]);
  res.json({
    pinned_camera_id: cfg?.pinned_camera_id || null,
    cameras: rows.map(c => {
      const { sig, exp } = signCameraLink(c.id);
      return { ...c, stream_url: publicUrl(req, `/api/cameras/${c.id}/stream.mjpg?sig=${sig}&exp=${exp}`) };
    }),
  });
});

camerasRouter.post('/', async (req, res) => {
  const { label, url, duration_ms, add_to_playlist } = req.body || {};
  if (!label || !url) throw new HttpError(400, 'Nome e URL são obrigatórios.');
  const r = await run('INSERT INTO cameras (label, url, duration_ms, client_id) VALUES (?, ?, ?, ?)', [label, url, toInt(duration_ms, 15000), req.clientId]);
  if (add_to_playlist) {
    const pl = await get('SELECT id FROM playlists WHERE id = ? AND client_id = ?', [add_to_playlist, req.clientId]);
    if (pl) {
      const { pos } = await get('SELECT coalesce(max(position), -1) + 1 AS pos FROM playlist_items WHERE playlist_id = ?', [pl.id]);
      await run('INSERT INTO playlist_items (playlist_id, kind, ref_id, duration_ms, position) VALUES (?, ?, ?, ?, ?)', [pl.id, 'camera', String(r.lastID), toInt(duration_ms, 15000), pos]);
    }
  }
  await bumpClient(req.clientId);
  res.json({ id: r.lastID });
});

camerasRouter.put('/:id', async (req, res) => {
  const { label, url, duration_ms } = req.body || {};
  if (!label || !url) throw new HttpError(400, 'Nome e URL são obrigatórios.');
  const cam = await get('SELECT id FROM cameras WHERE id = ? AND client_id = ?', [req.params.id, req.clientId]);
  if (!cam) throw new HttpError(404, 'Câmera não encontrada.');
  cameraStream.stop(cam.id);
  await run('UPDATE cameras SET label = ?, url = ?, duration_ms = ? WHERE id = ? AND client_id = ?', [label, url, toInt(duration_ms, 15000), cam.id, req.clientId]);
  await bumpClient(req.clientId);
  res.json({ success: true });
});

// Ativar/desativar sem excluir o cadastro (desativada não aparece em nenhuma playlist)
camerasRouter.post('/:id/toggle', async (req, res) => {
  const cam = await get('SELECT enabled FROM cameras WHERE id = ? AND client_id = ?', [req.params.id, req.clientId]);
  if (!cam) throw new HttpError(404, 'Câmera não encontrada.');
  await run('UPDATE cameras SET enabled = ? WHERE id = ?', [cam.enabled ? 0 : 1, req.params.id]);
  await bumpClient(req.clientId);
  res.json({ success: true, enabled: !cam.enabled });
});

camerasRouter.delete('/:id', async (req, res) => {
  const cam = await get('SELECT id FROM cameras WHERE id = ? AND client_id = ?', [req.params.id, req.clientId]);
  if (!cam) throw new HttpError(404, 'Câmera não encontrada.');
  cameraStream.stop(cam.id);
  await run('DELETE FROM cameras WHERE id = ? AND client_id = ?', [cam.id, req.clientId]);
  await run('UPDATE clients SET pinned_camera_id = NULL WHERE id = ? AND pinned_camera_id = ?', [req.clientId, cam.id]);
  await run('UPDATE devices SET pinned_camera_id = NULL WHERE client_id = ? AND pinned_camera_id = ?', [req.clientId, cam.id]);
  await run(`DELETE FROM playlist_items WHERE kind = 'camera' AND ref_id = ? AND playlist_id IN (SELECT id FROM playlists WHERE client_id = ?)`, [cam.id, req.clientId]);
  await bumpClient(req.clientId);
  res.json({ success: true });
});

// Fixar a câmera em todas as TVs do cliente (substitui a programação até desfixar)
camerasRouter.post('/:id/pin', async (req, res) => {
  const cam = await get('SELECT id FROM cameras WHERE id = ? AND client_id = ?', [req.params.id, req.clientId]);
  if (!cam) throw new HttpError(404, 'Câmera não encontrada.');
  await run('UPDATE clients SET pinned_camera_id = ? WHERE id = ?', [cam.id, req.clientId]);
  await bumpClient(req.clientId);
  res.json({ success: true, pinned_camera_id: cam.id });
});

router.post('/cameras/unpin', async (req, res) => {
  await requireFeature(req, 'cameras', 'Câmeras ao vivo');
  await run('UPDATE clients SET pinned_camera_id = NULL WHERE id = ?', [req.clientId]);
  await bumpClient(req.clientId);
  res.json({ success: true });
});
router.use('/cameras', camerasRouter);

module.exports = router;
