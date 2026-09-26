// Conteúdo do cliente: configuração da tela, mídias, slides, notícias e câmeras.
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { run, get, all } = require('../database');
const { requireAuth, requireClientScope, cameraSig, checkCameraSig } = require('../lib/auth');
const { HttpError, publicUrl, checkLimit, requireFeature, bumpClient, toInt } = require('../lib/common');
const cameraStream = require('../lib/camera-stream');
const { deviceAuth } = require('./player');

const router = express.Router();
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^(image|video)\//.test(file.mimetype)),
});

const ORIENT = (v) => (['landscape', 'portrait'].includes(v) ? v : 'any');
const removeFile = (filename) => {
  const f = path.join(uploadsDir, path.basename(filename || ''));
  if (filename && fs.existsSync(f)) fs.unlinkSync(f);
};

// ---------- rotas públicas usadas pelo player ----------

// Stream MJPEG da câmera. A URL leva uma assinatura (sig) porque o <img> do
// player/preview não consegue mandar cabeçalho de autenticação.
router.get('/cameras/:id/stream.mjpg', async (req, res) => {
  if (!checkCameraSig(req.params.id, req.query.sig)) return res.status(403).end();
  const cam = await get('SELECT id, url FROM cameras WHERE id = ?', [req.params.id]);
  if (!cam) return res.status(404).end();
  cameraStream.serve(req, res, cam);
});

// Proxy do feed RSS do cliente (resolve CORS para o player). Cache de 10 min
// por URL para várias TVs não multiplicarem as requisições ao portal.
const feedCache = new Map();
router.get('/news-feed', deviceAuth, async (req, res) => {
  const client = await get('SELECT news_feed_url FROM clients WHERE id = ?', [req.device.client_id]);
  const feedUrl = (client?.news_feed_url || '').trim();
  if (!feedUrl) return res.json({ items: [] });
  const hit = feedCache.get(feedUrl);
  if (hit && hit.at > Date.now() - 10 * 60000) return res.json({ items: hit.items });
  try {
    const items = await fetchFeed(feedUrl);
    feedCache.set(feedUrl, { at: Date.now(), items });
    res.json({ items });
  } catch (err) {
    res.json({ items: hit?.items || [], error: err.message });
  }
});

async function fetchFeed(feedUrl) {
  const response = await fetch(feedUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MidiaIndoor/2.0)' }, signal: AbortSignal.timeout(8000) });
  const xml = await response.text();
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
    news_feed_url, timezone, pinned_camera_id FROM clients WHERE id = ?`, [req.clientId]);
  if (!c) throw new HttpError(404, 'Cliente não encontrado.');
  res.json({ ...c, logo_full_url: publicUrl(req, c.logo_url) });
});

router.put('/config', async (req, res) => {
  const b = req.body || {};
  const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
  const logo = b.logo_url ? String(b.logo_url).replace(/^https?:\/\/[^/]+(?=\/uploads\/)/, '') : null;
  await run(`UPDATE clients SET name = COALESCE(?, name), tagline = ?, primary_color = ?, accent_color = ?, logo_url = ?,
      weather_lat = ?, weather_lon = ?, weather_city = ?, news_feed_url = ?, timezone = ? WHERE id = ?`, [
    b.name || null, b.tagline || '', b.primary_color || '#0E4C68', b.accent_color || '#C9A227', logo,
    num(b.weather_lat), num(b.weather_lon), b.weather_city || '', b.news_feed_url || null, b.timezone || 'America/Cuiaba', req.clientId,
  ]);
  await bumpClient(req.clientId);
  res.json({ success: true });
});

router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) throw new HttpError(400, 'Envie uma imagem ou vídeo.');
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
  const type = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
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
  removeFile(m.filename);
  await run('DELETE FROM midia WHERE id = ?', [m.id]);
  await run(`DELETE FROM playlist_items WHERE kind = 'media' AND ref_id = ? AND playlist_id IN (SELECT id FROM playlists WHERE client_id = ?)`, [String(m.id), req.clientId]);
  await run(`UPDATE playlist_items SET portrait_ref_id = NULL WHERE portrait_ref_id = ? AND playlist_id IN (SELECT id FROM playlists WHERE client_id = ?)`, [String(m.id), req.clientId]);
  await bumpClient(req.clientId);
  res.json({ success: true });
});

// ---------- slides ----------
router.get('/slides', async (req, res) => {
  res.json(await all('SELECT * FROM slides WHERE client_id = ? ORDER BY position, id', [req.clientId]));
});

router.post('/slides', async (req, res) => {
  const b = req.body || {};
  const id = 's_' + Date.now() + Math.round(Math.random() * 1000);
  await run(`INSERT INTO slides (id, type, variant, widget, kick, title, text, config_json, duration_ms, position, orientation, client_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [
    id, b.type === 'widget' ? 'widget' : 'slide', b.variant || null, b.widget || null, b.kick || '', b.title || '', b.text || '',
    b.config_json || null, toInt(b.duration_ms, 10000), 99, ORIENT(b.orientation), req.clientId,
  ]);
  await bumpClient(req.clientId);
  res.json({ success: true, id });
});

router.put('/slides/:id', async (req, res) => {
  const b = req.body || {};
  const r = await run(`UPDATE slides SET kick = ?, title = ?, text = ?, config_json = ?, duration_ms = COALESCE(?, duration_ms), orientation = ?
    WHERE id = ? AND client_id = ?`, [b.kick, b.title, b.text, b.config_json, toInt(b.duration_ms), ORIENT(b.orientation), req.params.id, req.clientId]);
  if (!r.changes) throw new HttpError(404, 'Slide não encontrado.');
  await bumpClient(req.clientId);
  res.json({ success: true });
});

router.delete('/slides/:id', async (req, res) => {
  const r = await run('DELETE FROM slides WHERE id = ? AND client_id = ?', [req.params.id, req.clientId]);
  if (!r.changes) throw new HttpError(404, 'Slide não encontrado.');
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
  await run('UPDATE noticias SET texto = ?, enabled = ? WHERE id = ?', [
    String(req.body.texto ?? n.texto).trim() || n.texto, req.body.enabled === undefined ? n.enabled : (req.body.enabled ? 1 : 0), n.id,
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
    cameras: rows.map(c => ({ ...c, stream_url: publicUrl(req, `/api/cameras/${c.id}/stream.mjpg?sig=${cameraSig(c.id)}`) })),
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
  cameraStream.stop(req.params.id);
  await run('UPDATE cameras SET label = ?, url = ?, duration_ms = ? WHERE id = ? AND client_id = ?', [label, url, toInt(duration_ms, 15000), req.params.id, req.clientId]);
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
  cameraStream.stop(req.params.id);
  await run('DELETE FROM cameras WHERE id = ? AND client_id = ?', [req.params.id, req.clientId]);
  await run('UPDATE clients SET pinned_camera_id = NULL WHERE id = ? AND pinned_camera_id = ?', [req.clientId, req.params.id]);
  await run('UPDATE devices SET pinned_camera_id = NULL WHERE client_id = ? AND pinned_camera_id = ?', [req.clientId, req.params.id]);
  await run(`DELETE FROM playlist_items WHERE kind = 'camera' AND ref_id = ? AND playlist_id IN (SELECT id FROM playlists WHERE client_id = ?)`, [req.params.id, req.clientId]);
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
