const express = require('express');
const db = require('../config/db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Ajouter un candidat à un salon (Admin)
router.post('/add', authenticateToken, async (req, res) => {
  try {
    const { room_id, first_name, last_name, party_name, color_code, photo_url, party_logo_url } = req.body;

    if (!room_id || !first_name || !last_name) {
      return res.status(400).json({ error: 'Champs obligatoires manquants (room_id, first_name, last_name).' });
    }

    // Vérifier ownership du salon
    const roomCheck = await db.query('SELECT * FROM rooms WHERE id = $1 AND admin_id = $2', [room_id, req.user.id]);
    if (roomCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Salon introuvable ou non autorisé.' });
    }

    const result = await db.query(
      `INSERT INTO candidates (room_id, first_name, last_name, party_name, color_code, photo_url, party_logo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        room_id,
        first_name.trim(),
        last_name.trim(),
        party_name ? party_name.trim() : '',
        color_code || '#1C2541',
        photo_url || '',
        party_logo_url || '',
      ]
    );

    const candidate = result.rows[0];

    // Notification Socket.io pour mise à jour de la liste
    const io = req.app.get('socketio');
    if (io) {
      io.to(`room_${room_id}`).emit('candidate:added', candidate);
    }

    res.status(201).json({ message: 'Candidat ajouté avec succès', candidate });
  } catch (error) {
    console.error('Erreur ajout candidat:', error);
    res.status(500).json({ error: 'Erreur lors de l\'ajout du candidat.' });
  }
});

// Disqualifier / Réhabiliter un candidat en Temps Réel
router.patch('/:id/disqualify', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_disqualified } = req.body;

    // Récupérer le candidat et vérifier les droits d'admin sur la room
    const checkCandidate = await db.query(
      `SELECT c.*, r.admin_id 
       FROM candidates c
       JOIN rooms r ON c.room_id = r.id
       WHERE c.id = $1`,
      [id]
    );

    if (checkCandidate.rows.length === 0) {
      return res.status(404).json({ error: 'Candidat introuvable.' });
    }

    const candidateData = checkCandidate.rows[0];
    if (candidateData.admin_id !== req.user.id) {
      return res.status(403).json({ error: 'Action non autorisée.' });
    }

    const newDisqualifiedState = Boolean(is_disqualified);
    const result = await db.query(
      `UPDATE candidates 
       SET is_disqualified = $1, 
           disqualified_at = CASE WHEN $1 = TRUE THEN NOW() ELSE NULL END
       WHERE id = $2
       RETURNING *`,
      [newDisqualifiedState, id]
    );

    const updatedCandidate = result.rows[0];

    // Notification Socket.io instantanée sur tous les terminaux isoloirs connectés
    const io = req.app.get('socketio');
    if (io) {
      io.to(`room_${updatedCandidate.room_id}`).emit('candidate:disqualified', {
        candidate_id: updatedCandidate.id,
        is_disqualified: updatedCandidate.is_disqualified,
        candidate: updatedCandidate,
      });
    }

    // Enregistrer l'action dans le log d'audit
    await db.query(
      `INSERT INTO logs (room_id, user_id, action, details)
       VALUES ($1, $2, 'CANDIDATE_DISQUALIFIED', $3)`,
      [
        updatedCandidate.room_id,
        req.user.id,
        JSON.stringify({
          candidate_name: `${updatedCandidate.first_name} ${updatedCandidate.last_name}`,
          is_disqualified: updatedCandidate.is_disqualified,
        }),
      ]
    );

    res.json({
      message: `Candidat ${updatedCandidate.is_disqualified ? 'disqualifié' : 'réhabilité'} avec succès`,
      candidate: updatedCandidate,
    });
  } catch (error) {
    console.error('Erreur disqualification candidat:', error);
    res.status(500).json({ error: 'Erreur lors de la disqualification du candidat.' });
  }
});

// Supprimer un candidat
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const checkCandidate = await db.query(
      `SELECT c.*, r.admin_id 
       FROM candidates c
       JOIN rooms r ON c.room_id = r.id
       WHERE c.id = $1`,
      [id]
    );

    if (checkCandidate.rows.length === 0) {
      return res.status(404).json({ error: 'Candidat introuvable.' });
    }

    const candidateData = checkCandidate.rows[0];
    if (candidateData.admin_id !== req.user.id) {
      return res.status(403).json({ error: 'Action non autorisée.' });
    }

    await db.query('DELETE FROM candidates WHERE id = $1', [id]);

    const io = req.app.get('socketio');
    if (io) {
      io.to(`room_${candidateData.room_id}`).emit('candidate:deleted', { candidate_id: id });
    }

    res.json({ message: 'Candidat supprimé avec succès' });
  } catch (error) {
    console.error('Erreur suppression candidat:', error);
    res.status(500).json({ error: 'Erreur lors de la suppression du candidat.' });
  }
});

module.exports = router;
