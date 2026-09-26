// Presença das TVs: online/offline a partir do heartbeat (e do WebSocket),
// e amostras periódicas para o gráfico de "TVs online nas últimas 24h".
const { run, get, all } = require('../database');
const realtime = require('./realtime');

const OFFLINE_AFTER_S = 70;   // ~3 heartbeats de 20s perdidos
const SAMPLE_EVERY_MS = 5 * 60 * 1000;

const nowIso = () => new Date().toISOString();

async function markSeen(deviceId, info = {}) {
  const d = await get('SELECT id, client_id, name, online FROM devices WHERE id = ?', [deviceId]);
  if (!d) return;
  const now = nowIso();
  const fields = ['last_seen_at = ?', 'online = 1'];
  const params = [now];
  const set = (col, val) => { if (val !== undefined && val !== null) { fields.push(`${col} = ?`); params.push(val); } };
  set('ip', info.ip);
  set('app_version', info.app_version);
  set('last_revision', info.revision != null ? String(info.revision) : undefined);
  set('uptime_s', Number.isFinite(info.uptime_s) ? Math.round(info.uptime_s) : undefined);
  set('current_item', info.current_item);
  set('current_playlist', info.current_playlist);
  set('reported_orientation', info.orientation);
  if (info.screen) { set('screen_w', info.screen.w | 0); set('screen_h', info.screen.h | 0); }
  if (!d.online) { fields.push('online_since = ?', 'offline_since = NULL'); params.push(now); }
  params.push(deviceId);
  await run(`UPDATE devices SET ${fields.join(', ')} WHERE id = ?`, params);
  if (!d.online) realtime.broadcastPanel({ type: 'device.online', device_id: d.id, name: d.name }, d.client_id);
}

async function sweep() {
  const limit = new Date(Date.now() - OFFLINE_AFTER_S * 1000).toISOString();
  const stale = await all('SELECT id, client_id, name FROM devices WHERE online = 1 AND (last_seen_at IS NULL OR last_seen_at < ?)', [limit]);
  for (const d of stale) {
    // conexão WS aberta conta como viva mesmo sem heartbeat recente
    if (realtime.isConnected(d.id)) { await run('UPDATE devices SET last_seen_at = ? WHERE id = ?', [nowIso(), d.id]); continue; }
    await run('UPDATE devices SET online = 0, offline_since = ? WHERE id = ?', [nowIso(), d.id]);
    realtime.broadcastPanel({ type: 'device.offline', device_id: d.id, name: d.name }, d.client_id);
  }
  // códigos de pareamento abandonados (TV desligada antes de ser vinculada)
  await run("DELETE FROM devices WHERE status = 'pending' AND (last_seen_at IS NULL OR last_seen_at < ?)", [new Date(Date.now() - 86400000).toISOString()]);
}

async function sample() {
  const ts = nowIso();
  const rows = await all(`SELECT client_id, sum(online) AS online, count(*) AS total
    FROM devices WHERE status = 'active' AND client_id IS NOT NULL GROUP BY client_id`);
  for (const r of rows) await run('INSERT INTO online_samples (ts, client_id, online, total) VALUES (?, ?, ?, ?)', [ts, r.client_id, r.online, r.total]);
  await run("DELETE FROM online_samples WHERE ts < ?", [new Date(Date.now() - 8 * 86400000).toISOString()]);
}

function start() {
  realtime.setPresenceHandler(markSeen);
  setInterval(() => sweep().catch(e => console.error('[presença]', e.message)), 15000);
  sample().catch(() => {});
  setInterval(() => sample().catch(e => console.error('[amostras]', e.message)), SAMPLE_EVERY_MS);
}

module.exports = { markSeen, start, OFFLINE_AFTER_S };
