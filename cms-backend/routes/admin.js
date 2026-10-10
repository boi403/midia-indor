// Rotas exclusivas do administrador: planos, clientes e usuários.
const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { run, get, all } = require('../database');
const { requireAdmin } = require('../lib/auth');
const { HttpError, toInt, bumpClient } = require('../lib/common');

const router = express.Router();
router.use(requireAdmin);

const nullableInt = (v) => (v === '' || v == null ? null : toInt(v));
const flag = (v) => (v ? 1 : 0);

// ---------- situação de pagamento ----------
function paymentStatus(c, today = new Date()) {
  const fee = c.monthly_fee_cents || c.price_cents || 0;
  if (!fee || c.status !== 'active') return 'isento';
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const paid = c.last_payment_at && new Date(c.last_payment_at.replace(' ', 'T')) >= monthStart;
  if (paid) return 'em_dia';
  return today.getDate() > (c.due_day || 10) ? 'atrasado' : 'pendente';
}

async function listClients() {
  const rows = await all(`SELECT c.*, p.name AS plan_name, p.max_tvs, p.price_cents,
      (SELECT count(*) FROM devices d WHERE d.client_id = c.id AND d.status != 'pending') AS tvs,
      (SELECT count(*) FROM devices d WHERE d.client_id = c.id AND d.status = 'active' AND d.online = 1) AS tvs_online,
      (SELECT max(last_login_at) FROM users u WHERE u.client_id = c.id) AS last_access
    FROM clients c LEFT JOIN plans p ON p.id = c.plan_id ORDER BY c.name COLLATE NOCASE`);
  return rows.map(c => ({
    ...c,
    tv_limit: c.max_tvs_override ?? c.max_tvs ?? null,
    fee_cents: c.monthly_fee_cents || c.price_cents || 0,
    payment_status: paymentStatus(c),
  }));
}

// ---------- planos ----------
router.get('/plans', async (req, res) => {
  res.json(await all(`SELECT p.*, (SELECT count(*) FROM clients c WHERE c.plan_id = p.id) AS clients FROM plans p ORDER BY price_cents`));
});

function planParams(b) {
  if (!b.name) throw new HttpError(400, 'Nome do plano é obrigatório.');
  return [b.name, nullableInt(b.max_tvs), nullableInt(b.max_media), nullableInt(b.max_playlists), toInt(b.price_cents, 0),
    flag(b.feat_scheduling), flag(b.feat_cameras), flag(b.feat_reports), flag(b.feat_api)];
}
router.post('/plans', async (req, res) => {
  const r = await run(`INSERT INTO plans (name, max_tvs, max_media, max_playlists, price_cents, feat_scheduling, feat_cameras, feat_reports, feat_api)
    VALUES (?,?,?,?,?,?,?,?,?)`, planParams(req.body));
  res.json({ id: r.lastID });
});
router.put('/plans/:id', async (req, res) => {
  await run(`UPDATE plans SET name=?, max_tvs=?, max_media=?, max_playlists=?, price_cents=?, feat_scheduling=?, feat_cameras=?, feat_reports=?, feat_api=?
    WHERE id = ?`, [...planParams(req.body), req.params.id]);
  res.json({ success: true });
});
router.delete('/plans/:id', async (req, res) => {
  const used = await get('SELECT count(*) AS n FROM clients WHERE plan_id = ?', [req.params.id]);
  if (used.n) throw new HttpError(409, `Plano em uso por ${used.n} cliente(s). Mude-os de plano antes de excluir.`);
  await run('DELETE FROM plans WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ---------- clientes ----------
router.get('/clients', async (req, res) => res.json(await listClients()));

router.get('/clients/:id', async (req, res) => {
  const c = (await listClients()).find(x => x.id === Number(req.params.id));
  if (!c) throw new HttpError(404, 'Cliente não encontrado.');
  c.users = await all('SELECT id, name, email, active, last_login_at FROM users WHERE client_id = ?', [c.id]);
  res.json(c);
});

function clientParams(b) {
  if (!b.name) throw new HttpError(400, 'Nome do cliente é obrigatório.');
  return [b.name, nullableInt(b.plan_id), nullableInt(b.max_tvs_override), toInt(b.monthly_fee_cents, 0),
    Math.min(28, Math.max(1, toInt(b.due_day, 10))), b.status === 'inactive' ? 'inactive' : 'active',
    b.contact_email || null, b.contact_phone || null, b.notes || null];
}

router.post('/clients', async (req, res) => {
  const b = req.body || {};
  const r = await run(`INSERT INTO clients (name, plan_id, max_tvs_override, monthly_fee_cents, due_day, status, contact_email, contact_phone, notes, tagline)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, [...clientParams(b), b.name.toUpperCase()]);
  let playlist;
  try {
    playlist = await run('INSERT INTO playlists (client_id, name, is_default) VALUES (?, ?, 1)', [r.lastID, 'Playlist Principal']);
    // já cria o acesso do cliente, se informado
    if (b.user_email && b.user_password) {
      await run("INSERT INTO users (name, email, password_hash, role, client_id) VALUES (?, ?, ?, 'client', ?)",
        [b.user_name || b.name, b.user_email, bcrypt.hashSync(String(b.user_password), 10), r.lastID]);
    }
  } catch (e) {
    // limpeza compensatória: não deixar cliente/playlist órfãos se um passo seguinte falhar
    if (playlist) await run('DELETE FROM playlists WHERE id = ?', [playlist.lastID]);
    await run('DELETE FROM clients WHERE id = ?', [r.lastID]);
    throw e;
  }
  res.json({ id: r.lastID });
});

router.put('/clients/:id', async (req, res) => {
  const before = await get('SELECT status FROM clients WHERE id = ?', [req.params.id]);
  if (!before) throw new HttpError(404, 'Cliente não encontrado.');
  await run(`UPDATE clients SET name=?, plan_id=?, max_tvs_override=?, monthly_fee_cents=?, due_day=?, status=?, contact_email=?, contact_phone=?, notes=?
    WHERE id = ?`, [...clientParams(req.body || {}), req.params.id]);
  // ativar/inativar muda o que as TVs exibem (tela de serviço suspenso)
  if (before.status !== (req.body.status === 'inactive' ? 'inactive' : 'active')) await bumpClient(Number(req.params.id));
  res.json({ success: true });
});

router.post('/clients/:id/payment', async (req, res) => {
  const when = req.body?.date ? new Date(req.body.date) : new Date();
  if (isNaN(when)) throw new HttpError(400, 'Data inválida.');
  await run('UPDATE clients SET last_payment_at = ? WHERE id = ?', [when.toISOString(), req.params.id]);
  res.json({ success: true });
});

router.delete('/clients/:id', async (req, res) => {
  const id = Number(req.params.id);
  const uploads = path.join(__dirname, '..', 'uploads');
  for (const m of await all('SELECT filename FROM midia WHERE client_id = ?', [id])) {
    const f = path.join(uploads, path.basename(m.filename));
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  for (const t of ['midia', 'slides', 'noticias', 'cameras']) await run(`DELETE FROM ${t} WHERE client_id = ?`, [id]);
  await run('DELETE FROM clients WHERE id = ?', [id]); // devices, users, playlists, campanhas: ON DELETE CASCADE
  res.json({ success: true });
});

// ---------- usuários ----------
router.get('/users', async (req, res) => {
  res.json(await all(`SELECT u.id, u.name, u.email, u.role, u.client_id, u.active, u.last_login_at, u.created_at, c.name AS client_name
    FROM users u LEFT JOIN clients c ON c.id = u.client_id ORDER BY u.role, u.name COLLATE NOCASE`));
});

function userParams(b) {
  if (!b.name || !b.email) throw new HttpError(400, 'Nome e e-mail são obrigatórios.');
  const role = b.role === 'admin' ? 'admin' : 'client';
  const clientId = role === 'client' ? nullableInt(b.client_id) : null;
  if (role === 'client' && !clientId) throw new HttpError(400, 'Selecione o cliente deste usuário.');
  return { role, clientId };
}

router.post('/users', async (req, res) => {
  const b = req.body || {};
  const { role, clientId } = userParams(b);
  if (!b.password || String(b.password).length < 10) throw new HttpError(400, 'A senha precisa ter pelo menos 10 caracteres.');
  if (await get('SELECT id FROM users WHERE email = ?', [b.email])) throw new HttpError(409, 'Já existe um usuário com este e-mail.');
  const r = await run('INSERT INTO users (name, email, password_hash, role, client_id, active) VALUES (?,?,?,?,?,?)',
    [b.name, b.email.trim(), bcrypt.hashSync(String(b.password), 10), role, clientId, b.active === false ? 0 : 1]);
  res.json({ id: r.lastID });
});

router.put('/users/:id', async (req, res) => {
  const b = req.body || {};
  const { role, clientId } = userParams(b);
  const id = Number(req.params.id);
  if (id === req.user.id && (role !== 'admin' || b.active === false)) throw new HttpError(400, 'Você não pode remover seu próprio acesso de administrador.');
  const dup = await get('SELECT id FROM users WHERE email = ? AND id != ?', [b.email, id]);
  if (dup) throw new HttpError(409, 'Já existe um usuário com este e-mail.');
  if (b.password && String(b.password).length < 10) throw new HttpError(400, 'A senha precisa ter pelo menos 10 caracteres.');
  await run('UPDATE users SET name=?, email=?, role=?, client_id=?, active=? WHERE id = ?', [b.name, b.email.trim(), role, clientId, b.active === false ? 0 : 1, id]);
  if (b.password) {
    // encerra sessões abertas com a senha antiga (mesma lógica de routes/auth.js)
    await run('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', [bcrypt.hashSync(String(b.password), 10), id]);
  }
  res.json({ success: true });
});

router.delete('/users/:id', async (req, res) => {
  if (Number(req.params.id) === req.user.id) throw new HttpError(400, 'Você não pode excluir o próprio usuário.');
  await run('DELETE FROM users WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

module.exports = { router, listClients, paymentStatus };
