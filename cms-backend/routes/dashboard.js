// Painéis de visão geral: administrador (todos os clientes) e cliente (só o próprio).
const express = require('express');
const { all, get } = require('../database');
const { requireAdmin, scopeClientId } = require('../lib/auth');
const { clientPlan, HttpError } = require('../lib/common');
const { localStamp } = require('../lib/manifest');
const { listClients } = require('./admin');

const router = express.Router();

// Série de 24h em buckets de 30 min (máximo de TVs online em cada janela).
async function onlineSeries(clientId) {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const rows = await all(`SELECT ts, sum(online) AS online, sum(total) AS total FROM online_samples
    WHERE ts >= ? ${clientId ? 'AND client_id = ?' : ''} GROUP BY ts ORDER BY ts`,
  clientId ? [since.toISOString(), clientId] : [since.toISOString()]);
  const bucketMs = 30 * 60 * 1000;
  const start = Math.floor(since.getTime() / bucketMs) * bucketMs;
  const buckets = [];
  for (let t = start; t <= Date.now(); t += bucketMs) buckets.push({ t: new Date(t).toISOString(), online: null, total: null });
  for (const r of rows) {
    const i = Math.floor((new Date(r.ts).getTime() - start) / bucketMs);
    const b = buckets[i];
    if (!b) continue;
    b.online = Math.max(b.online ?? 0, r.online);
    b.total = Math.max(b.total ?? 0, r.total);
  }
  return buckets;
}

async function activeCampaigns(clientId) {
  const rows = await all(`SELECT cp.*, c.timezone, c.name AS client_name FROM campaigns cp JOIN clients c ON c.id = cp.client_id
    WHERE cp.enabled = 1 ${clientId ? 'AND cp.client_id = ?' : ''}`, clientId ? [clientId] : []);
  const now = new Date();
  return rows.filter(r => {
    const local = localStamp(now, r.timezone || 'America/Cuiaba');
    return r.start_at <= local && r.end_at >= local;
  }).map(r => ({ ...r, today: localStamp(now, r.timezone || 'America/Cuiaba').slice(0, 10) }));
}

function minutesSince(iso) {
  return iso ? Math.round((Date.now() - new Date(iso).getTime()) / 60000) : null;
}

router.get('/admin', requireAdmin, async (req, res) => {
  const clients = await listClients();
  const devices = await all(`SELECT d.id, d.client_id, d.name, d.location, d.online, d.status, d.orientation, d.reported_orientation,
      d.offline_since, d.last_seen_at, d.current_item, d.current_playlist, c.name AS client_name
    FROM devices d LEFT JOIN clients c ON c.id = d.client_id ORDER BY c.name, d.name`);
  const registered = devices.filter(d => d.status !== 'pending');
  const active = registered.filter(d => d.status === 'active');
  const campaigns = await activeCampaigns(null);

  const alerts = [];
  for (const d of active.filter(x => !x.online)) {
    const mins = minutesSince(d.offline_since || d.last_seen_at);
    alerts.push({ level: 'danger', kind: 'offline', text: `${d.name} (${d.client_name}) offline${mins != null ? ` há ${fmtMinutes(mins)}` : ' — nunca conectou'}`, device_id: d.id });
  }
  for (const c of clients) {
    if (c.status === 'active' && c.tv_limit && c.tvs >= Math.ceil(c.tv_limit * 0.9)) {
      alerts.push({ level: 'warning', kind: 'limit', text: `Cliente ${c.name} está usando ${c.tvs}/${c.tv_limit} TVs`, client_id: c.id });
    }
    if (c.payment_status === 'atrasado') alerts.push({ level: 'danger', kind: 'payment', text: `Pagamento de ${c.name} em atraso (vencimento dia ${c.due_day})`, client_id: c.id });
  }
  for (const cp of campaigns) {
    if (cp.end_at.slice(0, 10) === cp.today) alerts.push({ level: 'warning', kind: 'campaign', text: `Campanha "${cp.name}" (${cp.client_name}) termina hoje às ${cp.end_at.slice(11, 16)}` });
  }
  const pending = devices.filter(d => d.status === 'pending').length;
  if (pending) alerts.push({ level: 'info', kind: 'pairing', text: `${pending} TV(s) exibindo código de ativação aguardando vínculo` });

  res.json({
    stats: {
      clients: clients.length,
      paying: clients.filter(c => c.status === 'active' && c.fee_cents > 0).length,
      revenue_cents: clients.filter(c => c.status === 'active').reduce((s, c) => s + c.fee_cents, 0),
      tvs: registered.length,
      online: active.filter(d => d.online).length,
      offline: active.filter(d => !d.online).length,
      blocked: registered.filter(d => d.status === 'blocked').length,
      campaigns: campaigns.length,
      pending,
    },
    series: await onlineSeries(null),
    devices: registered,
    clients,
    alerts,
  });
});

router.get('/client', async (req, res) => {
  const clientId = scopeClientId(req);
  if (!clientId) throw new HttpError(400, 'Selecione um cliente.');
  const c = await clientPlan(clientId);
  const devices = await all(`SELECT d.id, d.name, d.location, d.online, d.status, d.orientation, d.reported_orientation, d.offline_since, d.last_seen_at,
      d.current_item, d.current_playlist, p.name AS playlist_name
    FROM devices d LEFT JOIN playlists p ON p.id = d.playlist_id WHERE d.client_id = ? AND d.status != 'pending' ORDER BY d.name`, [clientId]);
  const counts = await get(`SELECT (SELECT count(*) FROM midia WHERE client_id = ?) AS media,
    (SELECT count(*) FROM playlists WHERE client_id = ?) AS playlists,
    (SELECT count(*) FROM campaigns WHERE client_id = ? AND enabled = 1) AS campaigns_total`, [clientId, clientId, clientId]);
  const campaigns = await activeCampaigns(clientId);
  const alerts = devices.filter(d => d.status === 'active' && !d.online).map(d => {
    const mins = minutesSince(d.offline_since || d.last_seen_at);
    return { level: 'danger', text: `${d.name} offline${mins != null ? ` há ${fmtMinutes(mins)}` : ' — nunca conectou'}`, device_id: d.id };
  });
  for (const cp of campaigns) if (cp.end_at.slice(0, 10) === cp.today) alerts.push({ level: 'warning', text: `Campanha "${cp.name}" termina hoje às ${cp.end_at.slice(11, 16)}` });

  res.json({
    client: {
      id: c.id, name: c.name, plan: c.plan_name, tv_limit: c.tv_limit, max_media: c.max_media, max_playlists: c.max_playlists,
      features: { scheduling: !!c.feat_scheduling, cameras: !!c.feat_cameras, reports: !!c.feat_reports, api: !!c.feat_api },
    },
    stats: {
      tvs: devices.length,
      online: devices.filter(d => d.status === 'active' && d.online).length,
      offline: devices.filter(d => d.status === 'active' && !d.online).length,
      media: counts.media, playlists: counts.playlists, campaigns: campaigns.length,
    },
    devices,
    campaigns,
    series: await onlineSeries(clientId),
    alerts,
  });
});

function fmtMinutes(m) {
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)}h ${m % 60}min`;
  return `${Math.floor(m / 1440)} dia(s)`;
}

module.exports = router;
