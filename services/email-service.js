const nodemailer = require("nodemailer");

function createEmailService() {
  const smtpUser = process.env.SMTP_USER || process.env.EMAIL_USER;
  const smtpPass = process.env.SMTP_PASS || process.env.EMAIL_PASS;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: smtpUser, pass: smtpPass },
  });

  transporter
    .verify()
    .then(() => console.log("SMTP conectado - pronto para enviar e-mails."))
    .catch((err) =>
      console.error("Falha ao conectar SMTP:", err.message || err),
    );

  async function sendReservationEmail({
    to,
    subject,
    text,
    html,
    attachments = [],
  }) {
    try {
      const info = await transporter.sendMail({
        from: process.env.EMAIL_FROM || smtpUser,
        to,
        subject,
        text,
        html,
        attachments,
      });
      console.log("Email enviado:", info.messageId || info);
      return info;
    } catch (err) {
      console.error(
        "Erro ao enviar email:",
        err && err.message ? err.message : err,
      );
      throw err;
    }
  }

  return {
    sendReservationEmail,
  };
}

module.exports = createEmailService;
