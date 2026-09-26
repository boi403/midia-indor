# Sistema de Sinalização Digital — Contrato de Dados e API

Versão 1.0 · Base para backend (Node/Express + PostgreSQL), painel (React) e player (web em WebView).

---

## 1. Princípios que o contrato assume

1. **Revisão monotônica.** Toda conta tem um `content_revision` inteiro. Qualquer alteração de playlist, mídia, layout ou agendamento o incrementa. O player só precisa saber comparar dois números.
2. **WS notifica, HTTP entrega.** O socket nunca carrega conteúdo — só avisa que mudou.
3. **Manifesto é auto-contido.** Uma chamada devolve tudo que o player precisa para rodar as próximas 24h sem consultar mais nada.
4. **Dispositivo tem identidade própria.** Token de device, não de usuário. Revogável individualmente.

---

## 2. Modelo de dados (PostgreSQL)

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- conta e acesso ----------
CREATE TABLE accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  logo_url          TEXT,
  timezone          TEXT NOT NULL DEFAULT 'America/Cuiaba',
  content_revision  BIGINT NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email         CITEXT NOT NULL,
  password_hash TEXT NOT NULL,          -- Recomendado: usar Argon2id
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'operator',   -- owner | admin | operator
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, email)
);

-- ---------- telas ----------
CREATE TABLE device_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,                          -- Recepção, Café, Restaurante
  layout_id   UUID,                                   -- layout padrão do grupo
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID REFERENCES accounts(id) ON DELETE CASCADE,
  group_id        UUID REFERENCES device_groups(id) ON DELETE SET NULL,
  name            TEXT,                               -- "TV Recepção"
  pairing_code    CHAR(6) UNIQUE,                     -- NULL depois de pareado
  pairing_expires TIMESTAMPTZ,
  token_hash      TEXT,                               -- SHA-256 do token do device
  orientation     TEXT NOT NULL DEFAULT 'landscape',  -- landscape | portrait
  status          TEXT NOT NULL DEFAULT 'pending',    -- pending | active | disabled
  app_version     TEXT,
  last_seen_at    TIMESTAMPTZ,
  last_revision   BIGINT,                             -- revisão que a TV confirmou aplicar
  screen_w        INT,
  screen_h        INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON devices (account_id, status);

-- ---------- mídia ----------
CREATE TABLE media_assets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,          -- image | video
  filename     TEXT NOT NULL,
  storage_key  TEXT NOT NULL,          -- caminho no disco ou objeto S3/R2
  url          TEXT NOT NULL,
  mime         TEXT NOT NULL,
  bytes        BIGINT NOT NULL,
  width        INT,
  height       INT,
  duration_ms  INT,                    -- só vídeo
  checksum     TEXT NOT NULL,          -- SHA-256; player usa para invalidar cache
  thumb_url    TEXT,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- layout (zonas da tela) ----------
CREATE TABLE layouts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  orientation TEXT NOT NULL DEFAULT 'landscape',
  zones       JSONB NOT NULL,          -- ver §4
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- playlists ----------
CREATE TABLE playlists (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE playlist_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  asset_id    UUID REFERENCES media_assets(id) ON DELETE CASCADE,
  widget      JSONB,                   -- alternativa ao asset: {"type":"weather"}
  position    INT NOT NULL,
  duration_ms INT NOT NULL DEFAULT 10000,   -- ignorado em vídeo (usa duração real)
  starts_on   DATE,                    -- promoção com data de início
  ends_on     DATE,                    -- e de fim
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (playlist_id, position)
);

-- ---------- programação ----------
CREATE TABLE schedules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,           -- device | group | account
  target_id   UUID,
  priority    INT NOT NULL DEFAULT 0,  -- maior vence em conflito de horário
  days_of_week SMALLINT[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
  start_time  TIME NOT NULL DEFAULT '00:00',
  end_time    TIME NOT NULL DEFAULT '23:59',
  starts_on   DATE,
  ends_on     DATE,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX ON schedules (account_id, enabled);

-- ---------- comandos remotos ----------
CREATE TABLE device_commands (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id    UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  command      TEXT NOT NULL,          -- reboot | reload | clear_cache | screenshot | update_app
  payload      JSONB,
  issued_by    UUID REFERENCES users(id),
  issued_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  acked_at     TIMESTAMPTZ,
  result       JSONB
);
CREATE INDEX ON device_commands (device_id) WHERE acked_at IS NULL;

-- ---------- proof of play ----------
CREATE TABLE playback_events (
  id          BIGSERIAL PRIMARY KEY,
  device_id   UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  asset_id    UUID REFERENCES media_assets(id) ON DELETE SET NULL,
  playlist_id UUID,
  started_at  TIMESTAMPTZ NOT NULL,
  duration_ms INT NOT NULL,
  completed   BOOLEAN NOT NULL DEFAULT TRUE,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON playback_events (device_id, started_at DESC);
CREATE INDEX ON playback_events (asset_id, started_at DESC);

-- ---------- versões do APK ----------
CREATE TABLE app_releases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_code INT NOT NULL UNIQUE,
  version_name TEXT NOT NULL,
  apk_url      TEXT NOT NULL,
  checksum     TEXT NOT NULL,
  mandatory    BOOLEAN NOT NULL DEFAULT FALSE,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- RLS (Row Level Security) ----------
-- Sugestão de segurança para isolamento multi-tenant no Postgres
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_devices ON devices
  USING (account_id = current_setting('app.current_account_id', true)::uuid);
```

### Gatilho de revisão

```sql
CREATE OR REPLACE FUNCTION bump_revision() RETURNS TRIGGER AS $$
DECLARE aid UUID;
BEGIN
  aid := COALESCE(NEW.account_id, OLD.account_id);
  IF aid IS NULL THEN
    SELECT p.account_id INTO aid FROM playlists p
     WHERE p.id = COALESCE(NEW.playlist_id, OLD.playlist_id);
  END IF;
  UPDATE accounts SET content_revision = content_revision + 1 WHERE id = aid;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

-- aplicar em: media_assets, playlists, playlist_items, layouts, schedules, device_groups, devices
CREATE TRIGGER trg_rev AFTER INSERT OR UPDATE OR DELETE ON playlist_items
  FOR EACH ROW EXECUTE FUNCTION bump_revision();
```

Depois do `UPDATE accounts`, o backend emite `manifest.updated` no canal WS da conta. Um `NOTIFY` do Postgres resolve isso sem acoplar as camadas.

---

## 3. API

Base: `https://api.seudominio.com.br/v1`

### 3.1 Painel (Bearer JWT de usuário)

| Método | Rota | Uso |
|---|---|---|
| `POST` | `/auth/login` | `{email, password}` → `{access_token, refresh_token, user}` (Aplicar Rate Limit) |
| `POST` | `/auth/refresh` | rotação de refresh token |
| `GET` | `/devices` | lista com `status`, `last_seen_at`, `last_revision` |
| `POST` | `/devices/claim` | `{pairing_code, name, group_id}` → ativa a TV |
| `PATCH` | `/devices/:id` | renomear, mover de grupo, girar orientação |
| `DELETE` | `/devices/:id` | revoga o token do device |
| `POST` | `/devices/:id/commands` | `{command, payload}` |
| `GET` | `/groups` · `POST` · `PATCH` · `DELETE` | grupos de telas |
| `POST` | `/media/upload-url` | devolve URL pré-assinada (ou aceita multipart direto) |
| `POST` | `/media` | confirma upload, extrai dimensões/duração, gera thumb |
| `GET` | `/media` | paginado, filtro por `kind` |
| `GET/POST/PATCH/DELETE` | `/playlists` · `/playlists/:id/items` | CRUD |
| `GET/POST/PATCH/DELETE` | `/schedules` | programação |
| `GET/POST/PATCH` | `/layouts` | zonas |
| `GET` | `/reports/playback?from&to&group_by=asset\|device\|day` | proof-of-play |

### 3.2 Player (Bearer token de device)

**`POST /player/pair`** — sem auth. O player chama na primeira execução. (Aplicar Rate Limit estrito)
```json
→ {"hardware_id":"abc123","screen":{"w":1920,"h":1080},"app_version":"1.0.0"}
← {"pairing_code":"482915","expires_in":900,"poll_after_ms":5000}
```
O player mostra o código na tela e faz polling em `POST /player/pair` com o mesmo `hardware_id`. Quando o operador reivindica no painel, a resposta muda para:
```json
← {"device_token":"dvc_live_...","device_id":"uuid","account":{"name":"...","logo_url":"..."}}
```

**`GET /player/manifest?revision=47`** — o coração do sistema.
`304 Not Modified` se a revisão do player já é a atual. Senão, `200` com o corpo de §4.

**`POST /player/heartbeat`** a cada 60s:
```json
→ {"revision":47,"uptime_s":86400,"free_mb":1200,"current_asset_id":"uuid","errors":[]}
← {"revision":48,"commands":[{"id":"uuid","command":"reboot"}],"app_update":null}
```
O heartbeat é o *fallback* completo do WebSocket: se o socket morrer, nada quebra, só aumenta a latência de atualização.

**`POST /player/events`** — lote de proof-of-play, até 500 por chamada:
```json
→ {"events":[{"asset_id":"uuid","playlist_id":"uuid","started_at":"2026-08-03T14:02:11Z","duration_ms":10000,"completed":true}]}
← {"accepted":42}
```

**`POST /player/commands/:id/ack`** — confirma execução.

### 3.3 WebSocket

`wss://api.seudominio.com.br/ws/device?token=dvc_live_...`

Servidor → player:
```json
{"type":"manifest.updated","revision":48}
{"type":"command","id":"uuid","command":"reload"}
{"type":"ping","ts":1754236800}
```

Player → servidor: apenas `{"type":"pong"}` e `{"type":"status","revision":48}`.

Reconexão com backoff exponencial (1s → 2s → 4s … teto 60s) e jitter. Se o socket ficar 3 min sem `ping`, o player derruba e reconecta.

Canal do painel: `wss://.../ws/panel?token=<jwt>` recebe `device.online`, `device.offline`, `device.revision_applied` para o indicador ao vivo na listagem de telas.

---

## 4. Manifesto

Um único JSON que descreve tudo. É o contrato mais importante do projeto — o player não conhece o banco, só isto.

```jsonc
{
  "revision": 48,
  "generated_at": "2026-08-03T14:00:00Z",
  "device": {
    "id": "uuid",
    "name": "TV Recepção",
    "group": "Recepção",
    "orientation": "landscape",
    "timezone": "America/Cuiaba"
  },
  "branding": {
    "logo_url": "https://cdn/.../logo.png",
    "primary": "#0E4C68",
    "accent": "#C9A227"
  },

  // Zonas em porcentagem da tela. O player não precisa saber de pixels.
  "layout": {
    "id": "uuid",
    "zones": [
      { "id": "main",    "x": 0,  "y": 0,  "w": 72, "h": 88, "role": "playlist" },
      { "id": "side",    "x": 72, "y": 0,  "w": 28, "h": 88, "role": "widgets"  },
      { "id": "ticker",  "x": 0,  "y": 88, "w": 100,"h": 12, "role": "ticker"   }
    ]
  },

  // Playlists possíveis hoje; o player escolhe pelo relógio local.
  "playlists": [
    {
      "id": "uuid",
      "name": "Recepção — dia",
      "items": [
        { "id":"i1","type":"video","asset_id":"uuid",
          "url":"https://cdn/.../institucional.mp4","checksum":"sha256:...",
          "duration_ms": 42000 },
        { "id":"i2","type":"image","asset_id":"uuid",
          "url":"https://cdn/.../promo-spa.jpg","checksum":"sha256:...",
          "duration_ms": 10000, "window": {"from":"2026-08-01","to":"2026-08-31"} },
        { "id":"i3","type":"widget","widget":"qrcode",
          "duration_ms": 12000,
          "config": {"data":"WIFI:T:WPA;S:Araguaia_Hospedes;P:...;;",
                     "caption":"Wi-Fi dos hóspedes"} }
      ]
    }
  ],

  // Regra de escolha: primeiro que casar dia+hora, maior prioridade vence.
  "schedule": [
    { "playlist_id":"uuid","priority":10,"days":[1,2,3,4,5],
      "from":"06:00","to":"11:00" },
    { "playlist_id":"uuid2","priority":0,"days":[0,1,2,3,4,5,6],
      "from":"00:00","to":"23:59" }
  ],

  "widgets": {
    "clock":   { "enabled": true, "format": "HH:mm", "show_date": true },
    "weather": { "enabled": true, "lat": -20.42, "lon": -51.34, "refresh_min": 30 },
    "ticker":  { "enabled": true, "speed": 60,
                 "sources": ["notices"],
                 "notices": ["Café da manhã das 6h às 10h",
                             "Check-out até as 12h"] }
  },

  // Tudo que precisa estar em disco antes de aplicar a revisão.
  "precache": [
    { "url":"https://cdn/.../institucional.mp4","checksum":"sha256:...","bytes": 18400000 },
    { "url":"https://cdn/.../promo-spa.jpg","checksum":"sha256:...","bytes": 240000 }
  ],

  "policy": {
    "heartbeat_s": 60,
    "manifest_poll_s": 300,
    "apply_on_precache_complete": true,
    "reboot_daily_at": "04:30"
  }
}
```

**Regra de aplicação:** o player baixa tudo em `precache` para a Cache API *antes* de trocar de revisão. Se um item falhar, ele mantém a revisão anterior e reporta o erro no heartbeat. Tela preta nunca é uma opção.

---

## 5. Ordem de construção sugerida

| # | Entrega | Por quê primeiro |
|---|---|---|
| 1 | Player web contra manifesto estático | Valida layout, dayparting e cache sem backend nenhum |
| 2 | API mínima: `pair`, `manifest`, `heartbeat` | Já dá para parear a primeira TV de verdade |
| 3 | Shell Android (WebView + boot + watchdog) | A partir daqui a TV liga sozinha |
| 4 | Painel: upload, playlist, atribuição a grupo | O operador do hotel assume |
| 5 | WebSocket + comandos remotos | Latência cai de 5 min para 2 s |
| 6 | Proof-of-play e relatórios | Habilita a venda de cota depois |

---

## 6. Notas de operação

- **Hospedagem:** para 5 telas, uma VPS de 2 vCPU/4 GB com Docker Compose (api + postgres + nginx + minio) sobra. O servidor do hotel serve como espelho de mídia na LAN se a banda apertar — mas não como origem: se ele cair, ninguém acessa o painel de fora.
- **Vídeo:** transcodifique no upload para H.264 baseline/main, 1080p, ≤ 6 Mbps. TV Box barato engasga em HEVC e em 4K.
- **Relógio:** TV Box perde hora sem rede. Force NTP no boot e trate o dayparting com tolerância — se o relógio estiver claramente errado, caia na playlist padrão em vez de na de madrugada.
- **Segurança:** token de device é opaco, guardado com hash no banco, escopo somente-leitura de manifesto + escrita de eventos. Um APK extraído não dá acesso ao painel.
