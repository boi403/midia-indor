// Banco SQLite do CMS Mídia Indoor 2.0.
//
// Multi-cliente: todo conteúdo (mídias, slides, notícias, câmeras, playlists,
// campanhas) pertence a um cliente (clients.id). Bancos da versão 1 (um único
// hotel, sem clientes) são migrados automaticamente na primeira execução: o
// conteúdo existente vira do cliente nº 1 e ganha uma "Playlist Principal".
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const dbPath = process.env.CMS_DB ? path.resolve(process.env.CMS_DB) : path.resolve(__dirname, 'cms.db');
const db = new sqlite3.Database(dbPath);

const run = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) reject(err); else resolve({ lastID: this.lastID, changes: this.changes });
  });
});
const get = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
});
const all = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
});

async function columns(table) {
  return (await all(`PRAGMA table_info(${table})`)).map(c => c.name);
}
async function addColumn(table, name, def) {
  if (!(await columns(table)).includes(name)) await run(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
}

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

async function migrate() {
  await run('PRAGMA foreign_keys = ON');
  await run('PRAGMA journal_mode = WAL');

  // ---------- legado (v1) ----------
  await run(`CREATE TABLE IF NOT EXISTS configuracoes (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT NOT NULL, tagline TEXT, primary_color TEXT NOT NULL, accent_color TEXT NOT NULL,
    orientation TEXT NOT NULL, weather_lat REAL, weather_lon REAL, weather_city TEXT, logo_url TEXT
  )`);
  await addColumn('configuracoes', 'news_feed_url', 'TEXT');
  await addColumn('configuracoes', 'pinned_camera_id', 'INTEGER');

  await run(`CREATE TABLE IF NOT EXISTS midia (
    id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, filename TEXT NOT NULL, url TEXT NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 10000, position INTEGER NOT NULL DEFAULT 0, title TEXT, description TEXT
  )`);
  await run(`CREATE TABLE IF NOT EXISTS slides (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, variant TEXT, kick TEXT, title TEXT, text TEXT,
    duration_ms INTEGER NOT NULL DEFAULT 10000, widget TEXT, config_json TEXT, position INTEGER NOT NULL DEFAULT 0
  )`);
  await run(`CREATE TABLE IF NOT EXISTS noticias (
    id INTEGER PRIMARY KEY AUTOINCREMENT, texto TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0
  )`);
  await run(`CREATE TABLE IF NOT EXISTS cameras (
    id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, url TEXT NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 15000, position INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1
  )`);
  await addColumn('cameras', 'enabled', 'INTEGER NOT NULL DEFAULT 1');

  // ---------- SaaS ----------
  await run(`CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    max_tvs INTEGER,            -- NULL = ilimitado
    max_media INTEGER,
    max_playlists INTEGER,
    price_cents INTEGER NOT NULL DEFAULT 0,
    feat_scheduling INTEGER NOT NULL DEFAULT 0,
    feat_cameras INTEGER NOT NULL DEFAULT 0,
    feat_reports INTEGER NOT NULL DEFAULT 0,
    feat_api INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await run(`CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    plan_id INTEGER REFERENCES plans(id),
    max_tvs_override INTEGER,
    monthly_fee_cents INTEGER NOT NULL DEFAULT 0,
    due_day INTEGER NOT NULL DEFAULT 10,
    status TEXT NOT NULL DEFAULT 'active',      -- active | inactive
    last_payment_at TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    notes TEXT,
    content_revision INTEGER NOT NULL DEFAULT 1,
    tagline TEXT,
    primary_color TEXT NOT NULL DEFAULT '#0E4C68',
    accent_color TEXT NOT NULL DEFAULT '#C9A227',
    logo_url TEXT,
    weather_lat REAL,
    weather_lon REAL,
    weather_city TEXT,
    news_feed_url TEXT,
    timezone TEXT NOT NULL DEFAULT 'America/Cuiaba',
    pinned_camera_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'client',        -- admin | client
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    active INTEGER NOT NULL DEFAULT 1,
    last_login_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await run(`CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await run(`CREATE TABLE IF NOT EXISTS playlist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,                 -- media | slide | camera | news
    ref_id TEXT,                        -- id da mídia/slide/câmera (news não usa)
    portrait_ref_id TEXT,               -- mídia alternativa para TVs verticais
    duration_ms INTEGER NOT NULL DEFAULT 10000,
    position INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    repeat INTEGER NOT NULL DEFAULT 1,  -- quantas vezes aparece em cada ciclo
    start_date TEXT,                    -- YYYY-MM-DD
    end_date TEXT,
    start_time TEXT,                    -- HH:MM
    end_time TEXT
  )`);

  await run(`CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    name TEXT,
    location TEXT,
    orientation TEXT NOT NULL DEFAULT 'auto',   -- auto | landscape | portrait
    resolution TEXT NOT NULL DEFAULT '1920x1080',
    playlist_id INTEGER REFERENCES playlists(id) ON DELETE SET NULL,
    volume INTEGER NOT NULL DEFAULT 0,
    brightness INTEGER NOT NULL DEFAULT 100,
    status TEXT NOT NULL DEFAULT 'pending',     -- pending | active | blocked
    pairing_code TEXT UNIQUE,
    pairing_expires TEXT,
    hardware_id TEXT,
    token_hash TEXT UNIQUE,
    pair_token TEXT,                            -- entregue uma única vez à TV após o vínculo
    config_revision INTEGER NOT NULL DEFAULT 1,
    pinned_camera_id INTEGER,
    override_playlist_id INTEGER,
    override_until TEXT,
    online INTEGER NOT NULL DEFAULT 0,
    online_since TEXT,
    offline_since TEXT,
    last_seen_at TEXT,
    last_revision TEXT,
    app_version TEXT,
    ip TEXT,
    screen_w INTEGER,
    screen_h INTEGER,
    reported_orientation TEXT,
    uptime_s INTEGER,
    current_item TEXT,
    current_playlist TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  await run(`CREATE TABLE IF NOT EXISTS device_commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    command TEXT NOT NULL,
    payload TEXT,
    issued_by INTEGER,
    issued_at TEXT NOT NULL DEFAULT (datetime('now')),
    delivered_at TEXT,
    acked_at TEXT
  )`);

  await run(`CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    start_at TEXT NOT NULL,             -- YYYY-MM-DDTHH:MM (horário local da TV)
    end_at TEXT NOT NULL,
    days TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
    daily_from TEXT NOT NULL DEFAULT '00:00',
    daily_to TEXT NOT NULL DEFAULT '23:59',
    priority INTEGER NOT NULL DEFAULT 10,
    all_devices INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await run(`CREATE TABLE IF NOT EXISTS campaign_devices (
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    PRIMARY KEY (campaign_id, device_id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS playback_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    client_id INTEGER,
    item_id TEXT,
    item_label TEXT,
    playlist_id TEXT,
    started_at TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    completed INTEGER NOT NULL DEFAULT 1,
    received_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await run('CREATE INDEX IF NOT EXISTS idx_pb_device ON playback_events (device_id, started_at)');
  await run('CREATE INDEX IF NOT EXISTS idx_pb_client ON playback_events (client_id, started_at)');

  await run(`CREATE TABLE IF NOT EXISTS online_samples (
    ts TEXT NOT NULL,
    client_id INTEGER NOT NULL,
    online INTEGER NOT NULL,
    total INTEGER NOT NULL
  )`);
  await run('CREATE INDEX IF NOT EXISTS idx_samples ON online_samples (ts)');

  // conteúdo passa a ter dono
  for (const t of ['midia', 'slides', 'noticias', 'cameras']) await addColumn(t, 'client_id', 'INTEGER');
  await addColumn('midia', 'orientation', "TEXT NOT NULL DEFAULT 'any'");
  await addColumn('midia', 'bytes', 'INTEGER');
  await addColumn('midia', 'original_name', 'TEXT');
  await addColumn('slides', 'orientation', "TEXT NOT NULL DEFAULT 'any'");
  await addColumn('noticias', 'enabled', 'INTEGER NOT NULL DEFAULT 1');
  // início da queda já avisada no Telegram (NULL = sem alerta pendente)
  await addColumn('devices', 'alert_offline_since', 'TEXT');

  await seed();
}

async function seed() {
  if (!(await get('SELECT id FROM plans LIMIT 1'))) {
    await run(`INSERT INTO plans (name, max_tvs, max_media, max_playlists, price_cents, feat_scheduling, feat_cameras, feat_reports, feat_api)
      VALUES ('Básico', 2, 100, 5, 9900, 0, 0, 0, 0)`);
    await run(`INSERT INTO plans (name, max_tvs, max_media, max_playlists, price_cents, feat_scheduling, feat_cameras, feat_reports, feat_api)
      VALUES ('Profissional', 10, 500, 20, 29900, 1, 0, 1, 0)`);
    await run(`INSERT INTO plans (name, max_tvs, max_media, max_playlists, price_cents, feat_scheduling, feat_cameras, feat_reports, feat_api)
      VALUES ('Empresarial', NULL, NULL, NULL, 79900, 1, 1, 1, 1)`);
  }

  // Cliente nº 1 herda a configuração do banco v1 (o hotel original).
  if (!(await get('SELECT id FROM clients LIMIT 1'))) {
    const cfg = await get('SELECT * FROM configuracoes WHERE id = 1');
    const plan = await get("SELECT id FROM plans WHERE name = 'Empresarial'");
    await run(`INSERT INTO clients (id, name, plan_id, max_tvs_override, tagline, primary_color, accent_color, logo_url,
        weather_lat, weather_lon, weather_city, news_feed_url, pinned_camera_id, last_payment_at)
      VALUES (1, ?, ?, 5, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`, [
      cfg?.name || 'Araguaia Palace Hotel', plan?.id || null, cfg?.tagline || 'HOTEL',
      cfg?.primary_color || '#0E4C68', cfg?.accent_color || '#C9A227', cfg?.logo_url || null,
      cfg?.weather_lat ?? -20.42, cfg?.weather_lon ?? -51.34, cfg?.weather_city || '',
      cfg?.news_feed_url || null, cfg?.pinned_camera_id || null,
    ]);
    const hadContent = await get('SELECT (SELECT count(*) FROM midia) + (SELECT count(*) FROM slides) + (SELECT count(*) FROM cameras) AS n');
    if (!hadContent.n) await seedDemoContent();
  }

  for (const t of ['midia', 'slides', 'noticias', 'cameras']) await run(`UPDATE ${t} SET client_id = 1 WHERE client_id IS NULL`);

  // URLs absolutas "http://localhost:3000/uploads/..." quebravam em TVs da rede
  // local. Guardamos o caminho relativo e o servidor monta a URL por requisição.
  await run("UPDATE midia SET url = substr(url, instr(url, '/uploads/')) WHERE url LIKE 'http%/uploads/%'");
  await run("UPDATE clients SET logo_url = substr(logo_url, instr(logo_url, '/uploads/')) WHERE logo_url LIKE 'http%/uploads/%'");

  // Playlist Principal com o conteúdo que antes rodava direto na TV.
  const clientsWithoutPlaylist = await all('SELECT id FROM clients WHERE id NOT IN (SELECT client_id FROM playlists)');
  for (const c of clientsWithoutPlaylist) {
    const pl = await run('INSERT INTO playlists (client_id, name, is_default) VALUES (?, ?, 1)', [c.id, 'Playlist Principal']);
    let pos = 0;
    for (const m of await all('SELECT id, duration_ms FROM midia WHERE client_id = ? ORDER BY position, id', [c.id])) {
      await run('INSERT INTO playlist_items (playlist_id, kind, ref_id, duration_ms, position) VALUES (?, ?, ?, ?, ?)', [pl.lastID, 'media', String(m.id), m.duration_ms, pos++]);
    }
    for (const s of await all('SELECT id, duration_ms FROM slides WHERE client_id = ? ORDER BY position', [c.id])) {
      await run('INSERT INTO playlist_items (playlist_id, kind, ref_id, duration_ms, position) VALUES (?, ?, ?, ?, ?)', [pl.lastID, 'slide', String(s.id), s.duration_ms, pos++]);
    }
    for (const cam of await all('SELECT id, duration_ms, enabled FROM cameras WHERE client_id = ? ORDER BY position, id', [c.id])) {
      await run('INSERT INTO playlist_items (playlist_id, kind, ref_id, duration_ms, position, enabled) VALUES (?, ?, ?, ?, ?, ?)', [pl.lastID, 'camera', String(cam.id), cam.duration_ms, pos++, cam.enabled ? 1 : 0]);
    }
  }

  // As TVs da v1 abrem /player-app/signage-player.html sem pareamento e se
  // identificam com o token fixo "dev_local". Esse token vira um dispositivo de
  // verdade do cliente nº 1, para continuarem funcionando e aparecerem no painel.
  if (!(await get('SELECT id FROM devices WHERE token_hash = ?', [sha256('dev_local')]))) {
    await run(`INSERT INTO devices (client_id, name, location, orientation, status, token_hash)
      VALUES (1, 'Tela Principal (legado)', 'Recepção', ?, 'active', ?)`, [
      (await get('SELECT orientation FROM configuracoes WHERE id = 1'))?.orientation || 'landscape', sha256('dev_local'),
    ]);
  }

  if (!(await get("SELECT id FROM users WHERE role = 'admin' LIMIT 1"))) {
    await run(`INSERT INTO users (name, email, password_hash, role) VALUES ('Administrador', 'admin@midiaindoor.local', ?, 'admin')`, [bcrypt.hashSync('admin123', 10)]);
    await run(`INSERT OR IGNORE INTO users (name, email, password_hash, role, client_id) VALUES ('Hotel Araguaia', 'hotel@midiaindoor.local', ?, 'client', 1)`, [bcrypt.hashSync('hotel123', 10)]);
    console.log('\n[setup] Usuários iniciais criados:');
    console.log('        admin@midiaindoor.local / admin123   (administrador)');
    console.log('        hotel@midiaindoor.local / hotel123   (cliente nº 1)');
    console.log('        Troque as senhas em "Minha conta" após o primeiro login.\n');
  }
}

async function seedDemoContent() {
  const slides = [
    ['i1', 'slide', 'institucional', 'Bem-vindo', 'Sua estadia começa <em>agora</em>.', 'Recepção 24 horas. Qualquer necessidade, é só chamar — ramal 9.', 9000, null, null, 1],
    ['i2', 'slide', 'promo', 'Promoção', 'Segunda diária com <em>30% off</em>', 'Válido para reservas feitas diretamente na recepção.', 8000, null, null, 2],
    ['i3', 'widget', null, null, null, null, 10000, 'qrcode', JSON.stringify({ data: 'WIFI:T:WPA;S:Hospedes;P:bemvindo2026;;', title: 'Wi-Fi dos hóspedes', caption: 'Aponte a câmera para conectar' }), 3],
    ['i4', 'slide', 'aviso', 'Café da manhã', '6h às 10h<br>no <em>salão térreo</em>', 'Aos domingos, servido até as 10h30.', 8000, null, null, 4],
  ];
  for (const s of slides) {
    await run('INSERT INTO slides (id, type, variant, kick, title, text, duration_ms, widget, config_json, position, client_id) VALUES (?,?,?,?,?,?,?,?,?,?,1)', s);
  }
  if (!(await get('SELECT id FROM noticias LIMIT 1'))) {
    for (const t of ['Café da manhã das 6h às 10h no salão térreo', 'Check-out até as 12h', 'Wi-Fi liberado em todas as áreas comuns']) {
      await run('INSERT INTO noticias (texto, client_id) VALUES (?, 1)', [t]);
    }
  }
}

const ready = migrate().catch((err) => {
  console.error('Falha ao preparar o banco de dados:', err);
  process.exit(1);
});

module.exports = { db, run, get, all, ready, sha256 };
