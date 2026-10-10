// API do player (TV). Autenticação por token de dispositivo, nunca por usuário.
const express = require('express');
const crypto = require('crypto');
const { run, get, all, sha256 } = require('../database');
const { verifyPreview } = require('../lib/auth');
const { buildManifest, manifestRevision } = require('../lib/manifest');
const { clientPlan } = require('../lib/common');
const presence = require('../lib/presence');
const rateLimit = require('../lib/rate-limit');

const router = express.Router();

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // sem 0/O/1/I
const PAIRING_TTL_MS = 30 * 60 * 1000;

function newPairingCode() {
  const bytes = crypto.randomBytes(8);
  const chars = Array.from(bytes, b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return `TV-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

// Sem proxy reverso confiável na frente deste servidor: X-Forwarded-For pode
// ser forjado pela própria TV para falsificar o IP exibido no painel. req.ip
// (Express) é a fonte confiável aqui.
function clientIp(req) {
  return (req.ip || '').replace(/^::ffff:/, '');
}

// Resolve a TV pelo token. Tokens "pv_<jwt>" são do preview no painel: leem o
// manifesto de uma TV real, mas não registram presença nem eventos.
async function deviceAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || '');
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  let device;
  if (token.startsWith('pv_')) {
    const id = verifyPreview(token.slice(3));
    device = id && await get('SELECT * FROM devices WHERE id = ?', [id]);
    if (device) req.preview = true;
  } else {
    device = await get("SELECT * FROM devices WHERE token_hash = ? AND status != 'pending'", [sha256(token)]);
  }
  if (!device) return res.status(401).json({ error: 'unauthorized' });
  req.device = device;
  if (device.status === 'blocked') return res.status(403).json({ error: 'blocked', message: 'Esta TV foi bloqueada pelo administrador.' });
  const client = await get('SELECT status FROM clients WHERE id = ?', [device.client_id]);
  if (!client || client.status !== 'active') return res.status(403).json({ error: 'suspended', message: 'Serviço suspenso. Entre em contato com o administrador.' });
  next();
}

router.post('/pair', rateLimit({ windowMs: 60000, max: 30 }), async (req, res) => {
  const hw = String(req.body?.hardware_id || '').slice(0, 64);
  if (!hw) return res.status(400).json({ error: 'hardware_id obrigatório' });
  const now = new Date();
  const screen = req.body.screen || {};
  const d = await get('SELECT * FROM devices WHERE hardware_id = ? ORDER BY id DESC LIMIT 1', [hw]);

  if (d && d.pair_token && d.status !== 'pending') {
    await run('UPDATE devices SET pair_token = NULL WHERE id = ?', [d.id]);
    const client = await get('SELECT name, logo_url FROM clients WHERE id = ?', [d.client_id]);
    return res.json({ device_token: d.pair_token, device_id: String(d.id), account: client });
  }

  if (d && d.status === 'pending') {
    let code = d.pairing_code;
    let expires = d.pairing_expires && new Date(d.pairing_expires);
    if (!expires || expires < now) {
      code = newPairingCode();
      expires = new Date(now.getTime() + PAIRING_TTL_MS);
      await run('UPDATE devices SET pairing_code = ?, pairing_expires = ? WHERE id = ?', [code, expires.toISOString(), d.id]);
    }
    await run('UPDATE devices SET last_seen_at = ?, ip = ?, screen_w = ?, screen_h = ?, app_version = ? WHERE id = ?',
      [now.toISOString(), clientIp(req), screen.w | 0, screen.h | 0, req.body.app_version || null, d.id]);
    return res.json({ pairing_code: code, expires_in: Math.round((expires - now) / 1000), poll_after_ms: 5000 });
  }

  const code = newPairingCode();
  await run(`INSERT INTO devices (hardware_id, status, pairing_code, pairing_expires, last_seen_at, ip, screen_w, screen_h, app_version)
    VALUES (?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
  [hw, code, new Date(now.getTime() + PAIRING_TTL_MS).toISOString(), now.toISOString(), clientIp(req), screen.w | 0, screen.h | 0, req.body.app_version || null]);
  res.json({ pairing_code: code, expires_in: PAIRING_TTL_MS / 1000, poll_after_ms: 5000 });
});

router.get('/manifest', deviceAuth, async (req, res) => {
  const client = await clientPlan(req.device.client_id);
  const rev = manifestRevision(client, req.device);
  if (req.query.revision && String(req.query.revision) === String(rev) && !req.preview) return res.status(304).end();
  res.json(await buildManifest(req, req.device));
});

router.post('/heartbeat', deviceAuth, async (req, res) => {
  const d = req.device;
  const client = await clientPlan(d.client_id);
  if (req.preview) return res.json({ revision: manifestRevision(client, d), commands: [] });
  const b = req.body || {};
  await presence.markSeen(d.id, {
    ip: clientIp(req), app_version: b.app_version, revision: b.revision, uptime_s: b.uptime_s,
    current_item: b.current_item_label || b.current_item, current_playlist: b.current_playlist,
    orientation: ['landscape', 'portrait'].includes(b.orientation) ? b.orientation : undefined, screen: b.screen,
  });
  const cmds = await all("SELECT id, command, payload FROM device_commands WHERE device_id = ? AND delivered_at IS NULL AND issued_at > datetime('now', '-1 hour') ORDER BY id", [d.id]);
  if (cmds.length) await run(`UPDATE device_commands SET delivered_at = datetime('now') WHERE id IN (${cmds.map(() => '?').join(',')})`, cmds.map(c => c.id));
  res.json({
    revision: manifestRevision(client, d),
    commands: cmds.map(c => ({ id: String(c.id), command: c.command, payload: c.payload ? JSON.parse(c.payload) : {} })),
  });
});

const EVENTS_INSERT_CHUNK = 100;

router.post('/events', deviceAuth, async (req, res) => {
  if (req.preview) return res.json({ accepted: 0 });
  const events = (Array.isArray(req.body?.events) ? req.body.events.slice(0, 500) : []).filter(e => e && e.started_at);
  // Insere em lotes de uma só instrução multi-linha em vez de um INSERT (um
  // commit com fsync) por evento — até 500 eventos por requisição chegavam a
  // ser 500 commits separados.
  for (let i = 0; i < events.length; i += EVENTS_INSERT_CHUNK) {
    const chunk = events.slice(i, i + EVENTS_INSERT_CHUNK);
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const params = [];
    for (const e of chunk) {
      params.push(
        req.device.id, req.device.client_id, String(e.asset_id || e.item_id || ''), String(e.label || '').slice(0, 200),
        String(e.playlist_id || ''), String(e.started_at), e.duration_ms | 0, e.completed === false ? 0 : 1,
      );
    }
    await run(`INSERT INTO playback_events (device_id, client_id, item_id, item_label, playlist_id, started_at, duration_ms, completed)
      VALUES ${placeholders}`, params);
  }
  res.json({ accepted: events.length });
});

router.post('/commands/:id/ack', deviceAuth, async (req, res) => {
  await run("UPDATE device_commands SET acked_at = datetime('now') WHERE id = ? AND device_id = ?", [req.params.id, req.device.id]);
  res.json({ ok: true });
});

module.exports = { router, deviceAuth };
