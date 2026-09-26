// Autenticação do painel (JWT) e escopo de cliente.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { get } = require('../database');

// Segredo persistido em disco para as sessões sobreviverem a reinícios.
// Em produção, defina JWT_SECRET no ambiente.
const secretFile = path.join(__dirname, '..', '.jwt-secret');
let SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  if (fs.existsSync(secretFile)) SECRET = fs.readFileSync(secretFile, 'utf8').trim();
  else {
    SECRET = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(secretFile, SECRET);
  }
}

const SESSION_DAYS = 30;

function signUser(user) {
  return jwt.sign({ uid: user.id, role: user.role }, SECRET, { expiresIn: `${SESSION_DAYS}d` });
}

// Token curto usado pelo preview do player dentro do painel.
function signPreview(deviceId) {
  return jwt.sign({ preview: deviceId }, SECRET, { expiresIn: '12h' });
}
function verifyPreview(token) {
  try { return jwt.verify(token, SECRET).preview || null; } catch { return null; }
}

// Assinatura das URLs de stream de câmera: o <img> do player não manda
// cabeçalho Authorization, então a autorização vai na própria URL.
function cameraSig(camId) {
  return crypto.createHmac('sha256', SECRET).update('cam:' + camId).digest('hex').slice(0, 24);
}
function checkCameraSig(camId, sig) {
  const expected = cameraSig(camId);
  return typeof sig === 'string' && sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

async function userFromToken(token) {
  let payload;
  try { payload = jwt.verify(token, SECRET); } catch { return null; }
  if (!payload.uid) return null;
  const user = await get(`SELECT u.id, u.name, u.email, u.role, u.client_id, u.active, c.status AS client_status
    FROM users u LEFT JOIN clients c ON c.id = u.client_id WHERE u.id = ?`, [payload.uid]);
  if (!user || !user.active) return null;
  if (user.role === 'client' && user.client_status !== 'active') return null;
  return user;
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = token && await userFromToken(token);
  if (!user) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
  next();
}

// Cliente sobre o qual a requisição age. Usuário cliente: sempre o próprio.
// Administrador: o cliente escolhido no seletor do painel (cabeçalho X-Client-Id).
function scopeClientId(req) {
  if (req.user.role === 'client') return req.user.client_id;
  const raw = req.headers['x-client-id'] || req.query.client_id;
  const id = parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

// Middleware para rotas de conteúdo, que sempre precisam de um cliente definido.
function requireClientScope(req, res, next) {
  const id = scopeClientId(req);
  if (!id) return res.status(400).json({ error: 'Selecione um cliente no topo do painel.' });
  req.clientId = id;
  next();
}

module.exports = {
  signUser, signPreview, verifyPreview, cameraSig, checkCameraSig,
  userFromToken, requireAuth, requireAdmin, scopeClientId, requireClientScope,
};
