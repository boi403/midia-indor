// Cobrança recorrente: todo dia gera a fatura do mês para quem está no dia do
// vencimento, tenta criar o link de pagamento no Mercado Pago e avisa o
// cliente por e-mail; e suspende (status = 'inactive') quem passou do prazo
// de carência sem pagar. A TV e o login do cliente já olham para
// clients.status (routes/player.js e routes/auth.js) — então essa suspensão
// é o bastante, não precisa tocar em mais nada.
const { run, get, all } = require('../database');
const { bumpClient, tierFeeCents, clientTvCount } = require('./common');
const config = require('./config');

// mercadopago.js e mailer.js são escritos por outra tarefa em paralelo; se
// ainda não existirem (ou derem erro ao carregar) o cron continua funcionando
// — só não cria o link de pagamento nem envia o e-mail até lá.
let mp = null;
try { mp = require('./mercadopago'); } catch (err) { console.warn('[billing-cron] lib/mercadopago indisponível:', err.message); }
let mailer = null;
try { mailer = require('./mailer'); } catch (err) { console.warn('[billing-cron] lib/mailer indisponível:', err.message); }

const PRICE_DEFAULT = 25000;
const GRACE_DAYS_DEFAULT = 3;

function billingCfg() {
  const b = config.get().billing || {};
  return {
    priceCents: b.price_cents ?? PRICE_DEFAULT,
    graceDays: b.grace_days ?? GRACE_DAYS_DEFAULT,
    publicHost: b.public_host || '',
  };
}

// ---------- datas (sempre no horário local do servidor, formato YYYY-MM-DD) ----------
const pad2 = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Vencimento deste mês para um due_day (1-28, mas protege contra fevereiro etc.
// mesmo que algum due_day maior exista — clampa pro último dia real do mês).
function monthDueDate(dueDay, year, month) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  const day = Math.min(Math.max(1, Number(dueDay) || 1), lastDay);
  return new Date(year, month, day);
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return dt;
}

const formatReais = (cents) => `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---------- passo 1: gerar faturas do ciclo ----------
async function createInvoiceForClient(client, dueDateStr, amountCents) {
  const { lastID: invoiceId } = await run(
    'INSERT INTO invoices (client_id, amount_cents, due_date, status) VALUES (?,?,?,\'pending\')',
    [client.id, amountCents, dueDateStr],
  );
  // mantém monthly_fee_cents sincronizado com a faixa atual, pro painel admin
  // (que já mostra esse campo) refletir o valor realmente cobrado agora.
  await run('UPDATE clients SET monthly_fee_cents = ? WHERE id = ?', [amountCents, client.id]);
  client = { ...client, monthly_fee_cents: amountCents };

  const cfg = billingCfg();
  let checkoutUrl = null;
  let preferenceId = null;
  if (!mp) {
    console.warn(`[billing-cron] sem lib/mercadopago: fatura #${invoiceId} do cliente ${client.id} ficou sem link de pagamento (pode ser gerado depois pelo botão "pagar agora").`);
  } else if (!cfg.publicHost) {
    console.warn(`[billing-cron] billing.public_host não configurado em config.json: fatura #${invoiceId} do cliente ${client.id} ficou sem link de pagamento (pode ser gerado depois pelo botão "pagar agora").`);
  } else {
    try {
      const pref = await mp.createPreference({
        title: `Mensalidade CMS Mídia Indoor — ${client.name}`,
        amountCents: client.monthly_fee_cents,
        payerEmail: client.contact_email || undefined,
        externalReference: String(invoiceId),
        successUrl: `https://${cfg.publicHost}/pagamento/sucesso`,
        failureUrl: `https://${cfg.publicHost}/pagamento/falha`,
        pendingUrl: `https://${cfg.publicHost}/pagamento/pendente`,
        notificationUrl: `https://${cfg.publicHost}/api/webhooks/mercadopago`,
      });
      checkoutUrl = pref.init_point;
      preferenceId = pref.id;
      await run('UPDATE invoices SET mp_preference_id = ?, checkout_url = ? WHERE id = ?', [preferenceId, checkoutUrl, invoiceId]);
    } catch (err) {
      console.warn(`[billing-cron] falha ao criar preferência no Mercado Pago para a fatura #${invoiceId} (cliente ${client.id}):`, err.message);
    }
  }

  if (checkoutUrl) {
    if (!client.contact_email) {
      console.log(`[billing-cron] cliente ${client.id} (${client.name}) sem contact_email — e-mail da fatura #${invoiceId} não enviado.`);
    } else if (!mailer) {
      console.warn(`[billing-cron] sem lib/mailer: e-mail da fatura #${invoiceId} (cliente ${client.id}) não enviado.`);
    } else {
      try {
        const valor = formatReais(client.monthly_fee_cents);
        await mailer.sendMail({
          to: client.contact_email,
          subject: `Fatura de ${valor} disponível — CMS Mídia Indoor`,
          html: `<p>Olá, ${client.name}!</p>
<p>Sua fatura de <b>${valor}</b>, com vencimento em ${dueDateStr.split('-').reverse().join('/')}, já está disponível.</p>
<p><a href="${checkoutUrl}">Clique aqui para pagar</a></p>`,
        });
      } catch (err) {
        console.warn(`[billing-cron] falha ao enviar e-mail da fatura #${invoiceId} (cliente ${client.id}):`, err.message);
      }
    }
  }

  return { invoiceId, hasCheckout: !!checkoutUrl };
}

async function generateInvoices() {
  const now = new Date();
  const todayStr = fmtDate(now);
  const clients = await all("SELECT * FROM clients WHERE status = 'active' AND monthly_fee_cents > 0");

  let generated = 0;
  for (const client of clients) {
    try {
      const dueDate = monthDueDate(client.due_day, now.getFullYear(), now.getMonth());
      const dueDateStr = fmtDate(dueDate);
      if (todayStr < dueDateStr) continue; // ainda não chegou o dia do vencimento deste mês

      const ym = dueDateStr.slice(0, 7);
      const existing = await get("SELECT id FROM invoices WHERE client_id = ? AND substr(due_date, 1, 7) = ?", [client.id, ym]);
      if (existing) continue; // já existe fatura deste mês pra esse cliente

      // mensalidade pela faixa de quantidade de TVs no momento da cobrança
      // (1 TV = R$250, 2 TVs = R$500, 3+ = R$799 — configurável em billing.tiers)
      const amountCents = tierFeeCents(await clientTvCount(client.id));
      await createInvoiceForClient(client, dueDateStr, amountCents);
      generated++;
    } catch (err) {
      console.error(`[billing-cron] erro ao processar fatura do cliente ${client.id}:`, err.message);
    }
  }
  return generated;
}

// ---------- passo 2: suspender quem passou da carência ----------
async function suspendOverdue() {
  const cfg = billingCfg();
  const todayStr = fmtDate(new Date());
  const clients = await all("SELECT id, name FROM clients WHERE status = 'active'");

  let suspended = 0;
  for (const client of clients) {
    try {
      const invoice = await get(
        "SELECT * FROM invoices WHERE client_id = ? AND status = 'pending' AND due_date < ? ORDER BY due_date DESC LIMIT 1",
        [client.id, todayStr],
      );
      if (!invoice) continue;

      const deadlineStr = fmtDate(addDays(invoice.due_date, cfg.graceDays));
      if (todayStr <= deadlineStr) continue; // ainda dentro da carência

      await run("UPDATE clients SET status = 'inactive' WHERE id = ?", [client.id]);
      await bumpClient(client.id);
      suspended++;
      console.log(`[billing-cron] cliente ${client.id} (${client.name}) suspenso por falta de pagamento (fatura #${invoice.id}, vencida em ${invoice.due_date}).`);
    } catch (err) {
      console.error(`[billing-cron] erro ao verificar inadimplência do cliente ${client.id}:`, err.message);
    }
  }
  return suspended;
}

// ---------- ciclo diário ----------
let running = false;
async function runCycle() {
  if (running) return; // uma execução por vez — evita sobreposição se o timer disparar de novo no meio
  running = true;
  try {
    const generated = await generateInvoices();
    const suspended = await suspendOverdue();
    console.log(`[billing-cron] ${generated} fatura(s) gerada(s), ${suspended} cliente(s) suspenso(s).`);
  } catch (err) {
    console.error('[billing-cron] erro no ciclo:', err.message);
  } finally {
    running = false;
  }
}

function start() {
  // primeira passada logo após o início (não precisa esperar 24h), depois diária
  setTimeout(() => runCycle().catch(err => console.error('[billing-cron]', err.message)), 60000);
  setInterval(() => runCycle().catch(err => console.error('[billing-cron]', err.message)), 24 * 3600000);
}

module.exports = { start };
