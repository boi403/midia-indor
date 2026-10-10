// Cobrança via Mercado Pago: cadastro público com pagamento (signup + checkout),
// webhook de confirmação de pagamento e faturas do cliente já autenticado.
const express = require('express');
const bcrypt = require('bcryptjs');
const { run, get, all } = require('../database');
const { requireAuth, requireClientScope } = require('../lib/auth');
const { HttpError, bumpClient, trustedHost } = require('../lib/common');
const config = require('../lib/config');
const mp = require('../lib/mercadopago');
const rateLimit = require('../lib/rate-limit');

const router = express.Router();

// O Mercado Pago rejeita back_urls/notification_url que não sejam https. O túnel
// Cloudflare que expõe este servidor publicamente sempre termina em TLS, mesmo
// quando a requisição chega aqui como http simples — por isso não usamos
// req.protocol, só o host (e, por segurança, só um host confiável: ver
// trustedHost em lib/common.js — sem isso um Host forjado poderia desviar a
// confirmação de pagamento do Mercado Pago pro domínio de um atacante).
function httpsUrl(req, path) {
  const host = trustedHost(req);
  if (!host) throw new HttpError(400, 'Requisição de um endereço não reconhecido.');
  return `https://${host}${path}`;
}

// ---------- rotas públicas ----------

// Cadastro de um novo cliente: cria o registro pendente e devolve o link de
// checkout. O cliente só é efetivamente criado quando o webhook confirmar o pagamento.
router.post('/signup', rateLimit({ windowMs: 15 * 60000, max: 5, message: 'Muitas tentativas de cadastro. Aguarde um pouco.' }), async (req, res) => {
  const b = req.body || {};
  const companyName = String(b.company_name || '').trim();
  const email = String(b.email || '').trim();
  const password = String(b.password || '');
  if (!companyName || !email) throw new HttpError(400, 'Informe o nome da empresa e o e-mail.');
  if (password.length < 10) throw new HttpError(400, 'A senha precisa ter pelo menos 10 caracteres.');

  const existingUser = await get('SELECT id FROM users WHERE email = ? COLLATE NOCASE', [email]);
  if (existingUser) throw new HttpError(409, 'Este e-mail já está em uso.');
  const existingSignup = await get(
    "SELECT id FROM pending_signups WHERE email = ? COLLATE NOCASE AND status = 'pending_payment'", [email]
  );
  if (existingSignup) throw new HttpError(409, 'Este e-mail já está em uso.');

  // taxa única de implementação: cliente já tem computador (R$250+R$150) ou
  // levamos o nosso equipamento (R$2.675,43). Igual à mensalidade, configurável
  // em config.json; os valores abaixo são o padrão caso não esteja configurado.
  const hasComputer = b.has_computer !== false; // default: true (tem computador)
  const setup = config.get().billing?.setup_fees || { with_computer_cents: 40000, without_computer_cents: 267543 };
  const setupFeeCents = hasComputer ? (setup.with_computer_cents ?? 40000) : (setup.without_computer_cents ?? 267543);

  const passwordHash = bcrypt.hashSync(password, 10);
  const r = await run(
    `INSERT INTO pending_signups (company_name, email, phone, password_hash, has_computer, status) VALUES (?, ?, ?, ?, ?, 'pending_payment')`,
    [companyName, email, b.phone || null, passwordHash, hasComputer ? 1 : 0]
  );

  // 1ª mensalidade cobrada já no cadastro: cliente ainda não tem TV cadastrada
  // (0 TVs = faixa de 1 TV, R$250 — ver lib/common.js tierFeeCents).
  const firstMonthCents = config.get().billing?.price_cents || 25000;
  try {
    const pref = await mp.createPreference({
      items: [
        { title: `Implementação do serviço${hasComputer ? '' : ' (com equipamento)'}`, quantity: 1, unit_price: setupFeeCents / 100, currency_id: 'BRL' },
        { title: 'Assinatura mensal — 1ª mensalidade (1 TV)', quantity: 1, unit_price: firstMonthCents / 100, currency_id: 'BRL' },
      ],
      payerEmail: email,
      externalReference: `signup:${r.lastID}`,
      successUrl: httpsUrl(req, '/cadastro/sucesso'),
      failureUrl: httpsUrl(req, '/cadastro/falha'),
      pendingUrl: httpsUrl(req, '/cadastro/pendente'),
      notificationUrl: httpsUrl(req, '/api/webhooks/mercadopago'),
    });
    await run('UPDATE pending_signups SET mp_preference_id = ? WHERE id = ?', [pref.id, r.lastID]);
    res.json({ success: true, checkout_url: pref.init_point });
  } catch (err) {
    // nunca deixar um Mercado Pago mal configurado derrubar o cadastro com 500,
    // nem deixar um pending_signups órfão sem preferência de pagamento
    await run('DELETE FROM pending_signups WHERE id = ?', [r.lastID]);
    console.error('[billing] falha ao criar preferência do Mercado Pago:', err.message);
    res.status(503).json({ error: 'Pagamentos não configurados. Tente novamente mais tarde.' });
  }
});

// Webhook do Mercado Pago: formato novo (JSON) e legado (IPN por query string).
router.post('/webhooks/mercadopago', rateLimit({ windowMs: 60000, max: 30, message: 'Muitas requisições.' }), async (req, res) => {
  try {
    const type = req.body?.type || req.query.type;
    const paymentId = req.body?.data?.id || req.query['data.id'];
    if (type !== 'payment' || !paymentId) return res.json({ received: true });

    // idempotência: o Mercado Pago reenvia o webhook várias vezes
    const already = await get('SELECT id FROM invoices WHERE mp_payment_id = ?', [String(paymentId)]);
    if (already) return res.json({ received: true });

    const payment = await mp.getPayment(paymentId);
    if (payment.status !== 'approved') return res.json({ received: true });

    const ref = String(payment.external_reference || '');
    const today = new Date();
    const dueDate = today.toISOString().slice(0, 10);

    if (ref.startsWith('signup:')) {
      const pendingId = Number(ref.slice('signup:'.length));
      const pending = await get('SELECT * FROM pending_signups WHERE id = ?', [pendingId]);
      if (!pending || pending.status === 'completed') return res.json({ received: true });

      const price = config.get().billing?.price_cents || 25000;
      const dueDay = Math.min(28, Math.max(1, today.getDate()));
      const r = await run(
        `INSERT INTO clients (name, monthly_fee_cents, due_day, status, contact_email, last_payment_at)
         VALUES (?, ?, ?, 'active', ?, datetime('now'))`,
        [pending.company_name, price, dueDay, pending.email]
      );
      let playlist;
      try {
        playlist = await run('INSERT INTO playlists (client_id, name, is_default) VALUES (?, ?, 1)', [r.lastID, 'Playlist Principal']);
        // senha já em hash no cadastro: nunca fica em texto puro em lugar nenhum
        await run(
          `INSERT INTO users (name, email, password_hash, role, client_id) VALUES (?, ?, ?, 'client', ?)`,
          [pending.company_name, pending.email, pending.password_hash, r.lastID]
        );
      } catch (e) {
        // limpeza compensatória: não deixar cliente/playlist órfãos (mesmo padrão de routes/admin.js)
        if (playlist) await run('DELETE FROM playlists WHERE id = ?', [playlist.lastID]);
        await run('DELETE FROM clients WHERE id = ?', [r.lastID]);
        throw e;
      }

      await run(
        `INSERT INTO invoices (client_id, amount_cents, due_date, status, mp_payment_id, paid_at)
         VALUES (?, ?, ?, 'paid', ?, datetime('now'))`,
        [r.lastID, price, dueDate, String(paymentId)]
      );
      await run("UPDATE pending_signups SET status = 'completed' WHERE id = ?", [pendingId]);

      try {
        const mailer = require('../lib/mailer');
        await mailer.sendMail({
          to: pending.email,
          subject: 'Pagamento confirmado — CMS Mídia Indoor',
          text: `Seu pagamento foi confirmado e o acesso já está liberado. Entre em ${httpsUrl(req, '/login')} com o e-mail ${pending.email} e a senha escolhida no cadastro.`,
        });
      } catch (e) {
        // falha de e-mail nunca deve desfazer a ativação do cliente
        console.error('[billing] falha ao enviar e-mail de boas-vindas:', e.message);
      }
    } else if (/^\d+$/.test(ref)) {
      // cobrança recorrente mensal, gerada pelo cron de faturamento
      const invoice = await get('SELECT * FROM invoices WHERE id = ?', [ref]);
      if (!invoice || invoice.status === 'paid') return res.json({ received: true });
      await run(
        `UPDATE invoices SET status = 'paid', mp_payment_id = ?, paid_at = datetime('now') WHERE id = ?`,
        [String(paymentId), invoice.id]
      );
      await run("UPDATE clients SET status = 'active', last_payment_at = datetime('now') WHERE id = ?", [invoice.client_id]);
      await bumpClient(invoice.client_id);
    }

    res.json({ received: true });
  } catch (err) {
    // o Mercado Pago reenvia agressivamente em caso de erro (não-200); como o
    // próprio processamento já decide "nada a fazer"/"já processado" com 200,
    // só chega aqui uma falha inesperada — registra e ainda assim responde 200
    // para não entrar num loop de retentativas que não vai se resolver sozinho.
    console.error('[billing] erro ao processar webhook do Mercado Pago:', err);
    res.json({ received: true });
  }
});

// ---------- daqui em diante: painel autenticado, escopo de um cliente ----------
router.use(requireAuth, requireClientScope);

router.get('/invoices', async (req, res) => {
  res.json(await all('SELECT * FROM invoices WHERE client_id = ? ORDER BY due_date DESC', [req.clientId]));
});

// Gera (ou renova) o link de pagamento de uma fatura em aberto.
router.post('/invoices/:id/pay', rateLimit({ windowMs: 60000, max: 10, message: 'Muitas tentativas. Aguarde um pouco.' }), async (req, res) => {
  const invoice = await get('SELECT * FROM invoices WHERE id = ? AND client_id = ?', [req.params.id, req.clientId]);
  if (!invoice) throw new HttpError(404, 'Fatura não encontrada.');
  if (invoice.status === 'paid') throw new HttpError(400, 'Fatura já paga.');

  const client = await get('SELECT contact_email FROM clients WHERE id = ?', [req.clientId]);
  const payerEmail = client?.contact_email || req.user.email;

  let pref;
  try {
    pref = await mp.createPreference({
      title: 'Mensalidade — CMS Mídia Indoor',
      amountCents: invoice.amount_cents,
      payerEmail,
      externalReference: invoice.id,
      successUrl: httpsUrl(req, '/faturas/sucesso'),
      failureUrl: httpsUrl(req, '/faturas/falha'),
      pendingUrl: httpsUrl(req, '/faturas/pendente'),
      notificationUrl: httpsUrl(req, '/api/webhooks/mercadopago'),
    });
  } catch (err) {
    console.error('[billing] falha ao criar preferência do Mercado Pago:', err.message);
    throw new HttpError(503, 'Pagamentos não configurados. Tente novamente mais tarde.');
  }
  await run('UPDATE invoices SET mp_preference_id = ?, checkout_url = ? WHERE id = ?', [pref.id, pref.init_point, invoice.id]);
  res.json({ checkout_url: pref.init_point });
});

module.exports = router;
