// Presença das TVs: online/offline a partir do heartbeat (e do WebSocket),
// e amostras periódicas para o gráfico de "TVs online nas últimas 24h".
const { run, get, all } = require('../database');
const realtime = require('./realtime');

const OFFLINE_AFTER_S = 70;   // ~3 heartbeats de 20s perdidos
const SAMPLE_EVERY_MS = 5 * 60 * 1000;
const FLUSH_EVERY_MS = 45 * 1000;   // intervalo do flush em lote do heartbeat
const FREE_TEXT_MAX = 500;          // tamanho máx. de campos de texto livre vindos da TV

const nowIso = () => new Date().toISOString();
const cap = (s, max = FREE_TEXT_MAX) => (typeof s === 'string' && s.length > max ? s.slice(0, max) : s);

// Estado em memória por dispositivo: evita bater no banco a cada heartbeat
// (a cada ~20s por TV). Só grava de fato quando o status online/offline muda
// (pra o painel refletir sem demora); o resto (last_seen_at e os demais
// campos informativos) é gravado em lote pelo flush(), a cada FLUSH_EVERY_MS.
// sweep() consulta este mapa também, pra não marcar como offline uma TV que
// só está esperando o próximo flush.
const mem = new Map(); // deviceId -> { clientId, name, online, lastSeenMs, fields, dirty }

// Monta os campos "informativos" do heartbeat, capando texto livre (vindo
// direto da TV, sem limite nenhum antes) pra não deixar um payload mal
// formado ou malicioso escrever uma string sem tamanho no banco.
function buildFields(info) {
  const fields = {};
  const set = (col, val) => { if (val !== undefined && val !== null) fields[col] = val; };
  set('ip', info.ip);
  set('app_version', cap(info.app_version));
  set('last_revision', info.revision != null ? String(info.revision) : undefined);
  set('uptime_s', Number.isFinite(info.uptime_s) ? Math.round(info.uptime_s) : undefined);
  set('current_item', cap(info.current_item));
  set('current_playlist', cap(info.current_playlist));
  set('reported_orientation', info.orientation);
  if (info.screen) { set('screen_w', info.screen.w | 0); set('screen_h', info.screen.h | 0); }
  return fields;
}

function writeDevice(deviceId, fields) {
  const cols = Object.keys(fields);
  if (!cols.length) return Promise.resolve();
  const sql = `UPDATE devices SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`;
  return run(sql, [...cols.map(c => fields[c]), deviceId]);
}

async function markSeen(deviceId, info = {}) {
  let m = mem.get(deviceId);
  if (!m) {
    const d = await get('SELECT id, client_id, name, online FROM devices WHERE id = ?', [deviceId]);
    if (!d) return;
    m = { clientId: d.client_id, name: d.name, online: !!d.online, lastSeenMs: 0, fields: {}, dirty: false };
    mem.set(deviceId, m);
  }
  m.lastSeenMs = Date.now();
  Object.assign(m.fields, buildFields(info));
  m.dirty = true;

  if (!m.online) {
    // virou online: grava já, pra o painel refletir sem esperar o próximo flush
    m.online = true;
    const now = nowIso();
    const fields = { last_seen_at: now, online: 1, online_since: now, offline_since: null, ...m.fields };
    m.fields = {};
    m.dirty = false;
    await writeDevice(deviceId, fields);
    realtime.broadcastPanel({ type: 'device.online', device_id: deviceId, name: m.name }, m.clientId);
  }
}

// Grava em lote (uma TV por vez, sem transação explícita — a conexão é
// compartilhada com o resto do app) quem recebeu heartbeat desde o último
// flush, em vez de uma escrita por heartbeat (~a cada 20s por TV).
async function flush() {
  for (const [deviceId, m] of mem) {
    if (!m.dirty) continue;
    const fields = { last_seen_at: new Date(m.lastSeenMs).toISOString(), ...m.fields };
    m.fields = {};
    m.dirty = false;
    await writeDevice(deviceId, fields);
  }
}

async function sweep() {
  const limitMs = Date.now() - OFFLINE_AFTER_S * 1000;
  // heartbeat recente em memória ainda não gravado no banco não pode ser
  // tratado como "parado" só porque o last_seen_at do banco está atrasado
  // até o próximo flush()
  const recentlyLive = new Set([...mem].filter(([, m]) => m.online && m.lastSeenMs >= limitMs).map(([id]) => id));

  const limit = new Date(limitMs).toISOString();
  const stale = await all('SELECT id, client_id, name FROM devices WHERE online = 1 AND (last_seen_at IS NULL OR last_seen_at < ?)', [limit]);
  for (const d of stale) {
    if (recentlyLive.has(d.id)) continue;
    // conexão WS aberta conta como viva mesmo sem heartbeat recente
    if (realtime.isConnected(d.id)) {
      const now = nowIso();
      await run('UPDATE devices SET last_seen_at = ? WHERE id = ?', [now, d.id]);
      const m = mem.get(d.id);
      if (m) { m.lastSeenMs = Date.now(); m.dirty = false; }
      continue;
    }
    await run('UPDATE devices SET online = 0, offline_since = ? WHERE id = ?', [nowIso(), d.id]);
    const m = mem.get(d.id);
    if (m) { m.online = false; m.fields = {}; m.dirty = false; }
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
  setInterval(() => flush().catch(e => console.error('[presença:flush]', e.message)), FLUSH_EVERY_MS);
  sample().catch(() => {});
  setInterval(() => sample().catch(e => console.error('[amostras]', e.message)), SAMPLE_EVERY_MS);
}

module.exports = { markSeen, start, OFFLINE_AFTER_S };
