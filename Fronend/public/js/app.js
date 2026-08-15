/* ==========================================================================
   FIDIKO - Client Logic JavaScript Multi-Device Handshake & Control Engine
   ========================================================================== */

const API_BASE = window.location.origin.includes('5000') ? '' : 'http://localhost:5000';
let socket = null;
let currentToken = localStorage.getItem('fidiko_token') || null;
let currentUser = JSON.parse(localStorage.getItem('fidiko_user') || 'null');
let currentRoom = null;

// Unique Device Identification for Booth Terminals
let myDeviceId = localStorage.getItem('fidiko_device_id');
if (!myDeviceId) {
  myDeviceId = 'device_' + Math.random().toString(36).substring(2, 9);
  localStorage.setItem('fidiko_device_id', myDeviceId);
}

function getDeviceName() {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return `Smartphone Android (${myDeviceId.substring(7, 11)})`;
  if (/iPhone|iPad|iPod/i.test(ua)) return `iPhone / iOS (${myDeviceId.substring(7, 11)})`;
  if (/windows/i.test(ua)) return `PC Windows (${myDeviceId.substring(7, 11)})`;
  if (/macintosh/i.test(ua)) return `Mac (${myDeviceId.substring(7, 11)})`;
  return `Appareil #${myDeviceId.substring(7, 11)}`;
}

// Initialisation de l'application
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupEventListeners();
  initSocketConnection();
  checkAutoRedirect();
});

// 1. Redirection automatique si connecté
function checkAutoRedirect() {
  if (currentToken && currentUser) {
    if (currentUser.role === 'admin') {
      showAdminDashboard();
    } else {
      showLandingPage();
    }
    updateNavButtons();
  } else {
    showLandingPage();
    updateNavButtons();
  }
}

// 2. Gestion des vues (Sections UI)
function hideAllSections() {
  document.getElementById('landingSection').style.display = 'none';
  document.getElementById('authSection').style.display = 'none';
  document.getElementById('adminDashboardSection').style.display = 'none';
  document.getElementById('voterBoothSection').style.display = 'none';
  document.getElementById('resultsSection').style.display = 'none';
}

function showLandingPage() {
  hideAllSections();
  document.getElementById('landingSection').style.display = 'block';
}

function showAuthSection() {
  hideAllSections();
  document.getElementById('authSection').style.display = 'grid';
}

async function showAdminDashboard() {
  hideAllSections();
  document.getElementById('adminDashboardSection').style.display = 'block';
  document.getElementById('adminWelcomeTitle').textContent = `Bienvenue, ${currentUser.name || currentUser.full_name || 'Administrateur'}`;
  document.getElementById('adminUserEmail').textContent = `Compte Admin : ${currentUser.email}`;
  
  await loadMyRooms();
}

function updateNavButtons() {
  const navAuthBtn = document.getElementById('navAuthBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const appRoleBadge = document.getElementById('appRoleBadge');

  if (currentToken && currentUser) {
    navAuthBtn.style.display = 'none';
    logoutBtn.style.display = 'inline-flex';
    appRoleBadge.textContent = currentUser.role === 'admin' ? 'Administrateur' : 'Électeur';
  } else {
    navAuthBtn.style.display = 'inline-flex';
    logoutBtn.style.display = 'none';
    appRoleBadge.textContent = 'Mode Visiteur';
  }
}

// 3. Gestion des thèmes (Bleu Nuit / Warm Cream)
function initTheme() {
  const savedTheme = localStorage.getItem('fidiko_theme') || 'dark';
  applyTheme(savedTheme);

  document.getElementById('themeToggleBtn').addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('fidiko_theme', theme);
  const icon = document.getElementById('themeIcon');
  const label = document.getElementById('themeLabel');

  if (theme === 'light') {
    icon.className = 'fa-solid fa-moon';
    label.textContent = 'Mode Sombre';
  } else {
    icon.className = 'fa-solid fa-sun';
    label.textContent = 'Mode Clair';
  }
}

// 4. Synchronisation WebSockets Temps Réel & Appairage Handshake
function initSocketConnection() {
  socket = io(API_BASE || 'http://localhost:5000');

  socket.on('connect', () => {
    console.log('⚡ Connecté aux WebSockets FIDIKO:', socket.id);
  });

  // Mise à jour de la liste des demandes d'association reçue par l'Admin
  socket.on('admin:pending_associations_update', (data) => {
    renderPendingAssociationsList(data.pending);
  });

  // Mise à jour de la liste des isoloirs validés connectés reçue par l'Admin
  socket.on('admin:connected_devices_update', (data) => {
    renderConnectedDevicesList(data.devices);
  });

  // Réponse Handshake reçue par le terminal : ACCEPTÉ
  socket.on('booth:association_accepted', (data) => {
    console.log('✅ Demande d\'association ACCEPTÉE par l\'admin !');
    showBoothViewState('locked');
  });

  // Réponse Handshake reçue par le terminal : REFUSÉ
  socket.on('booth:association_rejected', (data) => {
    console.log('❌ Demande d\'association REFUSÉE par l\'admin !');
    showBoothViewState('rejected');
  });

  // ÉTAPE 1 : Déverrouillage spécifique de cet isoloir par l'Admin
  socket.on('booth:device_unlocked', (data) => {
    console.log('🔓 CET ISOLOIR A ÉTÉ DÉVERROUILLÉ PAR L\'ADMINISTRATEUR !');
    showBoothViewState('active');
  });

  // ÉTAPE 3 : Auto-verrouillage immédiat de cet isoloir
  socket.on('booth:device_locked', (data) => {
    console.log('🔒 CET ISOLOIR EST MAINTENANT VERROUILLÉ.');
    showBoothViewState('locked');
  });

  socket.on('candidate:disqualified', (data) => {
    updateCandidateDisqualificationUI(data.candidate_id, data.is_disqualified);
  });

  socket.on('vote:cast', (data) => {
    const counterEl = document.getElementById('liveGlobalVoteCount');
    if (counterEl) {
      counterEl.textContent = data.total_votes_registered;
    }
  });

  socket.on('results:countdown_tick', (data) => {
    const modal = document.getElementById('countdownModal');
    const timer = document.getElementById('countdownTimer');
    modal.style.display = 'flex';
    timer.textContent = data.countdown;
  });

  socket.on('results:reveal_ready', (data) => {
    document.getElementById('countdownModal').style.display = 'none';
    fetchAndDisplayResults(data.room_id || (currentRoom ? currentRoom.id : null));
  });
}

// Render pending association requests on Admin Dashboard
function renderPendingAssociationsList(pendingList) {
  const container = document.getElementById('adminPendingAssociationsContainer');
  const listEl = document.getElementById('adminPendingAssociationsList');
  if (!container || !listEl) return;

  if (!pendingList || pendingList.length === 0) {
    container.style.display = 'none';
    listEl.innerHTML = '';
    return;
  }

  container.style.display = 'block';
  listEl.innerHTML = pendingList.map(p => `
    <div class="candidate-card" style="margin-bottom: 0.75rem; background: var(--navy-dark); border: 1.5px dashed #FFD166;">
      <div>
        <div class="candidate-name" style="color: #FFD166; font-weight: 800;">
          <i class="fa-solid fa-mobile-screen"></i> ${p.device_name}
        </div>
        <div class="candidate-party">Identifiant : <strong>${p.device_id}</strong> | En attente de validation Admin</div>
      </div>
      <div style="display: flex; gap: 0.5rem;">
        <button class="btn btn-success" style="padding: 0.5rem 1rem;" onclick="respondAssociation('${p.device_id}', true)">
          <i class="fa-solid fa-check-circle"></i> [ ACCEPTER ]
        </button>
        <button class="btn btn-danger" style="padding: 0.5rem 1rem;" onclick="respondAssociation('${p.device_id}', false)">
          <i class="fa-solid fa-times-circle"></i> [ REFUSER ]
        </button>
      </div>
    </div>
  `).join('');
}

// Respond to Handshake Association Request (Admin Action)
function respondAssociation(deviceId, approved) {
  if (!currentRoom) return;

  socket.emit('admin:respond_association', {
    room_id: currentRoom.id,
    device_id: deviceId,
    approved: approved,
  });
}

// Render connected validated booth devices on Admin Dashboard
function renderConnectedDevicesList(devices) {
  const container = document.getElementById('adminConnectedDevicesList');
  if (!container) return;

  if (!devices || devices.length === 0) {
    container.innerHTML = `
      <div style="padding: 1.5rem; text-align: center; background: var(--input-bg); border-radius: 12px;">
        <i class="fa-solid fa-mobile-screen-button" style="font-size: 2rem; color: var(--text-sub); margin-bottom: 0.5rem;"></i>
        <p style="color: var(--text-sub); font-size: 1rem; font-weight: 600;">Aucun isoloir validé connecté pour le moment.</p>
        <p style="color: var(--text-sub); font-size: 0.85rem; margin-top: 0.25rem;">Les appareils acceptés apparaîtront ici avec leur bouton de déverrouillage individuel.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = devices.map(d => {
    const isUnlocked = d.is_unlocked;
    const badgeColor = isUnlocked ? '#06D6A0' : '#FFD166';
    const badgeBg = isUnlocked ? 'rgba(6,214,160,0.2)' : 'rgba(255,209,102,0.2)';
    const statusText = isUnlocked ? '🟢 DÉVERROUILLÉ (VOTE EN COURS)' : '🔴 VERROUILLÉ (EN ATTENTE)';

    return `
      <div class="candidate-card" style="margin-bottom: 0.85rem; border: 1.5px solid ${isUnlocked ? '#06D6A0' : 'var(--border-color)'};">
        <div style="display: flex; align-items: center; gap: 1rem;">
          <div style="width: 48px; height: 48px; border-radius: 12px; background: var(--navy-light); display: flex; align-items: center; justify-content: center; font-size: 1.4rem; color: ${isUnlocked ? '#06D6A0' : 'white'};">
            <i class="fa-solid ${isUnlocked ? 'fa-lock-open' : 'fa-lock'}"></i>
          </div>
          <div>
            <div class="candidate-name" style="font-size: 1.15rem; font-weight: 800;">
              ${d.device_name}
              <span style="font-size: 0.75rem; padding: 0.25rem 0.6rem; border-radius: 12px; background: ${badgeBg}; color: ${badgeColor}; font-weight: 800; margin-left: 0.5rem;">
                ${statusText}
              </span>
            </div>
            <div class="candidate-party" style="margin-top: 0.2rem;">
              Bulletins traités par cet isoloir : <strong>${d.votes_cast_on_device || 0}</strong>
            </div>
          </div>
        </div>
        <div>
          <button class="btn ${isUnlocked ? 'btn-danger' : 'btn-success'}" 
                  style="font-size: 0.9rem; padding: 0.65rem 1.25rem;"
                  onclick="toggleDeviceUnlock('${d.device_id}', ${!isUnlocked})">
            ${isUnlocked ? '<i class="fa-solid fa-lock"></i> Verrouiller Cet Isoloir' : '<i class="fa-solid fa-lock-open"></i> Déverrouiller pour Votant Suivant'}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Toggle specific device unlock from Admin
function toggleDeviceUnlock(deviceId, shouldUnlock) {
  if (!currentRoom) return;

  if (shouldUnlock) {
    socket.emit('admin:unlock_specific_device', {
      room_id: currentRoom.id,
      device_id: deviceId,
    });
  } else {
    socket.emit('admin:lock_specific_device', {
      room_id: currentRoom.id,
      device_id: deviceId,
    });
  }
}

// 5. Configuration des Événements UI
function setupEventListeners() {
  document.getElementById('brandHomeBtn').addEventListener('click', () => {
    if (currentToken && currentUser && currentUser.role === 'admin') {
      showAdminDashboard();
    } else {
      showLandingPage();
    }
  });

  document.getElementById('navAuthBtn').addEventListener('click', showAuthSection);
  document.getElementById('landingLoginBtn').addEventListener('click', showAuthSection);
  document.getElementById('landingRegisterBtn').addEventListener('click', showAuthSection);

  document.querySelectorAll('.close-auth-btn').forEach(btn => {
    btn.addEventListener('click', showLandingPage);
  });

  document.getElementById('logoutBtn').addEventListener('click', () => {
    localStorage.removeItem('fidiko_token');
    localStorage.removeItem('fidiko_user');
    currentToken = null;
    currentUser = null;
    currentRoom = null;
    showLandingPage();
    updateNavButtons();
  });

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      currentToken = data.token;
      currentUser = data.user;
      localStorage.setItem('fidiko_token', currentToken);
      localStorage.setItem('fidiko_user', JSON.stringify(currentUser));
      
      updateNavButtons();
      
      if (currentUser.role === 'admin') {
        showAdminDashboard();
      } else {
        showLandingPage();
      }
    } catch (err) {
      alert('Erreur de connexion: ' + err.message);
    }
  });

  document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const full_name = document.getElementById('regName').value;
    const email = document.getElementById('regEmail').value;
    const password = document.getElementById('regPassword').value;
    const role = document.getElementById('regRole').value;

    try {
      const res = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name, email, password, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      currentToken = data.token;
      currentUser = data.user;
      localStorage.setItem('fidiko_token', currentToken);
      localStorage.setItem('fidiko_user', JSON.stringify(currentUser));

      updateNavButtons();

      if (currentUser.role === 'admin') {
        showAdminDashboard();
      } else {
        showLandingPage();
      }
    } catch (err) {
      alert('Erreur lors de la création du compte: ' + err.message);
    }
  });

  document.getElementById('openCreateRoomBtn').addEventListener('click', () => {
    document.getElementById('createRoomFormContainer').style.display = 'block';
  });

  document.getElementById('cancelCreateRoomBtn').addEventListener('click', () => {
    document.getElementById('createRoomFormContainer').style.display = 'none';
  });

  document.getElementById('createRoomForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('roomTitleInput').value;
    const description = document.getElementById('roomDescInput').value;

    try {
      const res = await fetch(`${API_BASE}/api/rooms/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`,
        },
        body: JSON.stringify({ title, description }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const roomId = data.room.id;

      await fetch(`${API_BASE}/api/rooms/${roomId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`,
        },
        body: JSON.stringify({ status: 'active' }),
      });

      alert(`✅ Salon "${data.room.title}" créé et ACTIVÉ avec succès ! Code: ${data.room.code}`);
      document.getElementById('createRoomFormContainer').style.display = 'none';
      document.getElementById('createRoomForm').reset();
      
      loadRoomByCode(data.room.code);
    } catch (err) {
      alert('Erreur: ' + err.message);
    }
  });

  document.getElementById('activateRoomBtn').addEventListener('click', async () => {
    if (!currentRoom) return;

    try {
      const newStatus = currentRoom.status === 'active' ? 'draft' : 'active';
      const res = await fetch(`${API_BASE}/api/rooms/${currentRoom.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`,
        },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      currentRoom = data.room;
      updateRoomStatusUI(currentRoom.status);
      alert(`Scrutin ${currentRoom.status === 'active' ? 'OUVERT et ACTIF ! Les votes sont autorisés.' : 'mis en pause (Brouillon).'}`);
    } catch (err) {
      alert('Erreur lors du changement d\'état du scrutin: ' + err.message);
    }
  });

  document.getElementById('joinRoomBtn').addEventListener('click', () => {
    const code = document.getElementById('guestRoomCode').value.trim();
    if (code) {
      loadRoomByCode(code);
    } else {
      alert('Veuillez saisir un code à 6 chiffres.');
    }
  });

  document.getElementById('addCandidateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentRoom) return;

    const first_name = document.getElementById('candFirstName').value;
    const last_name = document.getElementById('candLastName').value;
    const party_name = document.getElementById('candParty').value;
    const color_code = document.getElementById('candColor').value;

    try {
      const res = await fetch(`${API_BASE}/api/candidates/add`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`,
        },
        body: JSON.stringify({
          room_id: currentRoom.id,
          first_name,
          last_name,
          party_name,
          color_code,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      document.getElementById('addCandidateForm').reset();
      loadRoomByCode(currentRoom.code);
    } catch (err) {
      alert('Erreur: ' + err.message);
    }
  });

  document.getElementById('closeRoomBtn').addEventListener('click', async () => {
    if (!currentRoom) return;
    if (!confirm('Voulez-vous vraiment clôturer le vote et démarrer le compte à rebours de 10 secondes ?')) return;

    try {
      const res = await fetch(`${API_BASE}/api/rooms/${currentRoom.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`,
        },
        body: JSON.stringify({ status: 'closed' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      socket.emit('results:start_countdown', { room_id: currentRoom.id });
    } catch (err) {
      alert('Erreur: ' + err.message);
    }
  });
}

function updateRoomStatusUI(status) {
  const badge = document.getElementById('adminRoomStatusBadge');
  const btn = document.getElementById('activateRoomBtn');
  if (!badge || !btn) return;

  if (status === 'active') {
    badge.textContent = '● SCRUTIN EN COURS (ACTIF)';
    badge.style.backgroundColor = 'rgba(6, 214, 160, 0.2)';
    badge.style.color = '#06D6A0';
    btn.className = 'btn btn-outline';
    btn.innerHTML = '<i class="fa-solid fa-pause"></i> Mettre le Scrutin en Pause';
  } else if (status === 'closed') {
    badge.textContent = '● SCRUTIN CLÔTURÉ';
    badge.style.backgroundColor = 'rgba(217, 4, 41, 0.2)';
    badge.style.color = '#D90429';
    btn.style.display = 'none';
  } else {
    badge.textContent = '● BROUILLON (NON ACTIF)';
    badge.style.backgroundColor = 'rgba(255, 209, 102, 0.2)';
    badge.style.color = '#FFD166';
    btn.className = 'btn btn-success';
    btn.innerHTML = '<i class="fa-solid fa-play"></i> Ouvrir / Activer le Scrutin';
  }
}

async function loadMyRooms() {
  const container = document.getElementById('myRoomsList');
  if (!container) return;

  try {
    const res = await fetch(`${API_BASE}/api/rooms/my-rooms`, {
      headers: { 'Authorization': `Bearer ${currentToken}` },
    });
    const rooms = await res.json();

    if (!res.ok) throw new Error(rooms.error);

    if (!rooms || rooms.length === 0) {
      container.innerHTML = '<p style="color: var(--text-sub);">Vous n\'avez aucun salon actif. Cliquez sur "Créer un nouveau Salon de Vote" ci-dessus pour démarrer.</p>';
      return;
    }

    container.innerHTML = rooms.map(r => `
      <div class="candidate-card" style="margin-bottom: 0.75rem;">
        <div>
          <div class="candidate-name">${r.title} <span style="font-size: 0.8rem; padding: 0.2rem 0.5rem; border-radius: 12px; background: ${r.status === 'active' ? 'rgba(6,214,160,0.2)' : 'rgba(255,209,102,0.2)'}; color: ${r.status === 'active' ? '#06D6A0' : '#FFD166'}">${r.status.toUpperCase()}</span></div>
          <div class="candidate-party">Code: <strong style="color: #06D6A0;">${r.code}</strong> | Candidats: ${r.candidates_count} | Bulletins: ${r.total_votes}</div>
        </div>
        <button class="btn btn-primary" onclick="loadRoomByCode('${r.code}')">
          <i class="fa-solid fa-gear"></i> Gérer ce Salon
        </button>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<p style="color: var(--status-disqualified);">Erreur: ${err.message}</p>`;
  }
}

async function loadRoomByCode(code) {
  try {
    const res = await fetch(`${API_BASE}/api/rooms/code/${code}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    currentRoom = data.room;
    
    hideAllSections();

    if (currentUser && currentUser.role === 'admin' && currentRoom.admin_id === currentUser.id) {
      socket.emit('room:join', { room_id: currentRoom.id });
      document.getElementById('adminDashboardSection').style.display = 'block';
      document.getElementById('adminRoomDetailsView').style.display = 'block';
      document.getElementById('adminRoomTitle').textContent = `Salon: ${currentRoom.title}`;
      document.getElementById('adminRoomCode').innerHTML = `Code d'accès: <strong style="color: #06D6A0; font-size: 1.2rem;">${currentRoom.code}</strong>`;
      document.getElementById('liveGlobalVoteCount').textContent = data.total_votes_registered;
      
      updateRoomStatusUI(currentRoom.status);
      renderAdminCandidates(data.candidates);
    } else {
      // 1. DEMANDE D'ASSOCIATION (HANDSHAKE / APPAIRAGE)
      socket.emit('booth:request_association', {
        room_id: currentRoom.id,
        device_id: myDeviceId,
        device_name: getDeviceName(),
      });

      document.getElementById('voterBoothSection').style.display = 'block';
      document.getElementById('terminalDeviceLabel').innerHTML = `<i class="fa-solid fa-mobile-screen-button" style="color: #06D6A0;"></i> ${getDeviceName()}`;
      
      // Passer par défaut en état d'attente d'association
      showBoothViewState('pending');
      renderVoterCandidates(data.candidates);
    }
  } catch (err) {
    alert('Erreur lors du chargement du salon: ' + err.message);
  }
}

function showBoothViewState(state) {
  const pendingView = document.getElementById('boothPendingView');
  const rejectedView = document.getElementById('boothRejectedView');
  const lockedView = document.getElementById('boothLockedView');
  const activeView = document.getElementById('boothActiveView');
  const statusBadge = document.getElementById('terminalStatusBadge');

  if (!pendingView || !rejectedView || !lockedView || !activeView) return;

  pendingView.style.display = 'none';
  rejectedView.style.display = 'none';
  lockedView.style.display = 'none';
  activeView.style.display = 'none';

  if (state === 'pending') {
    pendingView.style.display = 'block';
    if (statusBadge) {
      statusBadge.textContent = '🟡 ATTENTE VALIDATION ADMIN...';
      statusBadge.style.backgroundColor = 'rgba(255,209,102,0.2)';
      statusBadge.style.color = '#FFD166';
    }
  } else if (state === 'rejected') {
    rejectedView.style.display = 'block';
    if (statusBadge) {
      statusBadge.textContent = '🔴 APPAIRAGE REFUSÉ';
      statusBadge.style.backgroundColor = 'rgba(217,4,41,0.2)';
      statusBadge.style.color = '#D90429';
    }
  } else if (state === 'locked') {
    lockedView.style.display = 'block';
    if (statusBadge) {
      statusBadge.textContent = '🔴 ISOLOIR VERROUILLÉ';
      statusBadge.style.backgroundColor = 'rgba(255,209,102,0.2)';
      statusBadge.style.color = '#FFD166';
    }
  } else if (state === 'active') {
    activeView.style.display = 'block';
    if (statusBadge) {
      statusBadge.textContent = '🟢 ISOLOIR DÉVERROUILLÉ';
      statusBadge.style.backgroundColor = 'rgba(6,214,160,0.2)';
      statusBadge.style.color = '#06D6A0';
    }
  }
}

function renderAdminCandidates(candidates) {
  const container = document.getElementById('adminCandidatesList');
  if (!candidates || candidates.length === 0) {
    container.innerHTML = '<p style="color: var(--text-sub);">Aucun candidat enregistré dans la base de données.</p>';
    return;
  }

  container.innerHTML = candidates.map(c => `
    <div class="candidate-card ${c.is_disqualified ? 'disqualified' : ''}" id="admin-cand-${c.id}">
      <div class="candidate-avatar" style="background-color: ${c.color_code};">
        ${c.first_name[0]}${c.last_name[0]}
      </div>
      <div class="candidate-info">
        <div class="candidate-name">${c.first_name} ${c.last_name} ${c.is_disqualified ? '<span style="color: var(--status-disqualified); font-size: 0.8rem;">(DISQUALIFIÉ)</span>' : ''}</div>
        <div class="candidate-party">${c.party_name || 'Indépendant'}</div>
      </div>
      <div>
        <button class="btn ${c.is_disqualified ? 'btn-success' : 'btn-danger'}" onclick="toggleDisqualification('${c.id}', ${!c.is_disqualified})">
          ${c.is_disqualified ? '<i class="fa-solid fa-user-check"></i> Réhabiliter' : '<i class="fa-solid fa-user-slash"></i> Disqualifier'}
        </button>
      </div>
    </div>
  `).join('');
}

async function toggleDisqualification(candidateId, isDisqualified) {
  try {
    const res = await fetch(`${API_BASE}/api/candidates/${candidateId}/disqualify`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`,
      },
      body: JSON.stringify({ is_disqualified: isDisqualified }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
  } catch (err) {
    alert('Erreur: ' + err.message);
  }
}

function renderVoterCandidates(candidates) {
  const container = document.getElementById('voterCandidatesGrid');
  if (!candidates || candidates.length === 0) {
    container.innerHTML = '<p style="color: var(--text-sub);">Aucun candidat au scrutin.</p>';
    return;
  }

  container.innerHTML = candidates.map(c => `
    <div class="candidate-card ${c.is_disqualified ? 'disqualified' : ''}" id="voter-cand-${c.id}" style="cursor: pointer;" onclick="castVote('${c.id}')">
      <div class="candidate-avatar" style="background-color: ${c.color_code}; font-size: 1.4rem;">
        ${c.first_name[0]}${c.last_name[0]}
      </div>
      <div class="candidate-info">
        <div class="candidate-name" style="font-size: 1.2rem; font-weight: 800;">${c.first_name} ${c.last_name}</div>
        <div class="candidate-party">${c.party_name || 'Indépendant'}</div>
      </div>
      <button class="btn btn-primary cand-vote-btn" 
              ${c.is_disqualified ? 'disabled style="opacity: 0.4; cursor: not-allowed;"' : ''}>
        ${c.is_disqualified ? 'Disqualifié' : '<i class="fa-solid fa-vote-yea"></i> Voter pour ce candidat'}
      </button>
    </div>
  `).join('');
}

// Clic Électeur -> Inscription PostgreSQL -> Auto-Verrouillage Immédiat !
async function castVote(candidateId) {
  if (!confirm('Confirmez-vous votre bulletin de vote ?')) return;

  if (navigator.vibrate) {
    navigator.vibrate([100, 50, 100]);
  }

  try {
    const res = await fetch(`${API_BASE}/api/votes/cast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room_id: currentRoom.id,
        candidate_id: candidateId,
        voter_user_id: currentUser ? currentUser.id : null,
        booth_device_id: myDeviceId,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    alert('✅ Vote enregistré de façon anonyme dans PostgreSQL !');

    socket.emit('booth:vote_completed', {
      room_id: currentRoom.id,
      device_id: myDeviceId,
    });

    showBoothViewState('locked');
  } catch (err) {
    alert('Erreur lors du vote: ' + err.message);
  }
}

function updateCandidateDisqualificationUI(candidateId, isDisqualified) {
  const adminCard = document.getElementById(`admin-cand-${candidateId}`);
  if (adminCard) {
    if (isDisqualified) {
      adminCard.classList.add('disqualified');
    } else {
      adminCard.classList.remove('disqualified');
    }
  }

  const voterCard = document.getElementById(`voter-cand-${candidateId}`);
  if (voterCard) {
    const btn = voterCard.querySelector('.cand-vote-btn');
    if (isDisqualified) {
      voterCard.classList.add('disqualified');
      if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.4';
        btn.style.cursor = 'not-allowed';
        btn.textContent = 'Disqualifié';
      }
    } else {
      voterCard.classList.remove('disqualified');
      if (btn) {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
        btn.innerHTML = '<i class="fa-solid fa-vote-yea"></i> Voter pour ce candidat';
      }
    }
  }
}

async function fetchAndDisplayResults(roomId) {
  if (!roomId) return;
  try {
    const res = await fetch(`${API_BASE}/api/votes/results/${roomId}`, {
      headers: { 'Authorization': `Bearer ${currentToken}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    hideAllSections();
    const resultsSection = document.getElementById('resultsSection');
    resultsSection.style.display = 'block';

    const container = document.getElementById('resultsListContainer');
    container.innerHTML = data.results.map(r => `
      <div class="result-row">
        <div class="result-header">
          <span>${r.full_name} (${r.party_name || 'Indépendant'}) ${r.is_disqualified ? '<span style="color: var(--status-disqualified); font-size: 0.8rem;">[DISQUALIFIÉ]</span>' : ''}</span>
          <span><strong>${r.vote_count} voix</strong> (${r.percentage}%)</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width: ${r.percentage}%; background-color: ${r.color_code || '#06D6A0'};"></div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Erreur récupération résultats:', err);
  }
}
