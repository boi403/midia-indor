const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { run, get } = require('../database');
const { signUser, requireAuth } = require('../lib/auth');
const { clientPlan, publicUrl } = require('../lib/common');
const rateLimit = require('../lib/rate-limit');
const mailer = require('../lib/mailer');

const router = express.Router();

// Hash fictício usado quando o e-mail não existe, para que o tempo de resposta
// não revele (por timing) se um e-mail está cadastrado ou não.
const DUMMY_HASH = '$2b$10$i2/nDlYqqT0Zs9H7Xo9UMuyLALbZ/L534kRoDt62rAHa44BfdFvy2';

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
  const ok = await bcrypt.compare(String(password), u ? u.password_hash : DUMMY_HASH);
  if (!u || !ok) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  if (!u.active) return res.status(403).json({ error: 'Usuário desativado.' });
  if (role && role !== u.role) {
    return res.status(403).json({ error: role === 'admin' ? 'Esta conta não é de administrador. Use o acesso de cliente.' : 'Esta é uma conta de administrador. Use o acesso de administrador.' });
  }
  if (u.role === 'client' && u.client_status !== 'active') return res.status(403).json({ error: 'Conta do cliente inativa. Fale com o administrador.' });
  await run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", [u.id]);
  res.json({ token: signUser(u), user: await publicUser(u) });
});

router.post('/forgot-password', rateLimit({ windowMs: 5 * 60000, max: 10 }), async (req, res) => {
  const { email } = req.body || {};
  if (email) {
    const u = await get('SELECT id FROM users WHERE email = ?', [String(email).trim()]);
    if (u) {
      const token = crypto.randomBytes(32).toString('hex');
      await run("INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 hour'))", [token, u.id]);
      const link = publicUrl(req, '/redefinir-senha?token=' + token);
      mailer.sendMail({
        to: email,
        subject: 'Redefinir senha — CMS Mídia Indoor',
        html: `<p>Clique no link abaixo para definir uma nova senha. Ele expira em 1 hora.</p><p><a href="${link}">${link}</a></p>`,
      }).catch(() => {});
    }
  }
  // Sempre responde sucesso, mesmo se o e-mail não existir, para não revelar
  // se uma conta está cadastrada (mesma lógica do /login com o DUMMY_HASH).
  res.json({ success: true });
});

router.post('/reset-password', rateLimit({ windowMs: 5 * 60000, max: 10 }), async (req, res) => {
  const { token, password } = req.body || {};
  if (!password || String(password).length < 10) return res.status(400).json({ error: 'A nova senha precisa ter pelo menos 10 caracteres.' });
  const row = await get("SELECT * FROM password_reset_tokens WHERE token = ? AND used_at IS NULL AND expires_at > datetime('now')", [String(token || '')]);
  if (!row) return res.status(400).json({ error: 'Link inválido ou expirado. Solicite um novo.' });
  await run('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(String(password), 10), row.user_id]);
  await run("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE token = ?", [row.token]);
  res.json({ success: true });
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: await publicUser(req.user) });
});

router.post('/password', requireAuth, async (req, res) => {
  const { current, next } = req.body || {};
  if (!next || String(next).length < 10) return res.status(400).json({ error: 'A nova senha precisa ter pelo menos 10 caracteres.' });
  const u = await get('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!bcrypt.compareSync(String(current || ''), u.password_hash)) return res.status(400).json({ error: 'Senha atual incorreta.' });
  await run('UPDATE users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(String(next), 10), req.user.id]);
  res.json({ success: true });
});

module.exports = router;
