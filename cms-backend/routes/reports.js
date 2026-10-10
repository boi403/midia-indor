// Relatórios de exibição (proof-of-play) a partir dos eventos enviados pelas TVs.
const express = require('express');
const { all, get } = require('../database');
const { requireAuth, requireClientScope } = require('../lib/auth');
const { requireFeature, HttpError } = require('../lib/common');
const finance = require('../lib/finance');

const router = express.Router();

// Cotações (ver lib/finance.js — são as mesmas pra todos os clientes, nada
// sensível). Rota pública e registrada ANTES do router.use(requireAuth...)
// abaixo, de propósito: o player da TV não autentica como usuário, só como
// dispositivo, então não pode chamar nada que exija login de painel. É o
// mecanismo "separado" descrito no manifest.js/finance.js para a TV buscar
// cotações atualizadas sem precisar reconstruir o manifesto inteiro (o que
// forçava toda TV de todo cliente a recarregar a cada ~10 min).
router.get('/quotes', (req, res) => res.json({ quotes: finance.getQuotes() }));

router.use(requireAuth, requireClientScope, async (req, res, next) => {
  await requireFeature(req, 'reports', 'Relatórios');
  next();
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get('/playback', async (req, res) => {
  const to = DATE_RE.test(req.query.to || '') ? req.query.to : new Date().toISOString().slice(0, 10);
  const from = DATE_RE.test(req.query.from || '') ? req.query.from : new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  if (from > to) throw new HttpError(400, 'Período inválido.');
  const range = [req.clientId, from, to + 'T23:59:59.999Z'];
  const where = 'WHERE e.client_id = ? AND e.started_at >= ? AND e.started_at <= ?';

  const total = await get(`SELECT count(*) AS plays, coalesce(sum(duration_ms), 0) AS ms, coalesce(sum(1 - completed), 0) AS failed FROM playback_events e ${where}`, range);
  const byItem = await all(`SELECT coalesce(nullif(item_label, ''), item_id) AS label, count(*) AS plays, sum(duration_ms) AS ms
    FROM playback_events e ${where} GROUP BY label ORDER BY plays DESC LIMIT 50`, range);
  const byDevice = await all(`SELECT d.name, count(*) AS plays, sum(e.duration_ms) AS ms
    FROM playback_events e JOIN devices d ON d.id = e.device_id ${where} GROUP BY e.device_id ORDER BY plays DESC`, range);
  const byDay = await all(`SELECT substr(started_at, 1, 10) AS day, count(*) AS plays, sum(duration_ms) AS ms
    FROM playback_events e ${where} GROUP BY day ORDER BY day`, range);

  res.json({ from, to, total, by_item: byItem, by_device: byDevice, by_day: byDay });
});

module.exports = router;
