// Backup diário do banco. Usa VACUUM INTO, que gera uma cópia consistente
// com o servidor rodando (copiar o cms.db direto pode pegar o arquivo no meio
// de uma escrita). Cada cópia é conferida com PRAGMA quick_check antes de
// contar como válida.
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { run } = require('../database');
const config = require('./config');
const alerts = require('./alerts');

const DEFAULT_DIR = path.join(__dirname, '..', 'backups');
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const KEEP_MIN = 3;   // nunca apaga as 3 cópias mais novas, mesmo antigas
const FILE_RE = /^cms-\d{4}-\d{2}-\d{2}_\d{4}\.db$/;

let last = null;      // { at, file, bytes, ok, error }
let running = null;

const backupDir = () => config.get().backup.pasta || DEFAULT_DIR;

function listBackups(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => FILE_RE.test(f))
    .map(f => ({ file: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

function prune(dir, keepDays) {
  const limit = Date.now() - keepDays * 86400000;
  listBackups(dir).slice(KEEP_MIN).filter(b => b.mtime < limit).forEach(b => fs.unlinkSync(b.file));
}

function quickCheck(file) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(file, sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(err);
      db.get('PRAGMA quick_check', (e, row) => {
        db.close();
        if (e) reject(e);
        else if (row && row.quick_check === 'ok') resolve();
        else reject(new Error(`cópia corrompida: ${row && row.quick_check}`));
      });
    });
  });
}

// Espelha uploads/ em destino/uploads copiando só o que é novo ou mudou.
function mirrorUploads(dest) {
  let copied = 0;
  const walk = (src, dst) => {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, e.name), d = path.join(dst, e.name);
      if (e.isDirectory()) { walk(s, d); continue; }
      const st = fs.statSync(s);
      let dt = null;
      try { dt = fs.statSync(d); } catch { /* não existe no destino */ }
      if (!dt || dt.size !== st.size) { fs.copyFileSync(s, d); copied++; }
    }
  };
  if (fs.existsSync(UPLOADS_DIR)) walk(UPLOADS_DIR, path.join(dest, 'uploads'));
  return copied;
}

async function doBackup() {
  const cfg = config.get().backup;
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date();
  const name = `cms-${now.toLocaleString('sv-SE').slice(0, 16).replace(' ', '_').replace(':', '')}.db`;
  const file = path.join(dir, name);
  const tmp = `${file}.tmp`;
  const notes = [];
  try {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    await run('VACUUM INTO ?', [tmp]);
    await quickCheck(tmp);
    fs.renameSync(tmp, file);
    prune(dir, cfg.manter_dias);

    if (cfg.copia_extra) {
      // falha na cópia extra (Drive desconectado etc.) não invalida o backup local
      try {
        fs.mkdirSync(cfg.copia_extra, { recursive: true });
        fs.copyFileSync(file, path.join(cfg.copia_extra, name));
        prune(cfg.copia_extra, cfg.manter_dias);
        if (cfg.copiar_uploads) notes.push(`${mirrorUploads(cfg.copia_extra)} mídia(s) nova(s) copiada(s)`);
      } catch (err) {
        notes.push(`cópia extra falhou: ${err.message}`);
        await alerts.sendThrottled('backup-extra', `⚠️ Backup local OK, mas a cópia para <code>${alerts.esc(cfg.copia_extra)}</code> falhou:\n${alerts.esc(err.message)}`, 12 * 60);
      }
    }

    const bytes = fs.statSync(file).size;
    last = { at: now, file, bytes, ok: true, error: null, notes };
    console.log(`[backup] ${file} (${(bytes / 1048576).toFixed(1)} MB)${notes.length ? ' — ' + notes.join('; ') : ''}`);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* nada a limpar */ }
    last = { at: now, file: null, bytes: 0, ok: false, error: err.message, notes };
    console.error('[backup] FALHOU:', err.message);
    await alerts.send(`🔴 <b>Backup do banco falhou</b>\n${alerts.esc(err.message)}\nPasta: <code>${alerts.esc(dir)}</code>`);
  }
  return last;
}

function backupNow() {
  if (!running) running = doBackup().finally(() => { running = null; });
  return running;
}

// Última cópia válida em disco (sobrevive a reinícios do servidor).
function newestOnDisk() {
  const b = listBackups(backupDir())[0];
  return b ? { at: new Date(b.mtime), file: b.file, bytes: fs.statSync(b.file).size, ok: true } : null;
}

function status() {
  return last && !last.ok ? last : (newestOnDisk() || last);
}

// Roda no horário configurado; se o PC estava desligado nesse horário,
// recupera o atraso assim que passar de 26h sem backup.
function tick() {
  const good = newestOnDisk();
  const age = good ? Date.now() - good.at.getTime() : Infinity;
  const hour = new Date().getHours();
  if ((hour === Number(config.get().backup.hora) && age > 20 * 3600000) || age > 26 * 3600000) {
    // depois de uma falha, tenta de novo só uma vez por hora
    if (last && !last.ok && Date.now() - last.at.getTime() < 3600000) return;
    backupNow();
  }
}

function start() {
  setTimeout(tick, 60000);   // dá tempo das TVs reconectarem antes do primeiro backup
  setInterval(tick, 5 * 60000);
}

module.exports = { start, backupNow, status, backupDir };
