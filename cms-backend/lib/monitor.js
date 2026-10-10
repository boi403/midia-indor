// Monitoramento para operar sem estar no local: avisos de TV offline/voltou,
// disco cheio, reinício após falha, resumo diário e sinal de vida para o
// healthchecks.io (que avisa quando o PC inteiro para de responder).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, all } = require('../database');
const config = require('./config');
const alerts = require('./alerts');
const backup = require('./backup');

const { esc } = alerts;
const LOCK_FILE = path.join(__dirname, '..', '.em-execucao');

// início do servidor = quando ele criou o .em-execucao (vale também para o
// ferramentas.js, que roda em outro processo)
function serverStartedAt() {
  try { return fs.statSync(LOCK_FILE).mtimeMs; } catch { return Date.now(); }
}

const fmtDuration = (ms) => {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h${String(m % 60).padStart(2, '0')}` : `${Math.floor(h / 24)}d ${h % 24}h`;
};
const fmtGb = (bytes) => `${(bytes / 1073741824).toFixed(1)} GB`;
const tvLabel = (d) => `${esc(d.name || `TV #${d.id}`)}${d.location ? ` (${esc(d.location)})` : ''}${d.client ? ` — ${esc(d.client)}` : ''}`;

// Telegram recusa mensagem acima de ~4096 caracteres (erro 400): numa queda
// geral (ex.: internet do prédio caiu) com 60+ TVs isso faria o envio falhar
// e, sem o corte abaixo, perderíamos o alerta inteiro do incidente.
const ALERT_LIST_MAX = 30;
function capList(lines) {
  if (lines.length <= ALERT_LIST_MAX) return lines;
  return [...lines.slice(0, ALERT_LIST_MAX), `… +${lines.length - ALERT_LIST_MAX} mais`];
}

// ---------- TVs ----------
async function checkTvs() {
  // sem Telegram não marca nada: ao configurar, as TVs já caídas ainda são avisadas
  if (!alerts.enabled()) return;
  const cfg = config.get().alertas;
  const limit = new Date(Date.now() - Number(cfg.tv_offline_minutos) * 60000).toISOString();

  const down = await all(`SELECT d.id, d.name, d.location, COALESCE(d.offline_since, d.last_seen_at) AS since, c.name AS client
    FROM devices d LEFT JOIN clients c ON c.id = d.client_id
    WHERE d.status = 'active' AND d.online = 0 AND d.alert_offline_since IS NULL
      AND COALESCE(d.offline_since, d.last_seen_at) < ?`, [limit]);
  if (down.length) {
    // várias TVs de uma vez = uma mensagem só (típico de queda de internet no cliente)
    const lines = down.map(d => `• ${tvLabel(d)} — há ${fmtDuration(Date.now() - Date.parse(d.since))}`);
    const title = down.length === 1 ? '🔴 <b>TV offline</b>' : `🔴 <b>${down.length} TVs offline</b>`;
    const sent = await alerts.send(`${title}\n${capList(lines).join('\n')}`);
    // só marca como avisado se o envio realmente saiu; senão o próximo ciclo
    // tenta de novo (antes, uma falha de envio — ex.: mensagem grande demais
    // para o Telegram — ainda marcava tudo como avisado e perdia o alerta)
    if (sent) for (const d of down) await run('UPDATE devices SET alert_offline_since = ? WHERE id = ?', [d.since, d.id]);
  }

  const back = await all(`SELECT d.id, d.name, d.location, d.online, d.alert_offline_since AS since, d.online_since, c.name AS client
    FROM devices d LEFT JOIN clients c ON c.id = d.client_id
    WHERE d.alert_offline_since IS NOT NULL AND (d.online = 1 OR d.status != 'active')`);
  if (back.length) {
    const online = back.filter(d => d.online && d.online_since);
    if (cfg.tv_voltou && online.length) {
      const lines = online.map(d => `• ${tvLabel(d)} — ficou fora ${fmtDuration(Date.parse(d.online_since) - Date.parse(d.since))}`);
      await alerts.send(`🟢 <b>${online.length === 1 ? 'TV voltou' : `${online.length} TVs voltaram`}</b>\n${lines.join('\n')}`);
    }
    await run(`UPDATE devices SET alert_offline_since = NULL WHERE id IN (${back.map(() => '?').join(',')})`, back.map(d => d.id));
  }
}

// ---------- disco ----------
function diskFree() {
  const s = fs.statfsSync(path.join(__dirname, '..'));
  return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
}

async function checkDisk() {
  const { free } = diskFree();
  const min = Number(config.get().alertas.disco_minimo_gb) * 1073741824;
  if (free < min) {
    await alerts.sendThrottled('disco', `🟠 <b>Pouco espaço em disco</b>\nLivre: ${fmtGb(free)} (mínimo configurado: ${fmtGb(min)}).\nApague mídias antigas ou libere espaço, senão uploads e backups vão falhar.`, 12 * 60);
  }
}

// ---------- resumo diário ----------
let summarySentOn = null;

async function summaryText() {
  const tvs = await all(`SELECT d.id, d.name, d.location, d.online, COALESCE(d.offline_since, d.last_seen_at) AS since, c.name AS client
    FROM devices d LEFT JOIN clients c ON c.id = d.client_id WHERE d.status = 'active' ORDER BY c.name, d.name`);
  const off = tvs.filter(d => !d.online);
  const b = backup.status();
  const { free } = diskFree();
  const lines = [
    `📊 <b>Resumo do dia</b>`,
    `TVs online: <b>${tvs.length - off.length}/${tvs.length}</b>`,
    ...capList(off.map(d => `  🔴 ${tvLabel(d)}${d.since ? ` — offline há ${fmtDuration(Date.now() - Date.parse(d.since))}` : ''}`)),
    b ? (b.ok ? `Backup: ✅ ${b.at.toLocaleString('pt-BR')} (${(b.bytes / 1048576).toFixed(1)} MB)` : `Backup: 🔴 falhou — ${esc(b.error)}`) : 'Backup: ⚠️ nenhum ainda',
    `Disco livre: ${fmtGb(free)}`,
    `Servidor no ar há ${fmtDuration(Date.now() - serverStartedAt())}`,
  ];
  return lines.join('\n');
}

async function checkSummary() {
  const hour = config.get().alertas.resumo_diario_hora;
  if (hour === null || hour === undefined || hour === '') return;
  const now = new Date();
  const today = now.toLocaleDateString('sv-SE');
  if (now.getHours() !== Number(hour) || summarySentOn === today) return;
  summarySentOn = today;
  await alerts.send(await summaryText());
}

// ---------- retenção ----------
// playback_events (proof-of-play) e device_commands crescem sem limite.
// Apaga em lotes pequenos (não um DELETE gigante só) pra não travar a conexão
// compartilhada com uma escrita longa. O SQLite deste projeto não foi
// compilado com suporte a "DELETE ... LIMIT", então o lote é feito com um
// IN (SELECT ... LIMIT ?) sobre o id (rowid), que tem o mesmo efeito.
const RETENTION_BATCH = 5000;

async function pruneBatches(sql, params) {
  let total = 0;
  for (;;) {
    const { changes } = await run(sql, params);
    total += changes;
    if (!changes) break;
  }
  return total;
}

async function pruneOldData() {
  const eventsLimit = new Date(Date.now() - 90 * 86400000).toISOString();
  const events = await pruneBatches(
    'DELETE FROM playback_events WHERE id IN (SELECT id FROM playback_events WHERE started_at < ? LIMIT ?)',
    [eventsLimit, RETENTION_BATCH],
  );
  const commands = await pruneBatches(
    "DELETE FROM device_commands WHERE id IN (SELECT id FROM device_commands WHERE issued_at < datetime('now', '-7 days') LIMIT ?)",
    [RETENTION_BATCH],
  );
  console.log(`[retenção] ${events} evento(s) de reprodução (>90 dias) e ${commands} comando(s) de dispositivo (>7 dias) removidos`);
}

// ---------- healthchecks.io ----------
async function ping(suffix = '') {
  const url = config.get().healthchecks_url;
  if (!url) return;
  try { await fetch(url.replace(/\/$/, '') + suffix, { signal: AbortSignal.timeout(10000) }); }
  catch (err) { console.error('[healthchecks] sem resposta:', err.message); }
}

// ---------- ciclo de vida ----------
function markRunning() {
  const crashed = fs.existsSync(LOCK_FILE);
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  return crashed;
}

function markStopped() {
  try { fs.unlinkSync(LOCK_FILE); } catch { /* já removido */ }
}

function guard(name, fn) {
  return () => fn().catch(err => console.error(`[monitor:${name}]`, err.message));
}

function start() {
  const crashed = markRunning();
  if (crashed) {
    console.warn('[monitor] a execução anterior não terminou normalmente.');
    alerts.send(`🟠 <b>Servidor reiniciado</b>\nA execução anterior não terminou normalmente (queda de energia, PC desligado à força ou erro). Já está no ar de novo.`);
  } else {
    alerts.send(`🟢 <b>Servidor iniciado</b> em ${esc(os.hostname())}.`);
  }

  setInterval(guard('tvs', checkTvs), 60000);
  setInterval(guard('disco', checkDisk), 30 * 60000);
  setInterval(guard('resumo', checkSummary), 60000);
  setInterval(() => ping(), 5 * 60000);
  guard('disco', checkDisk)();
  ping('/start');

  // retenção de playback_events/device_commands: diária, com uma primeira
  // passada logo após o início (não precisa esperar 24h pra começar a limpar)
  setTimeout(guard('retencao', pruneOldData), 2 * 60000);
  setInterval(guard('retencao', pruneOldData), 24 * 3600000);

  // desligamento normal (Ctrl+C, fim da tarefa): não é falha
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
    process.on(sig, () => { markStopped(); process.exit(0); });
  }
}

// Erro que derrubaria o processo: registra, avisa e sai com código 1 para o
// iniciar-tudo.bat subir o servidor de novo (o .em-execucao fica, então o
// próximo início também avisa).
function handleFatal(err) {
  console.error('[fatal]', err);
  const done = () => process.exit(1);
  setTimeout(done, 8000).unref();
  alerts.send(`🔴 <b>Erro grave — servidor reiniciando</b>\n<code>${esc(String(err && err.stack || err).slice(0, 800))}</code>`)
    .finally(() => ping('/fail')).finally(done);
}

function handleRejection(err) {
  console.error('[erro não tratado]', err);
  alerts.sendThrottled('rejection', `🟠 <b>Erro não tratado no servidor</b> (o servidor continua no ar)\n<code>${esc(String(err && err.stack || err).slice(0, 800))}</code>`, 30);
}

// Erros 500 das rotas: um aviso a cada 30 min no máximo.
function reportRequestError(req, err) {
  alerts.sendThrottled('http500', `🟠 <b>Erro interno</b> em <code>${esc(req.method)} ${esc(req.originalUrl)}</code>\n<code>${esc(String(err.message).slice(0, 500))}</code>\n<i>(avisos repetidos ficam suprimidos por 30 min — veja os logs)</i>`, 30);
}

module.exports = { start, checkTvs, handleFatal, handleRejection, reportRequestError, summaryText, markStopped };
