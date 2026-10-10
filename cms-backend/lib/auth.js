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
  // tv = token_version no momento da emissão; se a senha for trocada depois,
  // o valor no banco muda e este token para de validar (ver userFromToken).
  return jwt.sign({ uid: user.id, role: user.role, tv: user.token_version || 0 }, SECRET, { expiresIn: `${SESSION_DAYS}d` });
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
// O link inclui expiração (~1h) para que um link vazado não funcione pra sempre
// depois que a TV/câmera for revogada.
const CAMERA_LINK_TTL_SECONDS = 60 * 60;

function cameraSignature(camId, exp) {
  return crypto.createHmac('sha256', SECRET).update(`cam:${camId}:${exp}`).digest('hex').slice(0, 24);
}

// Gera a assinatura + expiração pra montar a URL do stream.
function signCameraLink(camId) {
  const exp = Math.floor(Date.now() / 1000) + CAMERA_LINK_TTL_SECONDS;
  return { exp, sig: cameraSignature(camId, exp) };
}

// Confere a assinatura E se o link ainda não expirou.
function verifyCameraLink(camId, exp, sig) {
  const expNum = parseInt(exp, 10);
  if (!Number.isFinite(expNum) || Date.now() >= expNum * 1000) return false;
  const expected = cameraSignature(camId, expNum);
  return typeof sig === 'string' && sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

async function userFromToken(token) {
  let payload;
  try { payload = jwt.verify(token, SECRET); } catch { return null; }
  if (!payload.uid) return null;
  const user = await get(`SELECT u.id, u.name, u.email, u.role, u.client_id, u.active, u.token_version, c.status AS client_status
    FROM users u LEFT JOIN clients c ON c.id = u.client_id WHERE u.id = ?`, [payload.uid]);
  if (!user || !user.active) return null;
  // token emitido antes da senha ser trocada: tratado como sessão encerrada,
  // mesmo que ainda não tenha expirado (ver signUser).
  if ((payload.tv || 0) !== (user.token_version || 0)) return null;
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
  signUser, signPreview, verifyPreview, signCameraLink, verifyCameraLink,
  userFromToken, requireAuth, requireAdmin, scopeClientId, requireClientScope,
};
