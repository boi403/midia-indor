// Alertas no Telegram. Mensagens que não saem (sem internet, Telegram fora)
// ficam numa fila e são reenviadas a cada minuto, para que a queda de uma TV
// durante uma falha de internet ainda chegue quando a conexão voltar.
const config = require('./config');

const QUEUE_MAX = 50;
const queue = [];
const lastSent = new Map();   // chave -> timestamp, para limitar repetição

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function enabled() {
  const { token, chat_id } = config.get().telegram || {};
  return Boolean(token && chat_id);
}

async function deliver(text) {
  const { token, chat_id } = config.get().telegram;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Telegram respondeu ${res.status}: ${body.slice(0, 200)}`);
    err.permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
    throw err;
  }
}

// Envia `html` (já escapado) com o nome deste local no topo.
// Retorna true se foi entregue agora.
async function send(html) {
  if (!enabled()) return false;
  const text = `<b>${esc(config.get().nome)}</b>\n${html}`;
  try {
    await deliver(text);
    return true;
  } catch (err) {
    console.error('[alerta] não foi possível enviar ao Telegram:', err.message);
    // token/chat errado não melhora com nova tentativa
    if (!err.permanent) {
      queue.push({ text, at: new Date() });
      if (queue.length > QUEUE_MAX) queue.shift();
    }
    return false;
  }
}

// Como send(), mas no máximo uma vez a cada `cooldownMin` para a mesma chave.
async function sendThrottled(key, html, cooldownMin = 30) {
  const last = lastSent.get(key) || 0;
  if (Date.now() - last < cooldownMin * 60000) return false;
  lastSent.set(key, Date.now());
  return send(html);
}

async function flush() {
  if (!enabled() || !queue.length) return;
  while (queue.length) {
    const item = queue[0];
    const late = `\n<i>(atrasado: gerado em ${item.at.toLocaleString('pt-BR')})</i>`;
    try { await deliver(item.text + late); } catch { return; }
    queue.shift();
  }
}

setInterval(() => flush().catch(() => {}), 60000).unref();

module.exports = { send, sendThrottled, enabled, esc };
