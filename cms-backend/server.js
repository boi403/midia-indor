// CMS Mídia Indoor 2.0 — servidor único: API do painel, API do player, WebSocket,
// arquivos enviados, player da TV (/tv) e, se compilado, o painel (cms-admin/dist).
require('./lib/logger').install();   // antes de tudo: registra também o início em logs/
const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const { ready } = require('./database');
const { requireAuth } = require('./lib/auth');
const { HttpError, setNotifier } = require('./lib/common');
const realtime = require('./lib/realtime');
const presence = require('./lib/presence');
const finance = require('./lib/finance');
const backup = require('./lib/backup');
const monitor = require('./lib/monitor');

process.on('uncaughtException', monitor.handleFatal);
process.on('unhandledRejection', monitor.handleRejection);

const app = express();
app.set('trust proxy', 'loopback');
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const ROOT = path.join(__dirname, '..');
const PLAYER_FILE = path.join(ROOT, 'signage-player.html');

// ---------- arquivos ----------
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { maxAge: '7d', immutable: true }));

// Player da TV: página leve e independente do painel.
app.get(['/tv', '/tv/'], (req, res) => res.sendFile(PLAYER_FILE));
// Endereço antigo das TVs da v1 (continua funcionando sem pareamento).
// Só os arquivos do player são expostos: antes a pasta inteira ficava pública,
// incluindo o banco de dados.
app.get('/player-app/signage-player.html', (req, res) => res.sendFile(PLAYER_FILE));
app.get('/player-app/jsmpeg.min.js', (req, res) => res.sendFile(path.join(ROOT, 'jsmpeg.min.js')));

// ---------- APIs ----------
app.use('/v1/player', require('./routes/player').router);
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', requireAuth, require('./routes/admin').router);
app.use('/api/dashboard', requireAuth, require('./routes/dashboard'));
app.use('/api/devices', requireAuth, require('./routes/devices'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api', require('./routes/programming'));
app.use('/api', require('./routes/content'));
app.get('/health', (req, res) => res.json({ ok: true }));

// ---------- painel compilado (npm run build no cms-admin) ----------
const ADMIN_DIST = path.join(ROOT, 'cms-admin', 'dist');
if (fs.existsSync(path.join(ADMIN_DIST, 'index.html'))) {
  app.use(express.static(ADMIN_DIST));
  app.get(/^\/(?!api|v1|ws|uploads|tv).*/, (req, res) => res.sendFile(path.join(ADMIN_DIST, 'index.html')));
}

app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Arquivo grande demais.' : err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' });
  console.error(`[erro] ${req.method} ${req.originalUrl}:`, err);
  monitor.reportRequestError(req, err);
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

const PORT = Number(process.env.PORT) || 3000;
ready.then(() => {
  const server = http.createServer(app);
  // registrado antes do WebSocket, que também escuta erros do servidor
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      // código 2: o iniciar-tudo.bat entende que já há um servidor e não fica reiniciando
      console.error(`[servidor] a porta ${PORT} já está em uso: o servidor provavelmente já está rodando (tarefa automática do Windows?).`);
      process.exit(2);
    }
    throw err;
  });
  realtime.attach(server);
  setNotifier((evt) => realtime.notifyManifest(evt).catch(e => console.error('[ws]', e.message)));
  presence.start();
  finance.start();
  server.listen(PORT, () => {
    monitor.start();
    backup.start();
    console.log(`CMS Mídia Indoor 2.0 rodando na porta ${PORT}`);
    console.log(`  Player da TV:  http://<ip-deste-servidor>:${PORT}/tv`);
    console.log(`  API do painel: http://localhost:${PORT}/api`);
  });
});
