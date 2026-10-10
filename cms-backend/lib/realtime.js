// WebSocket: canal das TVs (/ws/device) e canal do painel (/ws/panel).
//
// O socket nunca carrega conteúdo: só avisa a TV que o manifesto mudou ou
// entrega um comando. Se o socket cair, o heartbeat HTTP cobre tudo (com mais
// latência), então nada depende exclusivamente dele.
const { WebSocketServer } = require('ws');
const { get, all, sha256 } = require('../database');
const { userFromToken } = require('./auth');

const deviceSockets = new Map(); // deviceId -> Set<ws>
const panelSockets = new Set();  // ws com ws.user

let onDeviceSeen = async () => {};
function setPresenceHandler(fn) { onDeviceSeen = fn; }

function send(ws, msg) {
  if (ws.readyState === 1) { ws.send(JSON.stringify(msg)); return true; }
  return false;
}

// ---------- defesa contra flood de conexão ----------
// Rejeita o mais barato possível (antes de qualquer consulta ao banco):
// limite de tentativas de upgrade por IP, limite de conexões simultâneas por
// IP (TVs podem compartilhar IP num NAT de escritório, por isso o limite de
// 'device' é bem maior que o de 'panel', que é gente), e uma válvula de
// segurança global contra um botnet distribuído em muitos IPs.
const MAX_CONN_PER_IP = { device: 40, panel: 10 };
const MAX_UPGRADES_PER_IP_PER_MIN = 60;
const MAX_TOTAL_SOCKETS = 2000;

const connCountByIp = new Map(); // ip -> { device, panel }
const upgradeAttempts = new Map(); // ip -> { n, reset }
setInterval(() => {
  const now = Date.now();
  for (const [ip, h] of upgradeAttempts) if (h.reset < now) upgradeAttempts.delete(ip);
}, 60000).unref();

function upgradeIp(req) {
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}
function tooManyUpgrades(ip) {
  const now = Date.now();
  let h = upgradeAttempts.get(ip);
  if (!h || h.reset < now) { h = { n: 0, reset: now + 60000 }; upgradeAttempts.set(ip, h); }
  return ++h.n > MAX_UPGRADES_PER_IP_PER_MIN;
}
function connCount(ip, kind) {
  return connCountByIp.get(ip)?.[kind] || 0;
}
function bumpConn(ip, kind, delta) {
  let h = connCountByIp.get(ip);
  if (!h) { h = { device: 0, panel: 0 }; connCountByIp.set(ip, h); }
  h[kind] = Math.max(0, h[kind] + delta);
  if (h.device === 0 && h.panel === 0) connCountByIp.delete(ip);
}
function totalSockets() {
  let n = panelSockets.size;
  for (const set of deviceSockets.values()) n += set.size;
  return n;
}

function attach(server) {
  // maxPayload: o padrão do "ws" aceita quadros de até ~100MB; o canal nunca
  // transporta conteúdo (só avisos/comandos pequenos), então um limite baixo
  // já cobre o uso real e evita que uma conexão mande um frame enorme.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  server.on('upgrade', async (req, socket, head) => {
    const ip = upgradeIp(req);
    if (totalSockets() >= MAX_TOTAL_SOCKETS) return reject(socket, 503);
    if (tooManyUpgrades(ip)) return reject(socket, 429);
    const url = new URL(req.url, 'http://x');
    const token = url.searchParams.get('token') || '';
    try {
      if (url.pathname === '/ws/device') {
        if (connCount(ip, 'device') >= MAX_CONN_PER_IP.device) return reject(socket, 429);
        const device = await get("SELECT id, client_id, status FROM devices WHERE token_hash = ? AND status != 'pending'", [sha256(token)]);
        if (!device) return reject(socket, 401);
        wss.handleUpgrade(req, socket, head, (ws) => onDevice(ws, device, req, ip));
      } else if (url.pathname === '/ws/panel') {
        if (connCount(ip, 'panel') >= MAX_CONN_PER_IP.panel) return reject(socket, 429);
        const user = await userFromToken(token);
        if (!user) return reject(socket, 401);
        wss.handleUpgrade(req, socket, head, (ws) => onPanel(ws, user, ip));
      } else {
        reject(socket, 404);
      }
    } catch {
      reject(socket, 500);
    }
  });

  // ping periódico: mantém NAT/proxy abertos e detecta conexões mortas
  setInterval(() => {
    for (const set of deviceSockets.values()) {
      for (const ws of set) {
        if (ws.alive === false) { ws.terminate(); continue; }
        ws.alive = false;
        send(ws, { type: 'ping', ts: Date.now() });
      }
    }
    // mesmo esquema de liveness dos sockets de TV: sem isso, conexões do
    // painel administrativo mortas/meio-abertas (aba fechada sem o close
    // chegar, Wi-Fi caindo, etc.) ficavam acumuladas até o SO derrubar.
    for (const ws of panelSockets) {
      if (ws.alive === false) { ws.terminate(); continue; }
      ws.alive = false;
      send(ws, { type: 'ping' });
    }
  }, 25000);
}

function reject(socket, code) {
  socket.write(`HTTP/1.1 ${code} Unauthorized\r\n\r\n`);
  socket.destroy();
}

function onDevice(ws, device, req, ip) {
  ws.alive = true;
  if (!deviceSockets.has(device.id)) deviceSockets.set(device.id, new Set());
  deviceSockets.get(device.id).add(ws);
  bumpConn(ip, 'device', 1);
  onDeviceSeen(device.id, { ip }).catch(() => {});

  ws.on('message', (raw) => {
    ws.alive = true;
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'pong' || msg.type === 'status') onDeviceSeen(device.id, msg.type === 'status' ? msg : {}).catch(() => {});
  });
  ws.on('close', () => {
    const set = deviceSockets.get(device.id);
    if (set) { set.delete(ws); if (!set.size) deviceSockets.delete(device.id); }
    bumpConn(ip, 'device', -1);
  });
}

function onPanel(ws, user, ip) {
  ws.user = user;
  ws.alive = true;
  panelSockets.add(ws);
  bumpConn(ip, 'panel', 1);
  ws.on('close', () => { panelSockets.delete(ws); bumpConn(ip, 'panel', -1); });
  ws.on('message', () => { ws.alive = true; });
}

function isConnected(deviceId) {
  return (deviceSockets.get(deviceId)?.size || 0) > 0;
}

function sendToDevice(deviceId, msg) {
  let ok = false;
  for (const ws of deviceSockets.get(deviceId) || []) ok = send(ws, msg) || ok;
  return ok;
}

// Avisa as TVs afetadas por uma mudança de conteúdo/configuração.
async function notifyManifest({ clientId, deviceId }) {
  const ids = deviceId ? [deviceId] : (await all("SELECT id FROM devices WHERE client_id = ? AND status = 'active'", [clientId])).map(d => d.id);
  for (const id of ids) sendToDevice(id, { type: 'manifest.updated' });
  broadcastPanel({ type: 'content.updated', client_id: clientId || null, device_id: deviceId || null }, clientId);
}

// Eventos do painel: administradores recebem tudo; clientes só os próprios.
function broadcastPanel(msg, clientId) {
  for (const ws of panelSockets) {
    if (ws.user.role === 'admin' || (clientId && ws.user.client_id === clientId)) send(ws, msg);
  }
}

module.exports = { attach, sendToDevice, isConnected, notifyManifest, broadcastPanel, setPresenceHandler };
