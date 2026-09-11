const express = require('express');
const crypto = require('crypto');
const db = require('../config/db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Soumettre un bulletin de vote - Uniquement si room.status === 'ACTIVE'
router.post('/cast', async (req, res) => {
  const client = await db.getClient();
  try {
    const { room_id, candidate_id, voter_user_id, booth_device_id } = req.body;

    if (!room_id || !candidate_id) {
      return res.status(400).json({ error: 'Identifiants de salon et candidat requis.' });
    }

    if (!voter_user_id && !booth_device_id) {
      return res.status(400).json({ error: 'Empreinte votant manquante.' });
    }

    await client.query('BEGIN');

    // 1. Vérifier si le salon est en état ACTIVE
    const roomResult = await client.query('SELECT * FROM rooms WHERE id = $1', [room_id]);
    if (roomResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Salon introuvable.' });
    }

    const room = roomResult.rows[0];
    if (room.status !== 'ACTIVE') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Le scrutin n\'est pas actif dans ce salon (Statut actuel: ' + room.status + ').' });
    }

    // Vérification des horaires de vote (si configurés)
    const now = new Date();
    if (room.start_time && now < new Date(room.start_time)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Le vote n'a pas encore commencé. Heure d'ouverture : ${new Date(room.start_time).toLocaleString('fr-FR')}.`,
      });
    }

    if (room.end_time && now > new Date(room.end_time)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `La période de vote est expirée. Heure de clôture : ${new Date(room.end_time).toLocaleString('fr-FR')}.`,
      });
    }

    // 2. Vérifier si le candidat est valide et non disqualifié
    const candidateResult = await client.query(
      'SELECT * FROM candidates WHERE id = $1 AND room_id = $2',
      [candidate_id, room_id]
    );

    if (candidateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Candidat introuvable.' });
    }

    const candidate = candidateResult.rows[0];
    if (candidate.is_disqualified) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Ce candidat a été disqualifié et ne peut recevoir de vote.' });
    }

    // 3. Vérifier l'éligibilité et empêcher le double vote
    if (voter_user_id) {
      const checkVoter = await client.query(
        'SELECT * FROM room_voters WHERE room_id = $1 AND user_id = $2',
        [room_id, voter_user_id]
      );
      if (checkVoter.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Vous devez d\'abord faire une demande d\'accès à ce salon et attendre la validation de l\'administrateur.' });
      }

      const voterStatus = checkVoter.rows[0].status;
      if (voterStatus === 'PENDING_APPROVAL') {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Votre demande d\'accès est en attente de validation par l\'administrateur.' });
      }
      if (voterStatus === 'REJECTED') {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Votre demande d\'accès à ce salon a été refusée par l\'administrateur.' });
      }
      if (voterStatus === 'VOTED') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Vous avez déjà voté dans ce salon.' });
      }
      if (voterStatus === 'CANCELLED') {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Votre participation a été annulée par l\'administrateur.' });
      }
      if (voterStatus !== 'APPROVED') {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Vous n\'êtes pas autorisé à voter dans ce salon.' });
      }
    }

    // 4. Générer le hash cryptographique anonymisé du bulletin
    const rawSeed = `${room_id}-${candidate_id}-${Date.now()}-${crypto.randomBytes(16).toString('hex')}`;
    const voteHash = crypto.createHash('sha256').update(rawSeed).digest('hex');

    // 5. Enregistrer le bulletin dans votes_secure (TOTALEMENT ANONYME)
    await client.query(
      `INSERT INTO votes_secure (room_id, candidate_id, vote_hash)
       VALUES ($1, $2, $3)`,
      [room_id, candidate_id, voteHash]
    );

    // 6. Enregistrer ou mettre à jour la participation dans room_voters
    if (voter_user_id) {
      await client.query(
        `UPDATE room_voters 
         SET status = 'VOTED', voted_at = NOW(), booth_device_id = $1
         WHERE room_id = $2 AND user_id = $3`,
        [booth_device_id || null, room_id, voter_user_id]
      );
    } else {
      // Isoloir physique sans compte connecté
      await client.query(
        `INSERT INTO room_voters (room_id, user_id, booth_device_id, status, voted_at)
         VALUES ($1, NULL, $2, 'VOTED', NOW())`,
        [room_id, booth_device_id || null]
      );
    }

    await client.query('COMMIT');

    // 7. Obtenir le total actualisé des bulletins enregistrés
    const totalVotesResult = await db.query(
      'SELECT COUNT(*) as total FROM votes_secure WHERE room_id = $1',
      [room_id]
    );
    const totalCount = parseInt(totalVotesResult.rows[0].total, 10);

    const io = req.app.get('socketio');
    if (io) {
      io.to(`room_${room_id}`).emit('vote:cast', {
        total_votes_registered: totalCount,
      });
    }

    res.json({
      message: 'Vote enregistré de façon anonyme avec succès',
      vote_hash: voteHash,
      total_registered: totalCount,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur enregistrement vote:', error);
    res.status(500).json({ error: 'Erreur lors de l\'enregistrement sécurisé du vote.' });
  } finally {
    client.release();
  }
});

// Déclencheur des Résultats Réels - Uniquement si room.status === 'CLOSED'
router.get('/results/:room_id', authenticateToken, async (req, res) => {
  try {
    const { room_id } = req.params;

    const roomCheck = await db.query('SELECT * FROM rooms WHERE id = $1 AND admin_id = $2', [room_id, req.user.id]);
    if (roomCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Salon non trouvé ou privilèges insuffisants.' });
    }

    const room = roomCheck.rows[0];
    if (room.status !== 'CLOSED') {
      return res.status(400).json({ error: 'Le scrutin doit être CLÔTURÉ pour accéder à la cérémonie des résultats.' });
    }

    // Extraction des résultats triés par nombre de voix et numéro d'ordre
    const resultsQuery = await db.query(
      `SELECT c.id as candidate_id, 
              c.candidate_number,
              c.first_name, 
              c.last_name, 
              c.party_name, 
              c.color_code, 
              c.photo_url, 
              c.party_logo_url, 
              c.is_disqualified,
              COUNT(v.id) as vote_count
       FROM candidates c
       LEFT JOIN votes_secure v ON v.candidate_id = c.id AND v.room_id = c.room_id
       WHERE c.room_id = $1
       GROUP BY c.id
       ORDER BY vote_count DESC, c.candidate_number ASC`,
      [room_id]
    );

    const totalVotesQuery = await db.query(
      'SELECT COUNT(*) as total FROM votes_secure WHERE room_id = $1',
      [room_id]
    );

    const totalVotes = parseInt(totalVotesQuery.rows[0].total, 10);

    const formattedResults = resultsQuery.rows.map((row) => ({
      candidate_id: row.candidate_id,
      candidate_number: row.candidate_number,
      first_name: row.first_name,
      last_name: row.last_name,
      full_name: `N°${row.candidate_number} - ${row.first_name} ${row.last_name}`,
      party_name: row.party_name,
      color_code: row.color_code,
      photo_url: row.photo_url,
      party_logo_url: row.party_logo_url,
      is_disqualified: row.is_disqualified,
      vote_count: parseInt(row.vote_count, 10),
      percentage: totalVotes > 0 ? parseFloat(((parseInt(row.vote_count, 10) / totalVotes) * 100).toFixed(2)) : 0,
    }));

    res.json({
      room_id,
      total_votes: totalVotes,
      results: formattedResults,
    });
  } catch (error) {
    console.error('Erreur extraction résultats:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des résultats réels.' });
  }
});

module.exports = router;
