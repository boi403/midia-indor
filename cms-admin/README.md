# CMS Mídia Indoor 2.0

CMS de TV corporativa / mídia indoor para vários clientes e várias TVs.

```
midia-indor/
├── cms-backend/          API (Express + SQLite), WebSocket, player e painel compilado
├── cms-admin/            Painel (React + Vite): /login, /admin/*, /cliente/*
├── signage-player.html   Player leve da TV, servido em /tv
├── iniciar-tudo.bat      Instala dependências, compila o painel e sobe o servidor
└── abrir-tela.bat        Abre o player em modo quiosque nesta máquina
```

## Rodando

```bash
cd cms-backend && npm install && npm start      # http://localhost:3000
cd cms-admin   && npm install && npm run build  # o backend passa a servir o painel
```

Em desenvolvimento: `npm run dev` no `cms-admin` (porta 5173, usa a API na porta 3000).

Na primeira execução o backend cria os usuários:

| Perfil | E-mail | Senha |
|---|---|---|
| Administrador | `admin@midiaindoor.local` | `admin123` |
| Cliente nº 1 | `hotel@midiaindoor.local` | `hotel123` |

Troque as duas em **Minha conta**.

## Ativando uma TV

1. No navegador da TV/TV Box, abra `http://IP-DO-SERVIDOR:3000/tv`.
2. A TV mostra um código como `TV-7F42-K9P1`.
3. No painel: **Dispositivos → Adicionar dispositivo**. Informe o código, o cliente, o nome, o local, a orientação e a playlist.
4. A TV entra no ar em segundos. A partir daí ela manda heartbeat a cada 20 s e fica conectada por WebSocket.

As TVs da v1 (`/player-app/signage-player.html`) continuam funcionando sem código, como **Tela Principal (legado)**.

## Como a TV decide o que exibir

Prioridade, da maior para a menor:

1. Câmera fixada (na TV ou em todas as TVs do cliente)
2. **Exibir agora**, com tempo limitado
3. Campanhas agendadas (período, dias da semana e janela de horário; a de maior prioridade vence)
4. Playlist da TV (ou a playlist padrão do cliente)

A escolha acontece no próprio player, pelo relógio local. Por isso, quando uma campanha acaba, a TV volta sozinha à programação normal, mesmo sem internet.

## Migração da v1

Na primeira execução, o banco antigo é migrado automaticamente:

- o conteúdo existente vira do cliente nº 1 (plano Empresarial, 5 TVs);
- é criada uma **Playlist Principal** com o que já rodava;
- as URLs de upload passam a ser relativas, para funcionar a partir de outras máquinas da rede.

Há uma cópia da v1 (código e `cms.db`) em `../_backup-v1/`.
