// Dispositivos (TVs): vínculo por código de ativação, configuração, comandos remotos.
const express = require('express');
const crypto = require('crypto');
const { run, get, all, sha256 } = require('../database');
const { requireAdmin, scopeClientId, signPreview } = require('../lib/auth');
const { HttpError, checkLimit, bumpDevice, toInt, clamp } = require('../lib/common');
const realtime = require('../lib/realtime');

const router = express.Router();

const ORIENTATIONS = ['auto', 'landscape', 'portrait'];
const RESOLUTIONS = ['1280x720', '1920x1080', '2560x1440', '3840x2160', '720x1280', '1080x1920', '1440x2560', '2160x3840'];
const QUEUED_COMMANDS = ['reload', 'sync', 'next', 'play', 'pause', 'clear_cache', 'reboot'];
const CLIENT_COMMANDS = ['reload', 'sync', 'next', 'play', 'pause', 'show_camera', 'hide_camera', 'change_playlist'];

const DEVICE_SELECT = `SELECT d.*, c.name AS client_name, p.name AS playlist_name, cam.label AS pinned_camera_label
  FROM devices d
  LEFT JOIN clients c ON c.id = d.client_id
  LEFT JOIN playlists p ON p.id = d.playlist_id
  LEFT JOIN cameras cam ON cam.id = d.pinned_camera_id`;

function present(d) {
  const { token_hash, pair_token, hardware_id, ...rest } = d;
  return { ...rest, ws_connected: realtime.isConnected(d.id) };
}

async function loadDevice(req, id) {
  const d = await get(`${DEVICE_SELECT} WHERE d.id = ? AND d.status != 'pending'`, [id]);
  if (!d || (req.user.role === 'client' && d.client_id !== req.user.client_id)) throw new HttpError(404, 'TV não encontrada.');
  return d;
}

async function assertPlaylist(playlistId, clientId) {
  if (playlistId == null) return;
  const pl = await get('SELECT id FROM playlists WHERE id = ? AND client_id = ?', [playlistId, clientId]);
  if (!pl) throw new HttpError(400, 'Playlist inválida para este cliente.');
}

router.get('/', async (req, res) => {
  const clientId = scopeClientId(req);
  const rows = clientId
    ? await all(`${DEVICE_SELECT} WHERE d.client_id = ? AND d.status != 'pending' ORDER BY d.name COLLATE NOCASE`, [clientId])
    : await all(`${DEVICE_SELECT} WHERE d.status != 'pending' ORDER BY c.name COLLATE NOCASE, d.name COLLATE NOCASE`);
  res.json(rows.map(present));
});

// TVs que estão exibindo o código de ativação e ainda não foram vinculadas
router.get('/pending', requireAdmin, async (req, res) => {
  const rows = await all("SELECT id, pairing_code, pairing_expires, ip, screen_w, screen_h, app_version, last_seen_at FROM devices WHERE status = 'pending' ORDER BY last_seen_at DESC");
  res.json(rows);
});

router.post('/claim', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const code = String(b.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) throw new HttpError(400, 'Informe o código exibido na TV.');
  const clientId = toInt(b.client_id);
  if (!clientId) throw new HttpError(400, 'Selecione o cliente.');
  const pending = (await all("SELECT * FROM devices WHERE status = 'pending'"))
    .find(d => d.pairing_code && d.pairing_code.replace(/-/g, '') === code);
  if (!pending) throw new HttpError(404, 'Código não encontrado. Confira o código exibido na TV (ele é renovado a cada 30 minutos).');
  if (new Date(pending.pairing_expires) < new Date()) throw new HttpError(410, 'Código expirado. A TV exibirá um novo código em instantes.');
  await checkLimit(clientId, 'tvs');
  const playlistId = toInt(b.playlist_id);
  await assertPlaylist(playlistId, clientId);

  const token = 'dvc_' + crypto.randomBytes(32).toString('hex');
  const orientation = ORIENTATIONS.includes(b.orientation) ? b.orientation : 'auto';
  await run(`UPDATE devices SET client_id = ?, name = ?, location = ?, orientation = ?, resolution = ?, playlist_id = ?,
      status = 'active', token_hash = ?, pair_token = ?, pairing_code = NULL, pairing_expires = NULL WHERE id = ?`, [
    clientId, b.name || 'Nova TV', b.location || null, orientation,
    RESOLUTIONS.includes(b.resolution) ? b.resolution : (orientation === 'portrait' ? '1080x1920' : '1920x1080'),
    playlistId, sha256(token), token, pending.id,
  ]);
  res.json({ id: pending.id });
});

router.get('/:id', async (req, res) => {
  const d = await loadDevice(req, req.params.id);
  const commands = await all('SELECT id, command, payload, issued_at, delivered_at, acked_at FROM device_commands WHERE device_id = ? ORDER BY id DESC LIMIT 15', [d.id]);
  const plays = await all('SELECT item_label, started_at, duration_ms, completed FROM playback_events WHERE device_id = ? ORDER BY id DESC LIMIT 20', [d.id]);
  res.json({ ...present(d), commands, plays });
});

router.put('/:id', async (req, res) => {
  const d = await loadDevice(req, req.params.id);
  const b = req.body || {};
  let clientId = d.client_id;
  if (req.user.role === 'admin' && b.client_id && toInt(b.client_id) !== d.client_id) {
    clientId = toInt(b.client_id);
    await checkLimit(clientId, 'tvs');
  }
  const playlistId = b.playlist_id === '' || b.playlist_id == null ? null : toInt(b.playlist_id);
  await assertPlaylist(playlistId, clientId);
  await run(`UPDATE devices SET client_id = ?, name = ?, location = ?, orientation = ?, resolution = ?, playlist_id = ?, volume = ?, brightness = ?
    WHERE id = ?`, [
    clientId, b.name || d.name, b.location ?? d.location,
    ORIENTATIONS.includes(b.orientation) ? b.orientation : d.orientation,
    RESOLUTIONS.includes(b.resolution) ? b.resolution : d.resolution,
    playlistId, clamp(toInt(b.volume, d.volume), 0, 100), clamp(toInt(b.brightness, d.brightness), 10, 100), d.id,
  ]);
  if (clientId !== d.client_id) await run('UPDATE devices SET pinned_camera_id = NULL, override_playlist_id = NULL WHERE id = ?', [d.id]);
  await bumpDevice(d.id);
  res.json({ success: true });
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const d = await loadDevice(req, req.params.id);
  await run('DELETE FROM devices WHERE id = ?', [d.id]);
  // o token deixa de existir: a TV recebe 401 e volta para a tela de ativação
  realtime.sendToDevice(d.id, { type: 'manifest.updated' });
  res.json({ success: true });
});

router.post('/:id/block', requireAdmin, async (req, res) => {
  const d = await loadDevice(req, req.params.id);
  await run("UPDATE devices SET status = 'blocked' WHERE id = ?", [d.id]);
  await bumpDevice(d.id);
  res.json({ success: true });
});

router.post('/:id/unblock', requireAdmin, async (req, res) => {
  const d = await loadDevice(req, req.params.id);
  await run("UPDATE devices SET status = 'active' WHERE id = ?", [d.id]);
  await bumpDevice(d.id);
  res.json({ success: true });
});

router.get('/:id/preview-token', async (req, res) => {
  const d = await loadDevice(req, req.params.id);
  res.json({ token: 'pv_' + signPreview(d.id) });
});

router.post('/:id/command', async (req, res) => {
  const d = await loadDevice(req, req.params.id);
  const { command, payload = {} } = req.body || {};
  if (req.user.role === 'client' && !CLIENT_COMMANDS.includes(command)) throw new HttpError(403, 'Comando não permitido.');

  // Comandos que mudam o estado persistente da TV viram configuração (sobrevivem
  // a um reinício do player) e chegam via manifesto.
  if (command === 'show_camera' || command === 'hide_camera') {
    let camId = null;
    if (command === 'show_camera') {
      camId = toInt(payload.camera_id);
      if (!(await get('SELECT id FROM cameras WHERE id = ? AND client_id = ?', [camId, d.client_id]))) throw new HttpError(400, 'Câmera inválida.');
    }
    await run('UPDATE devices SET pinned_camera_id = ? WHERE id = ?', [camId, d.id]);
    await bumpDevice(d.id);
    return res.json({ delivered: realtime.isConnected(d.id) });
  }
  if (command === 'change_playlist') {
    const pid = toInt(payload.playlist_id);
    await assertPlaylist(pid, d.client_id);
    await run('UPDATE devices SET playlist_id = ? WHERE id = ?', [pid, d.id]);
    await bumpDevice(d.id);
    return res.json({ delivered: realtime.isConnected(d.id) });
  }
  if (!QUEUED_COMMANDS.includes(command)) throw new HttpError(400, 'Comando desconhecido.');

  const r = await run('INSERT INTO device_commands (device_id, command, payload, issued_by) VALUES (?, ?, ?, ?)', [d.id, command, JSON.stringify(payload), req.user.id]);
  const delivered = realtime.sendToDevice(d.id, { type: 'command', id: String(r.lastID), command, payload });
  if (delivered) await run("UPDATE device_commands SET delivered_at = datetime('now') WHERE id = ?", [r.lastID]);
  res.json({ delivered });
});

module.exports = router;
