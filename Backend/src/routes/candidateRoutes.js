const express = require('express');
const db = require('../config/db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Ajouter un candidat (Admin) - Autorisé UNIQUEMENT si room.status === 'INACTIVE'
router.post('/add', authenticateToken, async (req, res) => {
  try {
    const { room_id, candidate_number, first_name, last_name, party_name, color_code, photo_url, party_logo_url } = req.body;

    if (!room_id || !first_name || !last_name) {
      return res.status(400).json({ error: 'Champs obligatoires manquants (room_id, first_name, last_name).' });
    }

    // Vérifier l'existence et l'état du salon
    const roomCheck = await db.query('SELECT * FROM rooms WHERE id = $1 AND admin_id = $2', [room_id, req.user.id]);
    if (roomCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Salon introuvable ou non autorisé.' });
    }

    const room = roomCheck.rows[0];

    // GEL STRICT EN MODE ACTIVE OU CLOSED
    if (room.status !== 'INACTIVE') {
      return res.status(403).json({
        error: 'GEL STRICT EN VIGUEUR : Il est strictement interdit d\'ajouter ou de modifier des candidats lorsque le scrutin est ACTIF ou CLÔTURÉ.',
      });
    }

    // Calculer automatiquement le numéro d'ordre s'il n'est pas fourni
    let numOrder = parseInt(candidate_number, 10);
    if (isNaN(numOrder)) {
      const maxNumRes = await db.query(
        'SELECT COALESCE(MAX(candidate_number), 0) + 1 as next_num FROM candidates WHERE room_id = $1',
        [room_id]
      );
      numOrder = parseInt(maxNumRes.rows[0].next_num, 10);
    }

    const result = await db.query(
      `INSERT INTO candidates (room_id, candidate_number, first_name, last_name, party_name, color_code, photo_url, party_logo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        room_id,
        numOrder,
        first_name.trim(),
        last_name.trim(),
        party_name ? party_name.trim() : '',
        color_code || '#1C2541',
        photo_url || '',
        party_logo_url || '',
      ]
    );

    const candidate = result.rows[0];

    const io = req.app.get('socketio');
    if (io) {
      io.to(`room_${room_id}`).emit('candidate:added', candidate);
    }

    res.status(201).json({ message: 'Candidat ajouté avec succès', candidate });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Ce numéro d\'ordre est déjà attribué à un autre candidat dans ce salon.' });
    }
    console.error('Erreur ajout candidat:', error);
    res.status(500).json({ error: 'Erreur lors de l\'ajout du candidat.' });
  }
});

// Disqualifier / Réhabiliter un candidat (Admin)
router.patch('/:id/disqualify', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_disqualified } = req.body;

    const checkCandidate = await db.query(
      `SELECT c.*, r.admin_id, r.status as room_status 
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

    const io = req.app.get('socketio');
    if (io) {
      io.to(`room_${updatedCandidate.room_id}`).emit('candidate:disqualified', {
        candidate_id: updatedCandidate.id,
        is_disqualified: updatedCandidate.is_disqualified,
        candidate: updatedCandidate,
      });
    }

    res.json({
      message: `Candidat ${updatedCandidate.is_disqualified ? 'disqualifié' : 'réhabilité'} avec succès`,
      candidate: updatedCandidate,
    });
  } catch (error) {
    console.error('Erreur disqualification candidat:', error);
    res.status(500).json({ error: 'Erreur lors de la disqualification du candidat.' });
  }
});

// Supprimer un candidat - Interdit si room.status !== 'INACTIVE'
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const checkCandidate = await db.query(
      `SELECT c.*, r.admin_id, r.status as room_status 
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

    // GEL STRICT EN MODE ACTIVE OU CLOSED
    if (candidateData.room_status !== 'INACTIVE') {
      return res.status(403).json({
        error: 'GEL STRICT EN VIGUEUR : Il est strictement interdit de supprimer un candidat lorsque le scrutin est ACTIF ou CLÔTURÉ.',
      });
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
