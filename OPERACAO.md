# Operação do CMS Mídia Indoor

Como deixar o sistema rodando sozinho e cuidar dele de longe.

## 1. Início automático com o Windows

Dê dois cliques em **`instalar-inicio-automatico.bat`** e aceite o pedido de administrador. A partir daí:

- o servidor sobe sozinho quando o PC liga, mesmo sem ninguém fazer login;
- se o servidor cair, ele volta em 5 segundos;
- o PC deixa de entrar em suspensão quando está na tomada.

| Arquivo | Para que serve |
|---|---|
| `parar-servidor.bat` | para o servidor (ex.: antes de restaurar um backup) |
| `remover-inicio-automatico.bat` | desfaz a instalação |
| `iniciar-tudo.bat` | roda manualmente, com janela (sem o início automático) |

Rodando como tarefa, o servidor não abre janela. O que ele registra fica em `cms-backend\logs\servidor-AAAA-MM-DD.log`, e cada arquivo é guardado por 30 dias.

## 2. Alertas no Telegram

1. No Telegram, abra o **@BotFather**, envie `/newbot` e siga os passos. Ele devolve um **token**, algo como `123456:ABC-...`.
2. Cole o token em `cms-backend\config.json`, no campo `"telegram" → "token"`.
3. Abra o seu bot no Telegram e envie **oi**.
4. Na pasta `cms-backend`, rode `node ferramentas.js descobrir-chat` e copie o número para `"chat_id"`.
5. Rode `node ferramentas.js testar-telegram`. A mensagem de teste deve chegar.

Para um grupo receber os alertas, adicione o bot ao grupo, mande uma mensagem lá e repita o passo 4.

O servidor relê o `config.json` a cada minuto, então não precisa reiniciar. Estes são os avisos que você recebe:

| Aviso | Quando |
|---|---|
| 🔴 TV offline / 🟢 TV voltou | a TV ficou fora mais de `tv_offline_minutos` (padrão: 5). Várias TVs caindo juntas chegam numa mensagem só. |
| 🟠 Servidor reiniciado | depois de uma queda de energia, de um desligamento forçado ou de um erro |
| 🔴 Erro grave / 🟠 Erro interno | falhas no servidor, com no máximo um aviso a cada 30 min |
| 🟠 Pouco espaço em disco | o espaço livre caiu abaixo de `disco_minimo_gb` |
| 🔴 Backup falhou | o backup diário não foi feito |
| 📊 Resumo do dia | todo dia na `resumo_diario_hora` (padrão: 8h). Use `null` para desligar. |

Se a internet cair, os avisos ficam guardados e são enviados assim que a conexão voltar.

## 3. Aviso de PC desligado ou sem internet

O servidor não consegue avisar se o próprio PC está desligado. Para cobrir esse caso:

1. Crie uma conta grátis em **https://healthchecks.io** e crie um "check" com *Period* de 5 minutos e *Grace* de 10 minutos.
2. Em *Integrations*, conecte o Telegram.
3. Copie a URL de ping (`https://hc-ping.com/...`) para `"healthchecks_url"` no `config.json`.

O servidor faz um ping a cada 5 minutos. Se os pings pararem, o healthchecks.io avisa você.

## 4. Backup

- **Automático:** todo dia às `backup.hora` (padrão: 3h). Se o PC estiver desligado nesse horário, o backup é feito assim que ele voltar.
- **Onde fica:** `cms-backend\backups\cms-AAAA-MM-DD_HHMM.db`. Os backups são guardados por `manter_dias` dias, e as 3 cópias mais recentes nunca são apagadas.
- **Cópia fora do PC:** instale o Google Drive para computador e coloque em `"copia_extra"` uma pasta dele, por exemplo `"G:\Meu Drive\Backup CMS"`. As barras vão dobradas no JSON. Com `"copiar_uploads": true`, as mídias (vídeos e imagens) também são copiadas; só os arquivos novos são enviados.
- **Backup na hora:** `node ferramentas.js backup`

**Para restaurar um backup:**
1. Rode `parar-servidor.bat`.
2. Em `cms-backend`, apague `cms.db-wal` e `cms.db-shm`, se existirem.
3. Copie o backup escolhido por cima de `cms.db`.
4. Inicie de novo: reinicie o PC ou rode `schtasks /Run /TN "CMS Midia Indoor"`.

## 5. Acesso remoto (painel de qualquer lugar)

Use o **Tailscale**. É grátis, cria uma VPN sem abrir portas no roteador e não expõe o servidor na internet.

1. Instale em https://tailscale.com/download, tanto neste PC quanto no seu celular ou notebook, e entre com a mesma conta nos dois.
2. No celular ou notebook, abra `http://<nome-deste-pc>:3000`. O Tailscale mostra o nome do PC.

**Não** redirecione a porta 3000 no roteador.

## 6. Comandos úteis (dentro de `cms-backend`)

```
node ferramentas.js status            TVs, último backup, disco
node ferramentas.js backup            backup agora
node ferramentas.js testar-telegram   testa os alertas
node ferramentas.js descobrir-chat    descobre o chat_id
```

## Segurança

- Troque as senhas padrão (`admin123`, `hotel123`) em **Minha conta**.
- O `config.json` contém o token do bot. Não compartilhe esse arquivo.
