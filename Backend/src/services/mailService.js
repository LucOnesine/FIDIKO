require('dotenv').config();
const nodemailer = require('nodemailer');

let transporter = null;

// Créer le transporteur d'email réel
function getTransporter() {
  if (!transporter) {
    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '465', 10),
        secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
        auth: {
          user: process.env.SMTP_USER,
          pass: (process.env.SMTP_PASS || '').replace(/\s+/g, ''), // Supprime les espaces du mot de passe d'application Google
        },
      });
    } else {
      throw new Error("Configuration SMTP manquante : Veuillez renseigner SMTP_HOST, SMTP_USER et SMTP_PASS dans le fichier .env");
    }
  }
  return transporter;
}

// Envoyer l'OTP d'inscription réellement par e-mail
async function sendRegistrationOtpEmail(toEmail, otpCode, userName) {
  const mailer = getTransporter();
  const subject = `[FIDIKO] Votre code de confirmation : ${otpCode}`;
  const text = `Bonjour ${userName || ''},\n\nVoici votre code OTP pour confirmer votre inscription sur FIDIKO : ${otpCode}\n\nCe code est obligatoire pour finaliser votre compte.\n\nL'équipe FIDIKO.`;
  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 520px; margin: 0 auto; background: #0B132B; color: #F4F1EA; border-radius: 16px; padding: 28px; border: 1px solid #1C2541; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
      <div style="text-align: center; margin-bottom: 24px;">
        <h2 style="color: #06D6A0; margin: 0; font-size: 26px; font-weight: 800; letter-spacing: 1px;">FIDIKO</h2>
        <p style="color: #8E9AAF; margin-top: 6px; font-size: 14px;">Plateforme de Scrutin & Vote Numérique Sécurisé</p>
      </div>
      <p style="font-size: 16px; margin-bottom: 12px;">Bonjour <strong>${userName || ''}</strong>,</p>
      <p style="color: #A0ABC0; line-height: 1.6; font-size: 15px;">
        Merci pour votre inscription. Afin de sécuriser votre compte électeur ou administrateur, veuillez saisir ce code de validation à usage unique :
      </p>
      <div style="background: #1C2541; border: 2px dashed #06D6A0; border-radius: 12px; padding: 18px; text-align: center; margin: 26px 0;">
        <span style="font-size: 34px; font-weight: 900; letter-spacing: 8px; color: #06D6A0; font-family: monospace;">${otpCode}</span>
      </div>
      <p style="color: #8E9AAF; font-size: 13px; line-height: 1.5;">
        Si vous n'êtes pas à l'origine de cette inscription, aucune action n'est requise de votre part.
      </p>
      <hr style="border: none; border-top: 1px solid #1C2541; margin: 24px 0;">
      <p style="text-align: center; color: #8E9AAF; font-size: 12px; margin: 0;">&copy; 2026 FIDIKO System. Tous droits réservés.</p>
    </div>
  `;

  return mailer.sendMail({
    from: process.env.MAIL_FROM || `"FIDIKO Sécurité" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject,
    text,
    html,
  });
}

// Envoyer l'OTP de réinitialisation de mot de passe réellement par e-mail
async function sendPasswordResetOtpEmail(toEmail, otpCode, userName) {
  const mailer = getTransporter();
  const subject = `[FIDIKO] Réinitialisation de votre mot de passe : ${otpCode}`;
  const text = `Bonjour ${userName || ''},\n\nVous avez demandé la réinitialisation de votre mot de passe FIDIKO.\n\nVoici votre code OTP de sécurité : ${otpCode}\n\nCe code expire dans 15 minutes.\n\nL'équipe FIDIKO.`;
  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 520px; margin: 0 auto; background: #0B132B; color: #F4F1EA; border-radius: 16px; padding: 28px; border: 1px solid #1C2541; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
      <div style="text-align: center; margin-bottom: 24px;">
        <h2 style="color: #FFD166; margin: 0; font-size: 26px; font-weight: 800; letter-spacing: 1px;">FIDIKO</h2>
        <p style="color: #8E9AAF; margin-top: 6px; font-size: 14px;">Réinitialisation Sécurisée de Mot de Passe</p>
      </div>
      <p style="font-size: 16px; margin-bottom: 12px;">Bonjour <strong>${userName || ''}</strong>,</p>
      <p style="color: #A0ABC0; line-height: 1.6; font-size: 15px;">
        Une demande de réinitialisation de mot de passe a été initiée pour votre compte. Saisissez ce code de validation :
      </p>
      <div style="background: #1C2541; border: 2px dashed #FFD166; border-radius: 12px; padding: 18px; text-align: center; margin: 26px 0;">
        <span style="font-size: 34px; font-weight: 900; letter-spacing: 8px; color: #FFD166; font-family: monospace;">${otpCode}</span>
      </div>
      <p style="color: #8E9AAF; font-size: 13px; line-height: 1.5;">
        Ce code est strictement personnel, valable 15 minutes et ne doit être partagé avec personne.
      </p>
      <hr style="border: none; border-top: 1px solid #1C2541; margin: 24px 0;">
      <p style="text-align: center; color: #8E9AAF; font-size: 12px; margin: 0;">&copy; 2026 FIDIKO System. Tous droits réservés.</p>
    </div>
  `;

  return mailer.sendMail({
    from: process.env.MAIL_FROM || `"FIDIKO Sécurité" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject,
    text,
    html,
  });
}

module.exports = {
  sendRegistrationOtpEmail,
  sendPasswordResetOtpEmail,
};
