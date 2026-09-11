const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { sendRegistrationOtpEmail, sendPasswordResetOtpEmail } = require('../services/mailService');

const router = express.Router();

// Helper pour générer un code OTP à 6 chiffres
function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// 1. Inscription utilisateur : Création du compte avec envoi d'OTP
router.post('/register', async (req, res) => {
  try {
    const { email, password, full_name, role } = req.body;

    if (!email || !password || !full_name) {
      return res.status(400).json({ error: 'Champs obligatoires manquants (email, password, full_name).' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const userRole = role === 'admin' ? 'admin' : 'voter';

    // Vérifier si l'utilisateur existe déjà pour CE RÔLE spécifique
    const existing = await db.query('SELECT id, is_verified FROM users WHERE email = $1 AND role = $2', [cleanEmail, userRole]);
    if (existing.rows.length > 0) {
      const existingUser = existing.rows[0];
      if (existingUser.is_verified) {
        return res.status(400).json({ error: `Un compte ${userRole === 'admin' ? 'Administrateur' : 'Électeur'} existe déjà avec cette adresse e-mail.` });
      } else {
        // Compte non vérifié existant pour ce rôle : régénérer l'OTP et mettre à jour le mot de passe
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);
        const otp = generateOtp();

        await db.query(
          `UPDATE users SET password_hash = $1, full_name = $2, otp_code = $3, updated_at = NOW()
           WHERE id = $4`,
          [passwordHash, full_name.trim(), otp, existingUser.id]
        );

        // Envoyer l'email OTP
        await sendRegistrationOtpEmail(cleanEmail, otp, full_name.trim());

        return res.status(200).json({
          message: `Un code de confirmation OTP a été envoyé à votre adresse e-mail pour votre compte ${userRole === 'admin' ? 'Administrateur' : 'Électeur'}.`,
          email: cleanEmail,
          role: userRole,
          requires_otp: true,
        });
      }
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const otp = generateOtp();

    const result = await db.query(
      `INSERT INTO users (email, password_hash, full_name, role, otp_code, is_verified)
       VALUES ($1, $2, $3, $4, $5, FALSE)
       RETURNING id, email, full_name, role, created_at`,
      [cleanEmail, passwordHash, full_name.trim(), userRole, otp]
    );

    // Envoi de l'e-mail OTP
    await sendRegistrationOtpEmail(cleanEmail, otp, full_name.trim());

    res.status(201).json({
      message: `Compte ${userRole === 'admin' ? 'Administrateur' : 'Électeur'} créé ! Un code de confirmation OTP a été envoyé à votre adresse e-mail.`,
      email: cleanEmail,
      role: userRole,
      requires_otp: true,
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Cet e-mail est déjà utilisé pour ce type de compte.' });
    }
    console.error('Erreur inscription:', error);
    res.status(500).json({ error: 'Erreur serveur lors de l\'inscription.' });
  }
});

// 2. Vérification OTP pour l'inscription
router.post('/verify-registration-otp', async (req, res) => {
  try {
    const { email, otp_code, role } = req.body;

    if (!email || !otp_code) {
      return res.status(400).json({ error: 'E-mail et code OTP obligatoires.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanOtp = otp_code.trim();
    const userRole = role === 'admin' ? 'admin' : (role === 'voter' ? 'voter' : null);

    let query = 'SELECT * FROM users WHERE email = $1';
    const params = [cleanEmail];
    if (userRole) {
      query += ' AND role = $2';
      params.push(userRole);
    }
    query += ' ORDER BY created_at DESC LIMIT 1';

    const result = await db.query(query, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    const user = result.rows[0];

    if (user.otp_code !== cleanOtp) {
      return res.status(400).json({ error: 'Code OTP invalide. Veuillez vérifier votre e-mail.' });
    }

    // Marquer comme vérifié et effacer l'OTP
    await db.query(
      `UPDATE users SET is_verified = TRUE, otp_code = NULL, updated_at = NOW() WHERE id = $1`,
      [user.id]
    );

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.full_name },
      process.env.JWT_SECRET || 'fidiko_super_secret_jwt_key_2026',
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Inscription validée avec succès !',
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
      },
      token,
    });
  } catch (error) {
    console.error('Erreur vérification OTP inscription:', error);
    res.status(500).json({ error: 'Erreur serveur lors de la validation du code OTP.' });
  }
});

// 3. Renvoyer un code OTP d'inscription
router.post('/resend-registration-otp', async (req, res) => {
  try {
    const { email, role } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'E-mail requis.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const userRole = role === 'admin' ? 'admin' : (role === 'voter' ? 'voter' : null);

    let query = 'SELECT * FROM users WHERE email = $1';
    const params = [cleanEmail];
    if (userRole) {
      query += ' AND role = $2';
      params.push(userRole);
    }
    query += ' ORDER BY created_at DESC LIMIT 1';

    const result = await db.query(query, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    const user = result.rows[0];
    if (user.is_verified) {
      return res.status(400).json({ error: 'Ce compte est déjà validé.' });
    }

    const newOtp = generateOtp();
    await db.query('UPDATE users SET otp_code = $1 WHERE id = $2', [newOtp, user.id]);
    await sendRegistrationOtpEmail(cleanEmail, newOtp, user.full_name);

    res.json({ message: 'Nouveau code OTP envoyé avec succès !' });
  } catch (error) {
    console.error('Erreur renvoi OTP inscription:', error);
    res.status(500).json({ error: 'Erreur lors du renvoi du code OTP.' });
  }
});

// 4. Connexion utilisateur avec support du rôle (admin ou voter)
router.post('/login', async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Veuillez saisir votre e-mail et votre mot de passe.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const requestedRole = role ? (role === 'admin' ? 'admin' : 'voter') : null;

    let query = 'SELECT * FROM users WHERE email = $1';
    const params = [cleanEmail];

    if (requestedRole) {
      query += ' AND role = $2';
      params.push(requestedRole);
    }

    const result = await db.query(query, params);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Identifiants incorrects ou rôle introuvable pour ce compte.' });
    }

    // Si aucun rôle n'a été spécifié et que l'utilisateur a 2 comptes (admin et voter)
    if (!requestedRole && result.rows.length > 1) {
      // Vérifier pour quel compte le mot de passe correspond
      let matchedUser = null;
      for (const u of result.rows) {
        const isMatch = await bcrypt.compare(password, u.password_hash);
        if (isMatch) {
          matchedUser = u;
          break;
        }
      }
      if (!matchedUser) {
        return res.status(401).json({ error: 'Identifiants incorrects.' });
      }
      return respondUserLogin(res, matchedUser);
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Identifiants incorrects.' });
    }

    return respondUserLogin(res, user);

  } catch (error) {
    console.error('Erreur connexion:', error);
    res.status(500).json({ error: 'Erreur serveur lors de la connexion.' });
  }
});

async function respondUserLogin(res, user) {
  // Si le compte n'est pas encore vérifié, demander l'OTP
  if (user.is_verified === false) {
    const otp = generateOtp();
    await db.query('UPDATE users SET otp_code = $1 WHERE id = $2', [otp, user.id]);
    await sendRegistrationOtpEmail(user.email, otp, user.full_name);

    return res.status(403).json({
      error: `Votre compte ${user.role === 'admin' ? 'Administrateur' : 'Électeur'} n'a pas encore été vérifié. Un code OTP vient de vous être envoyé par e-mail.`,
      requires_otp: true,
      email: user.email,
      role: user.role,
    });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.full_name },
    process.env.JWT_SECRET || 'fidiko_super_secret_jwt_key_2026',
    { expiresIn: '7d' }
  );

  res.json({
    message: 'Connexion réussie',
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
    },
    token,
  });
}

// 5. Mot de passe oublié : Demande de code OTP par e-mail
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Veuillez saisir votre adresse e-mail.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const result = await db.query('SELECT * FROM users WHERE email = $1', [cleanEmail]);

    if (result.rows.length === 0) {
      // Sécurité : même réponse même si l'email n'existe pas
      return res.json({
        message: 'Si cette adresse correspond à un compte existant, un code OTP de réinitialisation vous a été envoyé.',
        email: cleanEmail,
      });
    }

    const user = result.rows[0];
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await db.query(
      `UPDATE users SET reset_otp_code = $1, reset_otp_expires = $2, updated_at = NOW() WHERE id = $3`,
      [otp, expiresAt, user.id]
    );

    await sendPasswordResetOtpEmail(cleanEmail, otp, user.full_name);

    res.json({
      message: 'Un code OTP de réinitialisation a été envoyé à votre adresse e-mail.',
      email: cleanEmail,
    });
  } catch (error) {
    console.error('Erreur demande réinitialisation mot de passe:', error);
    res.status(500).json({ error: 'Erreur serveur lors de la demande de réinitialisation.' });
  }
});

// 6. Vérifier l'OTP de réinitialisation et changer le mot de passe
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp_code, new_password } = req.body;

    if (!email || !otp_code || !new_password) {
      return res.status(400).json({ error: 'E-mail, code OTP et nouveau mot de passe sont obligatoires.' });
    }

    if (new_password.length < 6) {
      return res.status(400).json({ error: 'Le nouveau mot de passe doit comporter au moins 6 caractères.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanOtp = otp_code.trim();

    const result = await db.query('SELECT * FROM users WHERE email = $1', [cleanEmail]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Compte introuvable.' });
    }

    const user = result.rows[0];

    // Vérifier le code et l'expiration
    if (!user.reset_otp_code || user.reset_otp_code !== cleanOtp) {
      return res.status(400).json({ error: 'Code OTP invalide. Veuillez vérifier le code reçu.' });
    }

    if (user.reset_otp_expires && new Date() > new Date(user.reset_otp_expires)) {
      return res.status(400).json({ error: 'Le code OTP a expiré. Veuillez refaire une demande.' });
    }

    // Hasher le nouveau mot de passe
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(new_password, salt);

    // Mettre à jour le mot de passe et réinitialiser les colonnes reset
    await db.query(
      `UPDATE users SET password_hash = $1, reset_otp_code = NULL, reset_otp_expires = NULL, is_verified = TRUE, updated_at = NOW() WHERE id = $2`,
      [passwordHash, user.id]
    );

    res.json({
      message: 'Votre mot de passe a été réinitialisé avec succès ! Vous pouvez maintenant vous connecter.',
    });
  } catch (error) {
    console.error('Erreur réinitialisation mot de passe:', error);
    res.status(500).json({ error: 'Erreur serveur lors de la réinitialisation du mot de passe.' });
  }
});

module.exports = router;
