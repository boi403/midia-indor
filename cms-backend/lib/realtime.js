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

function attach(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    const token = url.searchParams.get('token') || '';
    try {
      if (url.pathname === '/ws/device') {
        const device = await get("SELECT id, client_id, status FROM devices WHERE token_hash = ? AND status != 'pending'", [sha256(token)]);
        if (!device) return reject(socket, 401);
        wss.handleUpgrade(req, socket, head, (ws) => onDevice(ws, device, req));
      } else if (url.pathname === '/ws/panel') {
        const user = await userFromToken(token);
        if (!user) return reject(socket, 401);
        wss.handleUpgrade(req, socket, head, (ws) => onPanel(ws, user));
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
    for (const ws of panelSockets) send(ws, { type: 'ping' });
  }, 25000);
}

function reject(socket, code) {
  socket.write(`HTTP/1.1 ${code} Unauthorized\r\n\r\n`);
  socket.destroy();
}

function onDevice(ws, device, req) {
  ws.alive = true;
  if (!deviceSockets.has(device.id)) deviceSockets.set(device.id, new Set());
  deviceSockets.get(device.id).add(ws);
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  onDeviceSeen(device.id, { ip }).catch(() => {});

  ws.on('message', (raw) => {
    ws.alive = true;
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'pong' || msg.type === 'status') onDeviceSeen(device.id, msg.type === 'status' ? msg : {}).catch(() => {});
  });
  ws.on('close', () => {
    const set = deviceSockets.get(device.id);
    if (set) { set.delete(ws); if (!set.size) deviceSockets.delete(device.id); }
  });
}

function onPanel(ws, user) {
  ws.user = user;
  panelSockets.add(ws);
  ws.on('close', () => panelSockets.delete(ws));
  ws.on('message', () => {});
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
