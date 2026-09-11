const db = require('../config/db');

const connectedBooths = new Map(); // room_id -> Map(device_id -> boothInfo)
const pendingAssociations = new Map(); // room_id -> Map(device_id -> pendingInfo)

// Suivi des rappels déjà envoyés : `${room_id}_10min` et `${room_id}_5min`
const sentReminders = new Set();

const socketHandler = (io) => {
  // Intervalle pour vérifier les scrutins approchant de leur heure de fin (toutes les 20 secondes)
  setInterval(async () => {
    try {
      const activeRoomsRes = await db.query(
        `SELECT id, title, end_time 
         FROM rooms 
         WHERE status = 'ACTIVE' AND end_time IS NOT NULL AND end_time > NOW()`
      );

      const now = Date.now();
      for (const room of activeRoomsRes.rows) {
        const endTimeMs = new Date(room.end_time).getTime();
        const diffMs = endTimeMs - now;
        const diffMinutes = Math.floor(diffMs / 60000);

        // Rappel 10 minutes (entre 9 et 10 minutes restantes)
        const key10 = `${room.id}_10min`;
        if (diffMinutes <= 10 && diffMinutes > 5 && !sentReminders.has(key10)) {
          sentReminders.add(key10);
          console.log(`⏰ Notification 10 minutes avant la fin du vote pour le salon "${room.title}" (${room.id})`);
          
          // Récupérer les électeurs approuvés n'ayant pas encore voté
          const pendingVoters = await db.query(
            `SELECT user_id FROM room_voters WHERE room_id = $1 AND status = 'APPROVED'`,
            [room.id]
          );

          for (const v of pendingVoters.rows) {
            io.to(`user_${v.user_id}`).emit('room:vote_reminder', {
              room_id: room.id,
              room_title: room.title,
              minutes_left: 10,
              message: `⏰ Rappel urgent : Il reste moins de 10 minutes pour exprimer votre vote dans le salon "${room.title}".`,
            });
          }
          io.to(`room_${room.id}`).emit('room:vote_reminder_broadcast', {
            room_id: room.id,
            minutes_left: 10,
            message: `⏰ Attention : Il ne reste plus que 10 minutes avant la clôture du vote !`,
          });
        }

        // Rappel 5 minutes (entre 0 et 5 minutes restantes)
        const key5 = `${room.id}_5min`;
        if (diffMinutes <= 5 && diffMinutes >= 0 && !sentReminders.has(key5)) {
          sentReminders.add(key5);
          console.log(`🚨 Notification 5 minutes avant la fin du vote pour le salon "${room.title}" (${room.id})`);
          
          const pendingVoters = await db.query(
            `SELECT user_id FROM room_voters WHERE room_id = $1 AND status = 'APPROVED'`,
            [room.id]
          );

          for (const v of pendingVoters.rows) {
            io.to(`user_${v.user_id}`).emit('room:vote_reminder', {
              room_id: room.id,
              room_title: room.title,
              minutes_left: 5,
              message: `🚨 DERNIER RAPPEL : Il reste moins de 5 minutes pour voter dans le salon "${room.title}". Après l'heure de fin, aucun vote ne sera accepté !`,
            });
          }
          io.to(`room_${room.id}`).emit('room:vote_reminder_broadcast', {
            room_id: room.id,
            minutes_left: 5,
            message: `🚨 DERNIÈRE LIGNE DROITE : Plus que 5 minutes avant la fin définitive du scrutin !`,
          });
        }
      }
    } catch (err) {
      console.error('Erreur vérification rappels fin de vote:', err);
    }
  }, 20000);

  io.on('connection', (socket) => {
    console.log(`🔌 Client connecté aux WebSockets FIDIKO: ${socket.id}`);

    // 0. Rejoindre sa boîte de réception utilisateur privée
    socket.on('user:join', ({ user_id }) => {
      if (user_id) {
        socket.join(`user_${user_id}`);
        console.log(`👤 Socket ${socket.id} a rejoint son canal privé: user_${user_id}`);
      }
    });

    // 1. Rejoindre un salon (Admin ou Électeur)
    socket.on('room:join', ({ room_id }) => {
      if (room_id) {
        socket.join(`room_${room_id}`);
        console.log(`📡 Socket ${socket.id} a rejoint le salon: room_${room_id}`);
        broadcastConnectedDevices(io, room_id);
        broadcastPendingAssociations(io, room_id);
      }
    });

    // 2. DEMANDE D'ASSOCIATION (HANDSHAKE / APPAIRAGE)
    socket.on('booth:request_association', ({ room_id, device_id, device_name, user_role }) => {
      if (!room_id || !device_id) return;

      // Restriction stricte : Seuls les électeurs ('voter') et visiteurs ('visitor' ou non renseigné) peuvent être isoloir
      if (user_role === 'admin') {
        socket.emit('booth:association_rejected', {
          device_id,
          message: 'Les comptes administrateur ne peuvent pas être configurés en tant qu\'isoloir physique. Utilisez un compte électeur ou le mode visiteur.',
        });
        return;
      }

      socket.join(`room_${room_id}`);
      socket.join(`device_${device_id}`);

      if (!pendingAssociations.has(room_id)) {
        pendingAssociations.set(room_id, new Map());
      }

      const roomPending = pendingAssociations.get(room_id);
      const pendingInfo = {
        socket_id: socket.id,
        device_id: device_id,
        device_name: device_name || `Terminal #${device_id.substring(7, 11)}`,
        user_role: user_role || 'visitor',
        requested_at: new Date(),
      };

      roomPending.set(device_id, pendingInfo);
      socket.booth_room_id = room_id;
      socket.booth_device_id = device_id;

      console.log(`📱 Demande d'association reçue de ${pendingInfo.device_name} (ID: ${device_id}) pour le salon room_${room_id}`);

      // Alerter l'admin instantanément de la nouvelle demande d'association
      broadcastPendingAssociations(io, room_id);
    });

    // 3. RÉPONSE ADMIN À LA DEMANDE D'ASSOCIATION (ACCEPTER / REFUSER)
    socket.on('admin:respond_association', ({ room_id, device_id, approved }) => {
      console.log(`👮 Admin répond à la demande d'appairage de ${device_id}: ${approved ? 'ACCEPTÉ' : 'REFUSÉ'}`);
      
      const roomPending = pendingAssociations.get(room_id);
      if (roomPending && roomPending.has(device_id)) {
        const pendingItem = roomPending.get(device_id);
        roomPending.delete(device_id);

        if (approved) {
          // Enregistrer comme Isoloir Validé dans connectedBooths
          if (!connectedBooths.has(room_id)) {
            connectedBooths.set(room_id, new Map());
          }
          const roomMap = connectedBooths.get(room_id);
          const boothNumber = roomMap.size + 1;

          const boothInfo = {
            socket_id: pendingItem.socket_id,
            device_id: device_id,
            device_name: `Isoloir N°${boothNumber} (${pendingItem.device_name})`,
            is_unlocked: false,
            status: 'verrouille',
            connected_at: new Date(),
            votes_cast_on_device: 0,
          };

          roomMap.set(device_id, boothInfo);

          // Signal d'acceptation vers le téléphone isoloir
          io.to(`device_${device_id}`).emit('booth:association_accepted', {
            device_id,
            device_name: boothInfo.device_name,
            message: 'Demande d\'association ACCEPTÉE par l\'administrateur. En mode isoloir verrouillé.',
          });
        } else {
          // Signal de refus vers le téléphone isoloir
          io.to(`device_${device_id}`).emit('booth:association_rejected', {
            device_id,
            message: 'Demande d\'association REFUSÉE par l\'administrateur.',
          });
        }

        broadcastPendingAssociations(io, room_id);
        broadcastConnectedDevices(io, room_id);
      }
    });

    // 4. Déverrouillage individuel par l'Admin pour le votant suivant
    socket.on('admin:unlock_specific_device', ({ room_id, device_id }) => {
      const roomMap = connectedBooths.get(room_id);
      if (roomMap && roomMap.has(device_id)) {
        const booth = roomMap.get(device_id);
        booth.is_unlocked = true;
        booth.status = 'deverrouille';
        
        io.to(`device_${device_id}`).emit('booth:device_unlocked', {
          device_id,
          device_name: booth.device_name,
          message: 'Isoloir déverrouillé ! Vous pouvez effectuer votre choix.',
        });

        broadcastConnectedDevices(io, room_id);
      }
    });

    // Verrouillage manuel par l'Admin
    socket.on('admin:lock_specific_device', ({ room_id, device_id }) => {
      const roomMap = connectedBooths.get(room_id);
      if (roomMap && roomMap.has(device_id)) {
        const booth = roomMap.get(device_id);
        booth.is_unlocked = false;
        booth.status = 'verrouille';
        
        io.to(`device_${device_id}`).emit('booth:device_locked', {
          device_id,
          message: 'Isoloir verrouillé par l\'administrateur.',
        });

        broadcastConnectedDevices(io, room_id);
      }
    });

    // 5. Auto-verrouillage immédiat après validation du vote
    socket.on('booth:vote_completed', ({ room_id, device_id }) => {
      const roomMap = connectedBooths.get(room_id);
      if (roomMap && roomMap.has(device_id)) {
        const booth = roomMap.get(device_id);
        booth.is_unlocked = false;
        booth.status = 'verrouille';
        booth.votes_cast_on_device = (booth.votes_cast_on_device || 0) + 1;
        
        io.to(`device_${device_id}`).emit('booth:device_locked', {
          device_id,
          message: 'Vote enregistré ! Cet isoloir est verrouillé pour l\'électeur suivant.',
        });

        broadcastConnectedDevices(io, room_id);
      }
    });

    // 6. Cérémonie du compte à rebours (10 secondes)
    socket.on('results:start_countdown', ({ room_id }) => {
      let countdown = 10;
      const interval = setInterval(() => {
        io.to(`room_${room_id}`).emit('results:countdown_tick', { countdown });
        
        if (countdown <= 0) {
          clearInterval(interval);
          io.to(`room_${room_id}`).emit('results:reveal_ready', { room_id });
        }
        countdown--;
      }, 1000);
    });

    // 7. Déconnexion d'un appareil
    socket.on('disconnect', () => {
      if (socket.booth_room_id && socket.booth_device_id) {
        const roomPending = pendingAssociations.get(socket.booth_room_id);
        if (roomPending) {
          roomPending.delete(socket.booth_device_id);
          broadcastPendingAssociations(io, socket.booth_room_id);
        }

        const roomMap = connectedBooths.get(socket.booth_room_id);
        if (roomMap) {
          roomMap.delete(socket.booth_device_id);
          broadcastConnectedDevices(io, socket.booth_room_id);
        }
      }
    });
  });
};

function broadcastConnectedDevices(io, room_id) {
  const roomMap = connectedBooths.get(room_id);
  const devices = roomMap ? Array.from(roomMap.values()) : [];
  io.to(`room_${room_id}`).emit('admin:connected_devices_update', { devices });
}

function broadcastPendingAssociations(io, room_id) {
  const roomPending = pendingAssociations.get(room_id);
  const pending = roomPending ? Array.from(roomPending.values()) : [];
  io.to(`room_${room_id}`).emit('admin:pending_associations_update', { pending });
}

module.exports = socketHandler;
