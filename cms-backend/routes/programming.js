// Programação: playlists (ordem, duração, janelas) e campanhas agendadas.
const express = require('express');
const { run, get, all } = require('../database');
const { requireAuth, requireClientScope } = require('../lib/auth');
const { HttpError, checkLimit, requireFeature, bumpClient, bumpDevice, toInt, clamp, publicUrl } = require('../lib/common');
const { localStamp } = require('../lib/manifest');

const router = express.Router();
// restrito aos próprios caminhos: este router é montado em /api junto com outros
router.use(['/playlists', '/campaigns'], requireAuth, requireClientScope);

const KINDS = ['media', 'slide', 'camera', 'news'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const STAMP_RE = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;

async function loadPlaylist(req, id) {
  const pl = await get('SELECT * FROM playlists WHERE id = ? AND client_id = ?', [id, req.clientId]);
  if (!pl) throw new HttpError(404, 'Playlist não encontrada.');
  return pl;
}

// ---------- playlists ----------
router.get('/playlists', async (req, res) => {
  const rows = await all(`SELECT p.*,
      (SELECT count(*) FROM playlist_items i WHERE i.playlist_id = p.id) AS items,
      (SELECT coalesce(sum(i.duration_ms * i.repeat), 0) FROM playlist_items i WHERE i.playlist_id = p.id AND i.enabled = 1) AS total_ms,
      (SELECT count(*) FROM devices d WHERE d.playlist_id = p.id) AS devices,
      (SELECT count(*) FROM campaigns c WHERE c.playlist_id = p.id) AS campaigns
    FROM playlists p WHERE p.client_id = ? ORDER BY p.is_default DESC, p.name COLLATE NOCASE`, [req.clientId]);
  res.json(rows);
});

router.post('/playlists', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) throw new HttpError(400, 'Dê um nome à playlist.');
  await checkLimit(req.clientId, 'playlists');
  // valida o copy_from ANTES de criar a playlist, para não deixar uma playlist
  // vazia órfã quando a origem não existir
  let src = null;
  if (req.body.copy_from) src = await loadPlaylist(req, req.body.copy_from);
  const hasAny = await get('SELECT id FROM playlists WHERE client_id = ?', [req.clientId]);
  const r = await run('INSERT INTO playlists (client_id, name, is_default) VALUES (?, ?, ?)', [req.clientId, name, hasAny ? 0 : 1]);
  if (src) {
    await run(`INSERT INTO playlist_items (playlist_id, kind, ref_id, portrait_ref_id, duration_ms, position, enabled, repeat, start_date, end_date, start_time, end_time)
      SELECT ?, kind, ref_id, portrait_ref_id, duration_ms, position, enabled, repeat, start_date, end_date, start_time, end_time FROM playlist_items WHERE playlist_id = ?`, [r.lastID, src.id]);
  }
  res.json({ id: r.lastID });
});

// Catálogo do que pode entrar numa playlist (usado pelo editor).
router.get('/playlists/library', async (req, res) => {
  const media = await all('SELECT id, type, title, original_name, url, duration_ms, orientation FROM midia WHERE client_id = ? ORDER BY id DESC', [req.clientId]);
  const slides = await all('SELECT id, type, variant, widget, kick, title, config_json, duration_ms, orientation FROM slides WHERE client_id = ? ORDER BY position, id', [req.clientId]);
  const cameras = await all('SELECT id, label, duration_ms, enabled FROM cameras WHERE client_id = ? ORDER BY position, id', [req.clientId]);
  res.json({ media: media.map(m => ({ ...m, full_url: publicUrl(req, m.url) })), slides, cameras });
});

router.get('/playlists/:id', async (req, res) => {
  const pl = await loadPlaylist(req, req.params.id);
  const items = await all('SELECT * FROM playlist_items WHERE playlist_id = ? ORDER BY position, id', [pl.id]);
  res.json({ ...pl, items });
});

router.put('/playlists/:id', async (req, res) => {
  const pl = await loadPlaylist(req, req.params.id);
  const name = String(req.body?.name || pl.name).trim();
  await run("UPDATE playlists SET name = ?, updated_at = datetime('now') WHERE id = ?", [name, pl.id]);
  if (req.body.is_default) {
    await run('UPDATE playlists SET is_default = 0 WHERE client_id = ?', [req.clientId]);
    await run('UPDATE playlists SET is_default = 1 WHERE id = ?', [pl.id]);
  }
  await bumpClient(req.clientId);
  res.json({ success: true });
});

// Substitui a lista inteira de itens (o editor de arrastar-e-soltar salva tudo de uma vez).
router.put('/playlists/:id/items', async (req, res) => {
  const pl = await loadPlaylist(req, req.params.id);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const own = {
    media: new Set((await all('SELECT id FROM midia WHERE client_id = ?', [req.clientId])).map(r => String(r.id))),
    slide: new Set((await all('SELECT id FROM slides WHERE client_id = ?', [req.clientId])).map(r => String(r.id))),
    camera: new Set((await all('SELECT id FROM cameras WHERE client_id = ?', [req.clientId])).map(r => String(r.id))),
  };
  const clean = items.map((it, i) => {
    if (!KINDS.includes(it.kind)) throw new HttpError(400, `Item ${i + 1}: tipo inválido.`);
    if (it.kind !== 'news' && !own[it.kind].has(String(it.ref_id))) throw new HttpError(400, `Item ${i + 1}: conteúdo não encontrado.`);
    const portrait = it.kind === 'media' && it.portrait_ref_id && own.media.has(String(it.portrait_ref_id)) ? String(it.portrait_ref_id) : null;
    const date = (v) => (v && DATE_RE.test(v) ? v : null);
    const time = (v) => (v && TIME_RE.test(v) ? v : null);
    return [pl.id, it.kind, it.kind === 'news' ? null : String(it.ref_id), portrait, clamp(toInt(it.duration_ms, 10000), 1000, 3600000), i,
      it.enabled === false ? 0 : 1, clamp(toInt(it.repeat, 1), 1, 10), date(it.start_date), date(it.end_date), time(it.start_time), time(it.end_time)];
  });
  // Sem transação explícita: a conexão sqlite é compartilhada com outras
  // requisições concorrentes (heartbeats de TVs, etc.), então um BEGIN/COMMIT
  // cobrindo vários awaits poderia prender escritas de outras requisições.
  // Um único INSERT multi-linha deixa a operação atômica sem precisar disso.
  await run('DELETE FROM playlist_items WHERE playlist_id = ?', [pl.id]);
  if (clean.length) {
    const placeholders = clean.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?)').join(', ');
    await run(`INSERT INTO playlist_items (playlist_id, kind, ref_id, portrait_ref_id, duration_ms, position, enabled, repeat, start_date, end_date, start_time, end_time)
      VALUES ${placeholders}`, clean.flat());
  }
  await run("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?", [pl.id]);
  await bumpClient(req.clientId);
  res.json({ success: true });
});

router.delete('/playlists/:id', async (req, res) => {
  const pl = await loadPlaylist(req, req.params.id);
  const { n } = await get('SELECT count(*) AS n FROM playlists WHERE client_id = ?', [req.clientId]);
  if (n <= 1) throw new HttpError(400, 'O cliente precisa ter pelo menos uma playlist.');
  await run('DELETE FROM playlists WHERE id = ?', [pl.id]);
  await run('UPDATE devices SET override_playlist_id = NULL WHERE override_playlist_id = ?', [pl.id]);
  if (pl.is_default) {
    await run('UPDATE playlists SET is_default = 1 WHERE id = (SELECT id FROM playlists WHERE client_id = ? ORDER BY id LIMIT 1)', [req.clientId]);
  }
  await bumpClient(req.clientId);
  res.json({ success: true });
});

async function targetDevices(req, ids) {
  const all_ = await all("SELECT id FROM devices WHERE client_id = ? AND status = 'active'", [req.clientId]);
  if (!Array.isArray(ids) || !ids.length) return all_.map(d => d.id);
  const allowed = new Set(all_.map(d => d.id));
  return ids.map(Number).filter(id => allowed.has(id));
}

// "Exibir agora": a playlist toma a tela das TVs escolhidas por N minutos e
// depois a programação normal volta sozinha.
router.post('/playlists/:id/play-now', async (req, res) => {
  const pl = await loadPlaylist(req, req.params.id);
  const minutes = clamp(toInt(req.body?.minutes, 30), 1, 24 * 60);
  const until = new Date(Date.now() + minutes * 60000).toISOString();
  const ids = await targetDevices(req, req.body?.device_ids);
  for (const id of ids) {
    await run('UPDATE devices SET override_playlist_id = ?, override_until = ? WHERE id = ?', [pl.id, until, id]);
    await bumpDevice(id);
  }
  res.json({ devices: ids.length, until });
});

router.post('/playlists/stop-now', async (req, res) => {
  const ids = await targetDevices(req, req.body?.device_ids);
  for (const id of ids) {
    await run('UPDATE devices SET override_playlist_id = NULL, override_until = NULL WHERE id = ?', [id]);
    await bumpDevice(id);
  }
  res.json({ devices: ids.length });
});

// ---------- campanhas ----------
const campaigns = express.Router();
campaigns.use(async (req, res, next) => { await requireFeature(req, 'scheduling', 'Agendamento de campanhas'); next(); });

function campaignStatus(c, nowLocal) {
  if (!c.enabled) return 'pausada';
  if (c.end_at < nowLocal) return 'encerrada';
  if (c.start_at > nowLocal) return 'agendada';
  return 'ativa';
}

campaigns.get('/', async (req, res) => {
  const tz = (await get('SELECT timezone FROM clients WHERE id = ?', [req.clientId]))?.timezone || 'America/Cuiaba';
  const nowLocal = localStamp(new Date(), tz);
  const rows = await all(`SELECT c.*, p.name AS playlist_name FROM campaigns c JOIN playlists p ON p.id = c.playlist_id
    WHERE c.client_id = ? ORDER BY c.start_at DESC`, [req.clientId]);
  const links = await all('SELECT cd.* FROM campaign_devices cd JOIN campaigns c ON c.id = cd.campaign_id WHERE c.client_id = ?', [req.clientId]);
  res.json(rows.map(c => ({
    ...c,
    days: JSON.parse(c.days || '[]'),
    device_ids: links.filter(l => l.campaign_id === c.id).map(l => l.device_id),
    status: campaignStatus(c, nowLocal),
  })));
});

async function saveCampaign(req, id) {
  const b = req.body || {};
  if (!String(b.name || '').trim()) throw new HttpError(400, 'Dê um nome à campanha.');
  await loadPlaylist(req, b.playlist_id);
  if (!STAMP_RE.test(b.start_at || '') || !STAMP_RE.test(b.end_at || '')) throw new HttpError(400, 'Informe início e fim da campanha.');
  if (b.end_at <= b.start_at) throw new HttpError(400, 'O fim da campanha precisa ser depois do início.');
  const days = (Array.isArray(b.days) ? b.days : []).map(Number).filter(d => d >= 0 && d <= 6);
  if (!days.length) throw new HttpError(400, 'Selecione pelo menos um dia da semana.');
  const from = TIME_RE.test(b.daily_from || '') ? b.daily_from : '00:00';
  const to = TIME_RE.test(b.daily_to || '') ? b.daily_to : '23:59';
  const deviceIds = b.all_devices ? [] : await targetDevices(req, b.device_ids);
  if (!b.all_devices && !deviceIds.length) throw new HttpError(400, 'Selecione as TVs da campanha.');
  const params = [b.name.trim(), b.playlist_id, b.start_at, b.end_at, JSON.stringify([...new Set(days)].sort()), from, to,
    clamp(toInt(b.priority, 10), 0, 100), b.all_devices ? 1 : 0, b.enabled === false ? 0 : 1];
  if (id) {
    const r = await run(`UPDATE campaigns SET name=?, playlist_id=?, start_at=?, end_at=?, days=?, daily_from=?, daily_to=?, priority=?, all_devices=?, enabled=?
      WHERE id = ? AND client_id = ?`, [...params, id, req.clientId]);
    if (!r.changes) throw new HttpError(404, 'Campanha não encontrada.');
  } else {
    id = (await run(`INSERT INTO campaigns (name, playlist_id, start_at, end_at, days, daily_from, daily_to, priority, all_devices, enabled, client_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [...params, req.clientId])).lastID;
  }
  await run('DELETE FROM campaign_devices WHERE campaign_id = ?', [id]);
  for (const d of deviceIds) await run('INSERT INTO campaign_devices (campaign_id, device_id) VALUES (?, ?)', [id, d]);
  await bumpClient(req.clientId);
  return id;
}

campaigns.post('/', async (req, res) => res.json({ id: await saveCampaign(req, null) }));
campaigns.put('/:id', async (req, res) => res.json({ id: await saveCampaign(req, Number(req.params.id)) }));
campaigns.delete('/:id', async (req, res) => {
  await run('DELETE FROM campaigns WHERE id = ? AND client_id = ?', [req.params.id, req.clientId]);
  await bumpClient(req.clientId);
  res.json({ success: true });
});
router.use('/campaigns', campaigns);

module.exports = router;
