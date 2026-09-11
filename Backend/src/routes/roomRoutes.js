const express = require('express');
const db = require('../config/db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Créer un salon de vote (Admin) -> Statut initial : 'INACTIVE'
router.post('/create', authenticateToken, async (req, res) => {
  try {
    const { title, description, start_time, end_time } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'Le titre du salon est requis.' });
    }

    let code = generateRoomCode();
    let isUnique = false;

    while (!isUnique) {
      const check = await db.query('SELECT id FROM rooms WHERE code = $1', [code]);
      if (check.rows.length === 0) {
        isUnique = true;
      } else {
        code = generateRoomCode();
      }
    }

    const startTimeVal = start_time ? new Date(start_time) : null;
    const endTimeVal = end_time ? new Date(end_time) : null;

    const result = await db.query(
      `INSERT INTO rooms (code, title, description, admin_id, status, start_time, end_time)
       VALUES ($1, $2, $3, $4, 'INACTIVE', $5, $6)
       RETURNING *`,
      [code, title.trim(), description || '', req.user.id, startTimeVal, endTimeVal]
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

// Mettre à jour les horaires du salon (Admin)
router.patch('/:id/schedule', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { start_time, end_time } = req.body;

    const roomCheck = await db.query('SELECT * FROM rooms WHERE id = $1 AND admin_id = $2', [id, req.user.id]);
    if (roomCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Salon introuvable ou non autorisé.' });
    }

    const startTimeVal = start_time ? new Date(start_time) : null;
    const endTimeVal = end_time ? new Date(end_time) : null;

    const result = await db.query(
      `UPDATE rooms SET start_time = $1, end_time = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
      [startTimeVal, endTimeVal, id]
    );

    const updatedRoom = result.rows[0];
    const io = req.app.get('socketio');
    if (io) {
      io.to(`room_${id}`).emit('room:schedule_updated', { room: updatedRoom });
    }

    res.json({ message: 'Horaires mis à jour avec succès', room: updatedRoom });
  } catch (error) {
    console.error('Erreur mise à jour horaires:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour des horaires.' });
  }
});

// Récupérer les salons de l'administrateur
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

// Récupérer les détails d'un salon par son code unique (Tri par candidate_number)
router.get('/code/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const roomResult = await db.query('SELECT * FROM rooms WHERE code = $1', [code]);

    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: 'Salon introuvable avec ce code.' });
    }

    const room = roomResult.rows[0];

    // Candidats triés par Numéro d'Ordre
    const candidatesResult = await db.query(
      `SELECT id, room_id, candidate_number, first_name, last_name, party_name, color_code, photo_url, party_logo_url, is_disqualified
       FROM candidates
       WHERE room_id = $1
       ORDER BY candidate_number ASC`,
      [room.id]
    );

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

// Changer le statut du salon (INACTIVE -> ACTIVE -> CLOSED)
router.patch('/:id/status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const targetStatus = (status || '').toUpperCase();

    if (!['INACTIVE', 'ACTIVE', 'CLOSED'].includes(targetStatus)) {
      return res.status(400).json({ error: 'Statut invalide (doit être INACTIVE, ACTIVE ou CLOSED).' });
    }

    const roomCheck = await db.query('SELECT * FROM rooms WHERE id = $1 AND admin_id = $2', [id, req.user.id]);
    if (roomCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Salon non trouvé ou privilèges insuffisants.' });
    }

    let extraSet = '';
    if (targetStatus === 'CLOSED') {
      extraSet = ', countdown_started_at = NOW()';
    }

    const result = await db.query(
      `UPDATE rooms SET status = $1 ${extraSet} WHERE id = $2 RETURNING *`,
      [targetStatus, id]
    );


    const updatedRoom = result.rows[0];

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

// Lancer un nouveau tour (Second Tour ou Vote d'Égalité sans clôturer le scrutin)
router.post('/:id/start-round', authenticateToken, async (req, res) => {
  const client = await db.getClient();
  try {
    const { id } = req.params;
    const { qualified_candidate_ids, round_type } = req.body;

    if (!Array.isArray(qualified_candidate_ids) || qualified_candidate_ids.length < 2) {
      return res.status(400).json({ error: 'Au moins 2 candidats qualifiés sont requis pour le nouveau tour.' });
    }

    const roomCheck = await client.query(
      'SELECT * FROM rooms WHERE (id::text = $1 OR code = $1) AND admin_id = $2',
      [id, req.user.id]
    );
    if (roomCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Salon non trouvé ou privilèges insuffisants.' });
    }

    const realRoomId = roomCheck.rows[0].id;

    await client.query('BEGIN');

    // 1. Archiver le tour précédent dans logs
    const prevVotesQuery = await client.query(
      `SELECT c.id, c.first_name, c.last_name, COUNT(v.id) as vote_count
       FROM candidates c
       LEFT JOIN votes_secure v ON v.candidate_id = c.id AND v.room_id = c.room_id
       WHERE c.room_id = $1
       GROUP BY c.id`,
      [realRoomId]
    );

    await client.query(
      `INSERT INTO logs (room_id, user_id, action, details)
       VALUES ($1, $2, 'ROUND_TRANSITION', $3)`,
      [
        realRoomId,
        req.user.id,
        JSON.stringify({
          round_type: round_type || 'SECOND_ROUND',
          qualified_candidates: qualified_candidate_ids,
          previous_results: prevVotesQuery.rows,
          transition_at: new Date().toISOString(),
        }),
      ]
    );

    // 2. Éliminer les candidats non qualifiés pour ce nouveau tour
    await client.query(
      `UPDATE candidates 
       SET is_disqualified = TRUE, disqualified_at = NOW() 
       WHERE room_id = $1 AND id != ALL($2::uuid[])`,
      [realRoomId, qualified_candidate_ids]
    );

    // Réhabiliter expressément les candidats qualifiés
    await client.query(
      `UPDATE candidates 
       SET is_disqualified = FALSE, disqualified_at = NULL 
       WHERE room_id = $1 AND id = ANY($2::uuid[])`,
      [realRoomId, qualified_candidate_ids]
    );

    // 3. Réinitialiser l'urne et le registre d'émargement pour ce nouveau tour
    await client.query('DELETE FROM votes_secure WHERE room_id = $1', [realRoomId]);
    await client.query('DELETE FROM room_voters WHERE room_id = $1', [realRoomId]);

    // 4. Remettre le salon en statut 'ACTIVE' (puisque le scrutin n'est pas clôturé tant qu'il n'y a pas d'élu !)
    const updateRoom = await client.query(
      `UPDATE rooms 
       SET status = 'ACTIVE', countdown_started_at = NULL 
       WHERE id = $1 
       RETURNING *`,
      [realRoomId]
    );

    await client.query('COMMIT');

    const updatedRoom = updateRoom.rows[0];

    // 5. Récupérer la liste à jour des candidats qualifiés
    const qualifiedCandidatesQuery = await db.query(
      `SELECT * FROM candidates 
       WHERE room_id = $1 AND is_disqualified = FALSE 
       ORDER BY candidate_number ASC`,
      [realRoomId]
    );

    const io = req.app.get('socketio');
    if (io) {
      io.to(`room_${realRoomId}`).emit('room:new_round_started', {
        room_id: realRoomId,
        round_type: round_type || 'SECOND_ROUND',
        candidates: qualifiedCandidatesQuery.rows,
        room: updatedRoom,
      });
      io.to(`room_${realRoomId}`).emit('room:status_changed', { status: 'ACTIVE', room: updatedRoom });
      io.to(`room_${realRoomId}`).emit('vote:cast', { total_votes_registered: 0 });
    }

    res.json({
      message: 'Nouveau tour lancé avec succès ! Le scrutin redevient actif avec les candidats sélectionnés.',
      room: updatedRoom,
      candidates: qualifiedCandidatesQuery.rows,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur lancement nouveau tour:', error);
    res.status(500).json({ error: 'Erreur serveur lors du lancement du nouveau tour.' });
  } finally {
    client.release();
  }
});

// ==========================================
// ESPACE ÉLECTEUR & GESTION DES PARTICIPANTS
// ==========================================

// 1. Demande d'accès d'un électeur à un salon (authentifié électeur)
router.post('/:id/request-access', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Trouver le salon par UUID ou Code
    const roomCheck = await db.query(
      'SELECT id, title, status, start_time, end_time FROM rooms WHERE id::text = $1 OR code = $1',
      [id]
    );
    if (roomCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Salon introuvable.' });
    }

    const room = roomCheck.rows[0];

    // Vérifier si une demande existe déjà
    const existingEntry = await db.query(
      'SELECT * FROM room_voters WHERE room_id = $1 AND user_id = $2',
      [room.id, userId]
    );

    let voterStatus = 'PENDING_APPROVAL';

    if (existingEntry.rows.length > 0) {
      const current = existingEntry.rows[0];
      if (current.status === 'VOTED') {
        return res.status(400).json({ error: 'Vous avez déjà voté dans ce salon.', status: 'VOTED' });
      }
      if (current.status === 'APPROVED') {
        return res.json({ message: 'Vous êtes déjà approuvé pour voter dans ce salon.', status: 'APPROVED', room });
      }
      // Si REJECTED ou CANCELLED, on permet de redemander
      await db.query(
        `UPDATE room_voters 
         SET status = 'PENDING_APPROVAL', requested_at = NOW(), cancelled_at = NULL, cancelled_by = NULL
         WHERE id = $1`,
        [current.id]
      );
    } else {
      await db.query(
        `INSERT INTO room_voters (room_id, user_id, status, requested_at)
         VALUES ($1, $2, 'PENDING_APPROVAL', NOW())`,
        [room.id, userId]
      );
    }

    // Récupérer les infos de l'utilisateur pour le broadcast socket
    const userRes = await db.query('SELECT id, full_name, email FROM users WHERE id = $1', [userId]);
    const voterUser = userRes.rows[0];

    const io = req.app.get('socketio');
    if (io) {
      io.to(`room_${room.id}`).emit('voter:request_access', {
        room_id: room.id,
        user: voterUser,
        requested_at: new Date(),
      });
    }

    res.json({
      message: 'Demande d\'accès envoyée à l\'administrateur. En attente de validation.',
      status: 'PENDING_APPROVAL',
      room,
    });
  } catch (error) {
    console.error('Erreur demande accès électeur:', error);
    res.status(500).json({ error: 'Erreur lors de la demande d\'accès.' });
  }
});

// 2. Statut de l'électeur pour un salon spécifique (authentifié)
router.get('/:id/my-status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const roomCheck = await db.query(
      'SELECT id, title, code, status, start_time, end_time FROM rooms WHERE id::text = $1 OR code = $1',
      [id]
    );
    if (roomCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Salon introuvable.' });
    }
    const room = roomCheck.rows[0];

    const voterEntry = await db.query(
      'SELECT * FROM room_voters WHERE room_id = $1 AND user_id = $2',
      [room.id, userId]
    );

    res.json({
      room,
      has_requested: voterEntry.rows.length > 0,
      voter_status: voterEntry.rows.length > 0 ? voterEntry.rows[0].status : 'NOT_REQUESTED',
      requested_at: voterEntry.rows.length > 0 ? voterEntry.rows[0].requested_at : null,
      approved_at: voterEntry.rows.length > 0 ? voterEntry.rows[0].approved_at : null,
      voted_at: voterEntry.rows.length > 0 ? voterEntry.rows[0].voted_at : null,
    });
  } catch (error) {
    console.error('Erreur consultation statut électeur:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération de votre statut.' });
  }
});

// 3. Liste des électeurs du salon pour l'Admin (demandes, approuvés non votants, votants, annulés)
router.get('/:id/voters', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const roomCheck = await db.query(
      'SELECT id, title FROM rooms WHERE (id::text = $1 OR code = $1) AND admin_id = $2',
      [id, req.user.id]
    );
    if (roomCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Salon introuvable ou vous n\'en êtes pas l\'administrateur.' });
    }

    const roomId = roomCheck.rows[0].id;

    const votersQuery = await db.query(
      `SELECT rv.id as registration_id,
              rv.user_id,
              rv.room_id,
              rv.status,
              rv.requested_at,
              rv.approved_at,
              rv.voted_at,
              rv.cancelled_at,
              rv.booth_device_id,
              u.full_name,
              u.email,
              u.role
       FROM room_voters rv
       LEFT JOIN users u ON u.id = rv.user_id
       WHERE rv.room_id = $1
       ORDER BY rv.requested_at DESC NULLS LAST, rv.voted_at DESC NULLS LAST`,
      [roomId]
    );

    res.json({
      room_id: roomId,
      voters: votersQuery.rows,
    });
  } catch (error) {
    console.error('Erreur récupération liste électeurs:', error);
    res.status(500).json({ error: 'Erreur serveur lors de la récupération des électeurs.' });
  }
});

// 4. Valider ou Refuser la demande d'un électeur (Admin)
router.patch('/:id/voters/:user_id/approve', authenticateToken, async (req, res) => {
  try {
    const { id, user_id } = req.params;
    const { approved } = req.body; // boolean: true -> APPROVED, false -> REJECTED

    const roomCheck = await db.query(
      'SELECT id, title FROM rooms WHERE (id::text = $1 OR code = $1) AND admin_id = $2',
      [id, req.user.id]
    );
    if (roomCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Salon introuvable ou vous n\'en êtes pas l\'administrateur.' });
    }

    const roomId = roomCheck.rows[0].id;
    const newStatus = approved ? 'APPROVED' : 'REJECTED';

    const updateRes = await db.query(
      `UPDATE room_voters
       SET status = $1::varchar, approved_at = (CASE WHEN $1::varchar = 'APPROVED' THEN NOW() ELSE NULL END)
       WHERE room_id = $2 AND user_id = $3
       RETURNING *`,
      [newStatus, roomId, user_id]
    );

    if (updateRes.rows.length === 0) {
      return res.status(404).json({ error: 'Demande d\'électeur introuvable dans ce salon.' });
    }

    const io = req.app.get('socketio');
    if (io) {
      io.to(`room_${roomId}`).emit('voter:status_updated', {
        room_id: roomId,
        user_id,
        status: newStatus,
      });
      io.to(`user_${user_id}`).emit('voter:my_access_updated', {
        room_id: roomId,
        status: newStatus,
        message: approved ? 'Votre demande d\'accès a été APPROUVÉE par l\'administrateur !' : 'Votre demande d\'accès a été REFUSÉE par l\'administrateur.',
      });
    }

    res.json({
      message: `Demande ${approved ? 'approuvée' : 'refusée'} avec succès.`,
      voter: updateRes.rows[0],
    });
  } catch (error) {
    console.error('Erreur validation électeur:', error);
    res.status(500).json({ error: 'Erreur lors de la validation de la demande.' });
  }
});

// 5. Annuler le vote d'un électeur en ligne (Admin)
router.post('/:id/voters/:user_id/cancel-vote', authenticateToken, async (req, res) => {
  const client = await db.getClient();
  try {
    const { id, user_id } = req.params;

    const roomCheck = await client.query(
      'SELECT id, title, status FROM rooms WHERE (id::text = $1 OR code = $1) AND admin_id = $2',
      [id, req.user.id]
    );
    if (roomCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Salon introuvable ou vous n\'en êtes pas l\'administrateur.' });
    }

    const room = roomCheck.rows[0];

    await client.query('BEGIN');

    const voterCheck = await client.query(
      'SELECT * FROM room_voters WHERE room_id = $1 AND user_id = $2',
      [room.id, user_id]
    );

    if (voterCheck.rows.length === 0 || voterCheck.rows[0].status !== 'VOTED') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cet électeur n\'a pas encore voté ou n\'est pas enregistré.' });
    }

    // Passer le statut à CANCELLED
    await client.query(
      `UPDATE room_voters
       SET status = 'CANCELLED', cancelled_at = NOW(), cancelled_by = $1
       WHERE room_id = $2 AND user_id = $3`,
      [req.user.id, room.id, user_id]
    );

    // Enregistrer l'action dans le journal d'audit
    await client.query(
      `INSERT INTO logs (room_id, user_id, action, details)
       VALUES ($1, $2, 'VOTE_CANCELLED_BY_ADMIN', $3)`,
      [room.id, req.user.id, JSON.stringify({ target_user_id: user_id, reason: 'Annulation par l\'administrateur' })]
    );

    await client.query('COMMIT');

    const io = req.app.get('socketio');
    if (io) {
      io.to(`room_${room.id}`).emit('voter:status_updated', {
        room_id: room.id,
        user_id,
        status: 'CANCELLED',
      });
      io.to(`user_${user_id}`).emit('voter:my_vote_cancelled', {
        room_id: room.id,
        message: 'Votre vote a été annulé par l\'administrateur.',
      });
    }

    res.json({ message: 'Le vote de l\'électeur a été annulé avec succès.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur annulation vote:', error);
    res.status(500).json({ error: 'Erreur lors de l\'annulation du vote.' });
  } finally {
    client.release();
  }
});

// 6. Historique des salons pour un électeur (authentifié électeur)
router.get('/voter/history', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const historyQuery = await db.query(
      `SELECT r.id as room_id,
              r.code,
              r.title,
              r.description,
              r.status as room_status,
              r.start_time,
              r.end_time,
              r.created_at as room_created_at,
              rv.status as participation_status,
              rv.requested_at,
              rv.approved_at,
              rv.voted_at,
              rv.cancelled_at,
              (SELECT COUNT(*) FROM votes_secure vs WHERE vs.room_id = r.id) as total_votes
       FROM room_voters rv
       JOIN rooms r ON r.id = rv.room_id
       WHERE rv.user_id = $1
       ORDER BY rv.voted_at DESC NULLS LAST, rv.requested_at DESC`,
      [userId]
    );

    res.json(historyQuery.rows);
  } catch (error) {
    console.error('Erreur récupération historique électeur:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération de votre historique.' });
  }
});

module.exports = router;
