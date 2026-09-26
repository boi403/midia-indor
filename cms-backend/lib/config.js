// Configuração de operação (alertas, backup, monitoramento) em config.json,
// ao lado do server.js. Sem o arquivo tudo roda com os padrões abaixo e os
// alertas do Telegram ficam desligados. O arquivo é relido a cada minuto:
// mudanças valem sem reiniciar o servidor.
const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE = path.join(__dirname, '..', 'config.json');

const DEFAULTS = {
  nome: os.hostname(),                 // aparece no início de cada alerta
  telegram: { token: '', chat_id: '' },
  alertas: {
    tv_offline_minutos: 5,             // avisa quando uma TV fica offline por mais que isso
    tv_voltou: true,                   // avisa quando ela volta
    disco_minimo_gb: 5,                // avisa quando o espaço livre cai abaixo disso
    resumo_diario_hora: 8,             // resumo do dia no Telegram (null desliga)
  },
  backup: {
    hora: 3,                           // horário do backup diário
    manter_dias: 14,
    pasta: '',                         // vazio = cms-backend/backups
    copia_extra: '',                   // ex.: pasta do Google Drive; vazio desliga
    copiar_uploads: false,             // espelha também as mídias na copia_extra
  },
  healthchecks_url: '',                // aviso de PC desligado/sem internet (healthchecks.io)
};

let current = DEFAULTS;
let loadedMtime = null;

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object'
      ? { ...base[k], ...v } : v;
  }
  return out;
}

function reload() {
  let mtime = null;
  try { mtime = fs.statSync(FILE).mtimeMs; } catch { /* sem config.json: padrões */ }
  if (mtime === loadedMtime) return;
  loadedMtime = mtime;
  if (mtime === null) { current = DEFAULTS; return; }
  try {
    current = merge(DEFAULTS, JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^﻿/, '')));
    console.log('[config] config.json carregado.');
  } catch (err) {
    // mantém a última configuração válida em vez de desligar alertas por um erro de digitação
    console.error(`[config] config.json inválido, mantendo a configuração anterior: ${err.message}`);
  }
}

reload();
setInterval(reload, 60000).unref();

module.exports = { get: () => current, FILE };
