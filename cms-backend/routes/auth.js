const express = require('express');
const bcrypt = require('bcryptjs');
const { run, get } = require('../database');
const { signUser, requireAuth } = require('../lib/auth');
const { clientPlan } = require('../lib/common');
const rateLimit = require('../lib/rate-limit');

const router = express.Router();

async function publicUser(u) {
  const out = { id: u.id, name: u.name, email: u.email, role: u.role, client_id: u.client_id };
  if (u.client_id) {
    const c = await clientPlan(u.client_id);
    out.client = {
      id: c.id, name: c.name, plan: c.plan_name, tv_limit: c.tv_limit,
      features: { scheduling: !!c.feat_scheduling, cameras: !!c.feat_cameras, reports: !!c.feat_reports, api: !!c.feat_api },
    };
  }
  return out;
}

router.post('/login', rateLimit({ windowMs: 5 * 60000, max: 15 }), async (req, res) => {
  const { email, password, role } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Informe e-mail e senha.' });
  const u = await get(`SELECT u.*, c.status AS client_status FROM users u LEFT JOIN clients c ON c.id = u.client_id WHERE u.email = ?`, [String(email).trim()]);
  if (!u || !bcrypt.compareSync(String(password), u.password_hash)) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  if (!u.active) return res.status(403).json({ error: 'Usuário desativado.' });
  if (role && role !== u.role) {
    return res.status(403).json({ error: role === 'admin' ? 'Esta conta não é de administrador. Use o acesso de cliente.' : 'Esta é uma conta de administrador. Use o acesso de administrador.' });
  }
  if (u.role === 'client' && u.client_status !== 'active') return res.status(403).json({ error: 'Conta do cliente inativa. Fale com o administrador.' });
  await run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", [u.id]);
  res.json({ token: signUser(u), user: await publicUser(u) });
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: await publicUser(req.user) });
});

router.post('/password', requireAuth, async (req, res) => {
  const { current, next } = req.body || {};
  if (!next || String(next).length < 6) return res.status(400).json({ error: 'A nova senha precisa ter pelo menos 6 caracteres.' });
  const u = await get('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!bcrypt.compareSync(String(current || ''), u.password_hash)) return res.status(400).json({ error: 'Senha atual incorreta.' });
  await run('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(String(next), 10), req.user.id]);
  res.json({ success: true });
});

module.exports = router;
