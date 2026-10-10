// Manifesto: o JSON auto-contido que cada TV recebe (ver signage-contrato-api.md §4).
const { get, all } = require('../database');
const { publicUrl, clientPlan } = require('./common');
const { signCameraLink } = require('./auth');
const finance = require('./finance');

// Nome exibido no painel ("Exibindo agora"); mídias antigas não têm título
// nem nome original, e o nome do arquivo gerado no upload não diz nada.
const mediaLabel = (m) => m.title || m.original_name || `${m.type === 'video' ? 'Vídeo' : 'Imagem'} #${m.id}`;

const LAYOUTS = {
  landscape: [
    { id: 'main', x: 0, y: 0, w: 73, h: 88, role: 'playlist' },
    { id: 'side', x: 73, y: 0, w: 27, h: 88, role: 'widgets' },
    { id: 'ticker', x: 0, y: 88, w: 100, h: 6, role: 'ticker' },
    { id: 'finance', x: 0, y: 94, w: 100, h: 6, role: 'finance' },
  ],
  portrait: [
    { id: 'main', x: 0, y: 0, w: 100, h: 70, role: 'playlist' },
    { id: 'side', x: 0, y: 70, w: 100, h: 16, role: 'widgets' },
    { id: 'ticker', x: 0, y: 86, w: 100, h: 7, role: 'ticker' },
    { id: 'finance', x: 0, y: 93, w: 100, h: 7, role: 'finance' },
  ],
};

// "YYYY-MM-DDTHH:MM" no fuso do cliente — mesmo formato das datas de campanha.
function localStamp(date, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function cameraItem(req, cam, id, duration) {
  const { sig, exp } = signCameraLink(cam.id);
  return {
    id, type: 'camera', duration_ms: duration, label: cam.label,
    config: { label: cam.label, url: publicUrl(req, `/api/cameras/${cam.id}/stream.mjpg?sig=${sig}&exp=${exp}`) },
  };
}

function slideItem(req, s, id, duration) {
  const bg = s.bg_url ? publicUrl(req, s.bg_url) : null;
  if (s.type === 'widget') {
    let config = {};
    try { config = JSON.parse(s.config_json || '{}'); } catch { /* JSON inválido: widget vazio */ }
    if (bg) config.bg = bg;
    return { id, type: 'widget', widget: s.widget, duration_ms: duration, config, label: config.title || 'QR Code', orientation: s.orientation };
  }
  return {
    id, type: 'slide', duration_ms: duration, orientation: s.orientation, label: s.title?.replace(/<[^>]+>/g, ' ') || s.variant,
    slide: { variant: s.variant, kick: s.kick, title: s.title, text: s.text, bg },
  };
}

// Cache curto dos playlists já expandidos, por (cliente, content_revision).
// notifyManifest() avisa de uma vez todas as TVs de um cliente após qualquer
// edição de conteúdo; sem isso, cada uma recalculava do zero (reconsultando
// midia/slides/cameras) mesmo pedindo exatamente o mesmo manifesto. A chave
// inclui a revisão, então ela nunca fica velha: ao mudar, as entradas da
// revisão anterior deste cliente são descartadas (abaixo) e uma nova entrada
// é calculada na próxima chamada.
const playlistCache = new Map();  // `${clientId}:${rev}:${pl.id}` -> Promise<{id,name,items}>
const playlistCacheRev = new Map(); // clientId -> última content_revision vista

async function expandPlaylist(req, clientId, pl, notices, contentRevision) {
  if (playlistCacheRev.get(clientId) !== contentRevision) {
    for (const key of playlistCache.keys()) if (key.startsWith(`${clientId}:`)) playlistCache.delete(key);
    playlistCacheRev.set(clientId, contentRevision);
  }
  const key = `${clientId}:${contentRevision}:${pl.id}`;
  let promise = playlistCache.get(key);
  if (!promise) {
    promise = expandPlaylistUncached(req, clientId, pl, notices);
    playlistCache.set(key, promise);
    promise.catch(() => playlistCache.delete(key)); // não guarda falha em cache
  }
  return promise;
}

async function expandPlaylistUncached(req, clientId, pl, notices) {
  const rows = await all('SELECT * FROM playlist_items WHERE playlist_id = ? AND enabled = 1 ORDER BY position, id', [pl.id]);
  const media = new Map((await all('SELECT * FROM midia WHERE client_id = ?', [clientId])).map(m => [String(m.id), m]));
  const slides = new Map((await all('SELECT * FROM slides WHERE client_id = ?', [clientId])).map(s => [String(s.id), s]));
  const cams = new Map((await all('SELECT * FROM cameras WHERE client_id = ?', [clientId])).map(c => [String(c.id), c]));

  const base = [];
  for (const r of rows) {
    const id = 'pi' + r.id;
    let item = null;
    if (r.kind === 'media') {
      const m = media.get(String(r.ref_id));
      if (!m) continue;
      item = { id, type: m.type, asset_id: 'm' + m.id, url: publicUrl(req, m.url), duration_ms: r.duration_ms, orientation: m.orientation, label: mediaLabel(m) };
      const alt = r.portrait_ref_id && media.get(String(r.portrait_ref_id));
      if (alt) { item.portrait_url = publicUrl(req, alt.url); item.portrait_type = alt.type; item.orientation = 'any'; }
    } else if (r.kind === 'slide') {
      const s = slides.get(String(r.ref_id));
      if (!s) continue;
      item = slideItem(req, s, id, r.duration_ms);
    } else if (r.kind === 'camera') {
      const c = cams.get(String(r.ref_id));
      if (!c || !c.enabled) continue;
      item = cameraItem(req, c, id, r.duration_ms);
    } else if (r.kind === 'news') {
      if (!notices.length) continue;
      item = { id, type: 'news', duration_ms: r.duration_ms, label: 'Notícias', config: { title: 'Notícias', items: notices.slice(0, 6) } };
    }
    if (!item) continue;
    if (r.start_date || r.end_date) item.window = { from: r.start_date || undefined, to: r.end_date || undefined };
    if (r.start_time || r.end_time) item.hours = { from: r.start_time || '00:00', to: r.end_time || '23:59' };
    item.repeat = Math.max(1, r.repeat || 1);
    base.push(item);
  }

  // "repetir N vezes por ciclo": as cópias são intercaladas com o resto do
  // conteúdo (rodada 1 tem todos, rodada 2 só os que repetem ≥2, ...).
  const rounds = Math.max(1, ...base.map(i => i.repeat));
  const items = [];
  for (let r = 0; r < rounds; r++) {
    for (const it of base) if (it.repeat > r) items.push(r === 0 ? it : { ...it, id: `${it.id}_${r}` });
  }
  return { id: 'pl-' + pl.id, name: pl.name, items };
}

// Playlist automática para clientes sem nenhuma playlist montada.
async function autoPlaylist(req, clientId) {
  const items = [];
  for (const m of await all('SELECT * FROM midia WHERE client_id = ? ORDER BY position, id', [clientId])) {
    items.push({ id: 'm' + m.id, type: m.type, asset_id: 'm' + m.id, url: publicUrl(req, m.url), duration_ms: m.duration_ms, orientation: m.orientation, label: mediaLabel(m) });
  }
  for (const s of await all('SELECT * FROM slides WHERE client_id = ? ORDER BY position', [clientId])) items.push(slideItem(req, s, 's' + s.id, s.duration_ms));
  return { id: 'pl-auto', name: 'Conteúdo do cliente', items };
}

async function buildManifest(req, device) {
  const client = await clientPlan(device.client_id);
  const tz = client.timezone || 'America/Cuiaba';
  const notices = (await all('SELECT texto FROM noticias WHERE client_id = ? AND enabled = 1 ORDER BY id DESC', [client.id])).map(n => n.texto);
  const playlists = [];
  const schedule = [];
  const added = new Set();

  async function addPlaylist(id) {
    if (added.has(id)) return 'pl-' + id;
    const pl = await get('SELECT * FROM playlists WHERE id = ? AND client_id = ?', [id, client.id]);
    if (!pl) return null;
    playlists.push(await expandPlaylist(req, client.id, pl, notices, client.content_revision));
    added.add(id);
    return 'pl-' + id;
  }

  // 1) playlist base da TV (ou a padrão do cliente)
  const baseId = device.playlist_id || (await get('SELECT id FROM playlists WHERE client_id = ? ORDER BY is_default DESC, id LIMIT 1', [client.id]))?.id;
  const basePl = baseId ? await addPlaylist(baseId) : null;
  if (basePl) schedule.push({ playlist_id: basePl, priority: 0, days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59' });
  else {
    playlists.push(await autoPlaylist(req, client.id));
    schedule.push({ playlist_id: 'pl-auto', priority: 0, days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59' });
  }

  // 2) campanhas agendadas que ainda não terminaram
  const nowLocal = localStamp(new Date(), tz);
  const campaigns = await all(`SELECT c.* FROM campaigns c
    WHERE c.client_id = ? AND c.enabled = 1 AND c.end_at >= ?
      AND (c.all_devices = 1 OR EXISTS (SELECT 1 FROM campaign_devices cd WHERE cd.campaign_id = c.id AND cd.device_id = ?))`,
  [client.id, nowLocal, device.id]);
  for (const c of campaigns) {
    const pid = await addPlaylist(c.playlist_id);
    if (!pid) continue;
    let days = [0, 1, 2, 3, 4, 5, 6];
    try { days = JSON.parse(c.days); } catch { /* mantém todos os dias */ }
    schedule.push({ playlist_id: pid, priority: 10 + (c.priority || 0), days, from: c.daily_from, to: c.daily_to, dates: { from: c.start_at, to: c.end_at }, campaign: c.name });
  }

  // 3) "Exibir agora" temporário nesta TV
  if (device.override_playlist_id && device.override_until && device.override_until > new Date().toISOString()) {
    const pid = await addPlaylist(device.override_playlist_id);
    if (pid) schedule.push({ playlist_id: pid, priority: 1000, days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59', dates: { from: nowLocal, to: localStamp(new Date(device.override_until), tz) } });
  }

  // 4) câmera fixada (na TV ou em todas as TVs do cliente) vence tudo
  const pinnedId = device.pinned_camera_id || client.pinned_camera_id;
  const pinned = pinnedId && await get('SELECT * FROM cameras WHERE id = ? AND client_id = ? AND enabled = 1', [pinnedId, client.id]);
  if (pinned) {
    const id = 'pl-camera-pin-' + pinned.id;
    playlists.push({ id, name: 'Câmera fixada: ' + pinned.label, items: [cameraItem(req, pinned, 'cam_' + pinned.id, 24 * 3600 * 1000)] });
    schedule.push({ playlist_id: id, priority: 5000, days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59' });
  }

  const effective = device.orientation === 'auto' ? (device.reported_orientation || 'landscape') : device.orientation;
  const precache = [];
  const seen = new Set();
  for (const pl of playlists) for (const it of pl.items) for (const url of [it.url, it.portrait_url]) {
    if (url && (it.type === 'image' || it.type === 'video') && !seen.has(url)) { seen.add(url); precache.push({ url }); }
  }

  return {
    revision: manifestRevision(client, device),
    generated_at: new Date().toISOString(),
    device: {
      id: String(device.id), name: device.name || 'TV', group: device.location || '', orientation: device.orientation,
      resolution: device.resolution, volume: device.volume, brightness: device.brightness, timezone: tz,
    },
    branding: {
      name: client.name, tagline: client.tagline, primary: client.primary_color, accent: client.accent_color,
      logo_url: publicUrl(req, client.logo_url),
    },
    layout: { id: 'layout-' + effective, zones: LAYOUTS[effective] || LAYOUTS.landscape },
    layouts: LAYOUTS,
    playlists,
    schedule,
    widgets: {
      clock: { enabled: true },
      weather: { enabled: client.weather_lat != null, lat: client.weather_lat ?? -20.42, lon: client.weather_lon ?? -51.34, city: client.weather_city || '' },
      ticker: { enabled: true, speed: 55, notices: notices.length ? notices : ['Sem notícias no momento.'] },
      notices: { enabled: false },
      finance: { enabled: true, speed: 45, quotes: finance.getQuotes() },
      news_feed: { enabled: !!client.news_feed_url },
    },
    precache,
    policy: { heartbeat_s: 20, manifest_poll_s: 60, reboot_daily_at: '04:30' },
  };
}

function manifestRevision(client, device) {
  // String composta (não soma numérica): inclui o client_id para que, se uma
  // TV for realocada para outro cliente, a revisão SEMPRE mude — com soma,
  // content_revision + config_revision podia coincidentemente dar um valor
  // igual ou menor ao anterior e gerar um 304 indevido (TV ficava mostrando
  // conteúdo do cliente errado). A cotação financeira (lib/finance.js) foi
  // removida de propósito: ela muda a cada ~10 min pra todos os clientes e
  // forçava toda TV a reconstruir o manifesto inteiro só por isso; agora as
  // cotações são entregues por fora (ver GET /api/reports/quotes), sem afetar
  // esta revisão. Comparação deve ser sempre por igualdade de string/valor,
  // nunca numérica.
  return `${client.id}:${client.content_revision}:${device.config_revision}`;
}

module.exports = { buildManifest, manifestRevision, LAYOUTS, localStamp };
