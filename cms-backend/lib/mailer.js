// Envio de e-mails (recuperação de senha, cobrança) via SMTP configurado em
// config.json. Sem smtp.host/user/pass preenchidos, o envio só registra um
// aviso no console — nunca derruba quem chamou (recuperação de senha e
// cobrança são best-effort, não caminho crítico).
const nodemailer = require('nodemailer');
const config = require('./config');

function getTransport() {
  const smtp = config.get().smtp || {};
  if (!smtp.host || !smtp.user || !smtp.pass) return null;
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port || 587,
    secure: !!smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
  });
}

async function sendMail({ to, subject, html }) {
  const transport = getTransport();
  const smtp = config.get().smtp || {};
  if (!transport) {
    console.warn('[mailer] SMTP não configurado — e-mail não enviado:', subject, 'para', to);
    return false;
  }
  try {
    await transport.sendMail({ from: smtp.from || smtp.user, to, subject, html });
    return true;
  } catch (err) {
    console.error('[mailer] falha ao enviar e-mail:', err.message);
    return false;
  }
}

module.exports = { sendMail };
