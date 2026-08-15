const express = require('express');
const crypto = require('crypto');
const db = require('../config/db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Helper: Génère un code de salon unique (ex: 829147)
function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Créer un salon de vote (Admin)
router.post('/create', authenticateToken, async (req, res) => {
  try {
    const { title, description } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'Le titre du salon est requis.' });
    }

    let code = generateRoomCode();
    let isUnique = false;

    // S'assurer de l'unicité du code dans PostgreSQL
    while (!isUnique) {
      const check = await db.query('SELECT id FROM rooms WHERE code = $1', [code]);
      if (check.rows.length === 0) {
        isUnique = true;
      } else {
        code = generateRoomCode();
      }
    }

    const result = await db.query(
      `INSERT INTO rooms (code, title, description, admin_id, status)
       VALUES ($1, $2, $3, $4, 'draft')
       RETURNING *`,
      [code, title.trim(), description || '', req.user.id]
    );

    const room = result.rows[0];

    await db.query(
      `INSERT INTO logs (room_id, user_id, action, details)
       VALUES ($1, $2, 'ROOM_CREATED', $3)`,
      [room.id, req.user.id, JSON.stringify({ title: room.title, code: room.code })]
    );

    res.status(201).json({ message: 'Salon créé avec succès', room });
  } catch (error) {
    console.error('Erreur création salon:', error);
    res.status(500).json({ error: 'Erreur lors de la création du salon.' });
  }
});

// Récupérer tous les salons de l'administrateur
router.get('/my-rooms', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT r.*, 
              (SELECT COUNT(*) FROM candidates c WHERE c.room_id = r.id) as candidates_count,
              (SELECT COUNT(*) FROM votes_secure v WHERE v.room_id = r.id) as total_votes
       FROM rooms r
       WHERE r.admin_id = $1
       ORDER BY r.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Erreur récupération salons:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération de vos salons.' });
  }
});

// Récupérer les détails d'un salon par son code unique (Accès Votant / Isoloir)
router.get('/code/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const roomResult = await db.query('SELECT * FROM rooms WHERE code = $1', [code]);

    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: 'Salon introuvable avec ce code.' });
    }

    const room = roomResult.rows[0];

    // Récupérer les candidats non disqualifiés (ou tous si l'admin consulte)
    const candidatesResult = await db.query(
      `SELECT id, room_id, first_name, last_name, party_name, color_code, photo_url, party_logo_url, is_disqualified
       FROM candidates
       WHERE room_id = $1
       ORDER BY created_at ASC`,
      [room.id]
    );

    // Compteur global uniquement ! Aucune révélation partielle des voix pendant le scrutin
    const voteCountResult = await db.query(
      'SELECT COUNT(*) as total FROM votes_secure WHERE room_id = $1',
      [room.id]
    );

    res.json({
      room,
      candidates: candidatesResult.rows,
      total_votes_registered: parseInt(voteCountResult.rows[0].total, 10),
    });
  } catch (error) {
    console.error('Erreur détails salon:', error);
    res.status(500).json({ error: 'Erreur serveur lors du chargement du salon.' });
  }
});

// Changer le statut du salon (draft -> active -> closed -> revealed)
router.patch('/:id/status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['draft', 'active', 'closed', 'revealed'].includes(status)) {
      return res.status(400).json({ error: 'Statut invalide.' });
    }

    // Vérifier ownership
    const roomCheck = await db.query('SELECT * FROM rooms WHERE id = $1 AND admin_id = $2', [id, req.user.id]);
    if (roomCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Salon non trouvé ou privilèges insuffisants.' });
    }

    let extraSet = '';
    if (status === 'closed') {
      extraSet = ', countdown_started_at = NOW()';
    }

    const result = await db.query(
      `UPDATE rooms SET status = $1 ${extraSet} WHERE id = $2 RETURNING *`,
      [status, id]
    );

    const updatedRoom = result.rows[0];

    // Socket notification
    const io = req.app.get('socketio');
    if (io) {
      io.to(`room_${id}`).emit('room:status_changed', { status, room: updatedRoom });
    }

    res.json({ message: `Statut du salon mis à jour: ${status}`, room: updatedRoom });
  } catch (error) {
    console.error('Erreur mise à jour statut:', error);
    res.status(500).json({ error: 'Erreur lors du changement de statut.' });
  }
});

// Déverrouiller / Verrouiller l'isoloir à distance
router.patch('/:id/booth-lock', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_unlocked } = req.body;

    const roomCheck = await db.query('SELECT * FROM rooms WHERE id = $1 AND admin_id = $2', [id, req.user.id]);
    if (roomCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Salon non trouvé ou non autorisé.' });
    }

    const result = await db.query(
      'UPDATE rooms SET is_booth_unlocked = $1 WHERE id = $2 RETURNING *',
      [Boolean(is_unlocked), id]
    );

    const room = result.rows[0];

    // Informer tous les terminaux isoloirs connectés via Socket.io
    const io = req.app.get('socketio');
    if (io) {
      io.to(`room_${id}`).emit('booth:lock_state', { is_unlocked: room.is_booth_unlocked });
    }

    res.json({ message: `Isoloir ${room.is_booth_unlocked ? 'déverrouillé' : 'verrouillé'}`, room });
  } catch (error) {
    console.error('Erreur changement verrou isoloir:', error);
    res.status(500).json({ error: 'Erreur lors de la modification de l\'état de l\'isoloir.' });
  }
});

module.exports = router;
