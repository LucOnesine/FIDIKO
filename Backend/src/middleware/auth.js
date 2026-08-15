const jwt = require('jsonwebtoken');

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Accès refusé. Jeton d\'authentification manquant.' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'fidiko_super_secret_jwt_key_2026', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Jeton invalide ou expiré.' });
    }
    req.user = user;
    next();
  });
};

const requireAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Privilèges administrateur requis.' });
  }
};

module.exports = {
  authenticateToken,
  requireAdmin,
};
