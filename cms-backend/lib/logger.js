// Grava tudo o que o servidor escreve no console também em
// cms-backend/logs/servidor-AAAA-MM-DD.log (um arquivo por dia, 30 dias).
// Rodando como tarefa do Windows não há janela: os logs são o único registro.
const fs = require('fs');
const path = require('path');
const util = require('util');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const KEEP_DAYS = 30;

// data/hora local no formato AAAA-MM-DD HH:MM:SS
const stamp = (d = new Date()) => d.toLocaleString('sv-SE');

let day = null;
let stream = null;

function prune() {
  const limit = Date.now() - KEEP_DAYS * 86400000;
  for (const f of fs.readdirSync(LOG_DIR)) {
    if (!/^servidor-\d{4}-\d{2}-\d{2}\.log$/.test(f)) continue;
    const file = path.join(LOG_DIR, f);
    try { if (fs.statSync(file).mtimeMs < limit) fs.unlinkSync(file); } catch { /* em uso ou já removido */ }
  }
}

function streamFor(now) {
  const d = stamp(now).slice(0, 10);
  if (d !== day) {
    if (stream) stream.end();
    day = d;
    stream = fs.createWriteStream(path.join(LOG_DIR, `servidor-${d}.log`), { flags: 'a' });
    // sem isso, um erro no stream (disco cheio, arquivo travado por outro
    // processo etc.) sobe como exceção não tratada e derruba o servidor —
    // que a tarefa do Windows reinicia a cada 5s, num loop de crash.
    stream.on('error', (err) => { try { console.error('[logger] erro no stream de log:', err); } catch {} });
    try { prune(); } catch { /* limpeza é opcional */ }
  }
  return stream;
}

function install() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  for (const [method, level] of [['log', 'INFO'], ['warn', 'AVISO'], ['error', 'ERRO']]) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      original(...args);
      try {
        const now = new Date();
        streamFor(now).write(`${stamp(now)} [${level}] ${util.format(...args)}\n`);
      } catch { /* disco cheio etc.: o console continua funcionando */ }
    };
  }
}

module.exports = { install, LOG_DIR, stamp };
