const connectedBooths = new Map(); // room_id -> Map(device_id -> boothInfo)
const pendingAssociations = new Map(); // room_id -> Map(device_id -> pendingInfo)

const socketHandler = (io) => {
  io.on('connection', (socket) => {
    console.log(`🔌 Client connecté aux WebSockets FIDIKO: ${socket.id}`);

    // 1. Rejoindre un salon (Admin)
    socket.on('room:join', ({ room_id }) => {
      if (room_id) {
        socket.join(`room_${room_id}`);
        console.log(`📡 Socket ${socket.id} a rejoint le salon: room_${room_id}`);
        broadcastConnectedDevices(io, room_id);
        broadcastPendingAssociations(io, room_id);
      }
    });

    // 2. DEMANDE D'ASSOCIATION (HANDSHAKE / APPAIRAGE)
    socket.on('booth:request_association', ({ room_id, device_id, device_name }) => {
      if (!room_id || !device_id) return;

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
