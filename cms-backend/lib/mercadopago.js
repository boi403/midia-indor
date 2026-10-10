// Integração com a API do Mercado Pago (checkout Pro): criação de preferências
// de pagamento e consulta de pagamentos recebidos via webhook.
const config = require('./config');

const BASE = 'https://api.mercadopago.com';

function token() {
  const t = config.get().mercadopago?.access_token;
  if (!t) throw new Error('Mercado Pago não configurado (mercadopago.access_token ausente em config.json).');
  return t;
}

// Cria uma preferência de pagamento (link de checkout) para uma cobrança.
// Aceita `items` (lista pronta, ex.: implementação + 1ª mensalidade discriminadas
// no mesmo checkout) ou, pro caso comum de um item só, `title`+`amountCents`.
async function createPreference({ title, amountCents, items, payerEmail, externalReference, successUrl, failureUrl, pendingUrl, notificationUrl }) {
  const body = {
    items: items && items.length ? items : [{ title, quantity: 1, unit_price: amountCents / 100, currency_id: 'BRL' }],
    payer: { email: payerEmail },
    external_reference: String(externalReference),
    back_urls: { success: successUrl, failure: failureUrl, pending: pendingUrl },
    auto_return: 'approved',
    notification_url: notificationUrl,
  };
  const res = await fetch(`${BASE}/checkout/preferences`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Mercado Pago respondeu ${res.status}: ${await res.text()}`);
  return res.json(); // { id, init_point, ... }
}

// Busca os detalhes de um pagamento (status, external_reference) para processar o webhook.
async function getPayment(paymentId) {
  const res = await fetch(`${BASE}/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${token()}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Mercado Pago respondeu ${res.status} ao buscar pagamento ${paymentId}`);
  return res.json(); // inclui .status ('approved'|'pending'|'rejected'|...) e .external_reference
}

module.exports = { createPreference, getPayment };
