// Comandos de manutenção, rodados à parte do servidor (pode estar no ar):
//   node ferramentas.js testar-telegram   envia uma mensagem de teste
//   node ferramentas.js descobrir-chat    mostra o chat_id de quem falou com o bot
//   node ferramentas.js backup            faz um backup agora
//   node ferramentas.js status            TVs, último backup e disco
const { ready } = require('./database');
const config = require('./lib/config');
const alerts = require('./lib/alerts');

async function main(cmd) {
  await ready;
  switch (cmd) {
    case 'testar-telegram': {
      const cfg = config.get().telegram;
      if (!cfg.token) return fail(`Preencha "telegram.token" em ${config.FILE}.`);
      if (!cfg.chat_id) return fail('Falta "telegram.chat_id". Mande uma mensagem ao bot e rode: node ferramentas.js descobrir-chat');
      const ok = await alerts.send('✅ Teste do CMS Mídia Indoor: os alertas estão funcionando.');
      return ok ? console.log('Mensagem enviada. Confira o Telegram.') : fail('Não foi enviada; o motivo está na linha acima.');
    }
    case 'descobrir-chat': {
      const { token } = config.get().telegram;
      if (!token) return fail(`Preencha "telegram.token" em ${config.FILE} primeiro.`);
      const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
      const data = await res.json();
      if (!data.ok) return fail(`Token recusado pelo Telegram: ${data.description}`);
      const chats = new Map();
      for (const u of data.result) {
        const c = (u.message || u.channel_post || u.my_chat_member || {}).chat;
        if (c) chats.set(c.id, c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username);
      }
      if (!chats.size) return fail('Nenhuma conversa encontrada. Abra o bot no Telegram, envie "oi" e rode de novo.');
      for (const [id, name] of chats) console.log(`chat_id: ${id}   (${name})`);
      return console.log('\nCopie o número para "telegram.chat_id" no config.json.');
    }
    case 'backup': {
      const r = await require('./lib/backup').backupNow();
      return r.ok ? console.log(`Backup criado: ${r.file}`) : fail(`Backup falhou: ${r.error}`);
    }
    case 'status': {
      const text = await require('./lib/monitor').summaryText();
      return console.log(text.replace(/<[^>]+>/g, ''));
    }
    default:
      console.log('Uso: node ferramentas.js testar-telegram | descobrir-chat | backup | status');
  }
}

function fail(msg) { console.error(msg); process.exitCode = 1; }

main(process.argv[2]).catch(fail).finally(() => setTimeout(() => process.exit(), 200));
