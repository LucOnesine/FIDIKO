/* ==========================================================================
   FIDIKO - Client Logic JavaScript 3-State Strict Engine & Landing Options
   ========================================================================== */

const API_BASE = window.location.port === '5000' ? '' : `${window.location.protocol}//${window.location.hostname}:5000`;
let socket = null;
let currentToken = localStorage.getItem('fidiko_token') || null;
let currentUser = JSON.parse(localStorage.getItem('fidiko_user') || 'null');
let currentRoom = null;
let selectedCandidatePhotoBase64 = '';

// Analyser les réponses API en évitant les erreurs de parsing HTML JSON
async function handleFetchResponse(res) {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Erreur (${res.status})`);
    }
    return data;
  }
  const rawText = await res.text();
  throw new Error(`Erreur serveur HTTP ${res.status}: Endpoint introuvable ou réponse non-JSON.`);
}

// Modale Thématique FIDIKO (Remplace les popups "localhost:5000 indique")
function showCustomDialog({ title = 'Confirmation', message = '', icon = 'question', confirmText = 'Confirmer', cancelText = 'Annuler', type = 'info' }) {
  return new Promise((resolve) => {
    const modal = document.getElementById('customDialogModal');
    const titleEl = document.getElementById('customDialogTitle');
    const msgEl = document.getElementById('customDialogMessage');
    const iconEl = document.getElementById('customDialogIcon');
    const confirmBtn = document.getElementById('customDialogConfirmBtn');
    const cancelBtn = document.getElementById('customDialogCancelBtn');

    if (!modal) {
      resolve(confirm(message));
      return;
    }

    titleEl.textContent = title;
    msgEl.textContent = message;

    // Définir la couleur et l'icône de la modale
    iconEl.className = 'custom-dialog-icon ' + (type === 'danger' ? 'danger' : type === 'success' ? 'success' : type === 'info' ? 'info' : '');
    
    if (icon === 'trash' || type === 'danger') {
      iconEl.innerHTML = '<i class="fa-solid fa-trash"></i>';
      confirmBtn.className = 'btn btn-danger';
    } else if (icon === 'stop' || icon === 'stop-circle') {
      iconEl.innerHTML = '<i class="fa-solid fa-stop-circle"></i>';
      confirmBtn.className = 'btn btn-danger';
    } else if (icon === 'check' || type === 'success') {
      iconEl.innerHTML = '<i class="fa-solid fa-check"></i>';
      confirmBtn.className = 'btn btn-success';
    } else if (icon === 'play') {
      iconEl.innerHTML = '<i class="fa-solid fa-play"></i>';
      confirmBtn.className = 'btn btn-primary';
    } else if (icon === 'rotate') {
      iconEl.innerHTML = '<i class="fa-solid fa-rotate-right"></i>';
      confirmBtn.className = 'btn btn-success';
    } else {
      iconEl.innerHTML = '<i class="fa-solid fa-circle-question"></i>';
      confirmBtn.className = 'btn btn-primary';
    }

    confirmBtn.textContent = confirmText;

    if (cancelText) {
      cancelBtn.style.display = 'inline-flex';
      cancelBtn.textContent = cancelText;
    } else {
      cancelBtn.style.display = 'none';
    }

    modal.style.display = 'flex';

    function cleanup(result) {
      modal.style.display = 'none';
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }

    function onConfirm() { cleanup(true); }
    function onCancel() { cleanup(false); }

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
  });
}

function showCustomAlert(message, title = 'Information', type = 'info') {
  return showCustomDialog({
    title,
    message,
    cancelText: null,
    confirmText: 'Compris',
    type,
    icon: type === 'danger' ? 'trash' : type === 'success' ? 'check' : 'info',
  });
}

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

// Initialisation
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  setupEventListeners();
  initSocketConnection();
  checkAutoRedirect();
});

// 1. Redirection automatique si connecté
// 1. Redirection automatique si connecté
function checkAutoRedirect() {
  if (currentToken && currentUser) {
    showHomeSection();
    updateNavButtons();
  } else {
    showLandingPage();
    updateNavButtons();
  }
}

// 2. Gestion des vues principales (Sections UI)
function hideAllSections() {
  const sections = [
    'landingSection', 'homeSection', 'loginSection', 'registerSection',
    'boothJoinSection', 'adminDashboardSection', 'voterBoothSection',
    'voterDashboardSection',
    'resultsSection', 'guideSection', 'settingsSection', 'aboutSection',
    'forgotPasswordSection', 'otpVerifySection'
  ];
  sections.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

function showLandingPage() {
  // Si déjà connecté, la page d'accueil connectée remplace la landing page
  if (currentToken && currentUser) {
    showHomeSection();
    return;
  }
  hideAllSections();
  document.getElementById('landingSection').style.display = 'block';
}

// Accueil pour utilisateur connecté (Admin ou Électeur)
function showHomeSection() {
  hideAllSections();
  const homeSec = document.getElementById('homeSection');
  if (homeSec) homeSec.style.display = 'block';

  const greetingEl = document.getElementById('homeUserGreeting');
  const subtitleEl = document.getElementById('homeUserSubtitle');
  const voterGrid = document.getElementById('homeVoterOptionsGrid');
  const adminGrid = document.getElementById('homeAdminOptionsGrid');

  if (currentUser) {
    const userName = currentUser.full_name || currentUser.name || 'Utilisateur';
    if (greetingEl) {
      greetingEl.textContent = `Bienvenue, ${userName} !`;
    }

    if (currentUser.role === 'admin') {
      if (subtitleEl) {
        subtitleEl.textContent = `Compte Administrateur (${currentUser.email}) — Pilotez vos scrutins et suivez les votes en temps réel.`;
      }
      if (voterGrid) voterGrid.style.display = 'none';
      if (adminGrid) adminGrid.style.display = 'grid';
    } else {
      if (subtitleEl) {
        subtitleEl.textContent = `Compte Électeur Certifié (${currentUser.email}) — Participez à un scrutin officiel ou configurez cet appareil comme isoloir.`;
      }
      if (voterGrid) voterGrid.style.display = 'grid';
      if (adminGrid) adminGrid.style.display = 'none';
    }

    // Connecter la socket privée pour les notifications
    if (socket) {
      socket.emit('user:join', { user_id: currentUser.id });
    }
  }

  updateNavButtons();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showLoginSection() {
  hideAllSections();
  document.getElementById('loginSection').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showRegisterSection() {
  hideAllSections();
  document.getElementById('registerSection').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showForgotPasswordSection() {
  hideAllSections();
  document.getElementById('forgotPasswordSection').style.display = 'block';
  document.getElementById('forgotPasswordStep1').style.display = 'block';
  document.getElementById('forgotPasswordStep2').style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showOtpVerifySection(email) {
  hideAllSections();
  const sec = document.getElementById('otpVerifySection');
  if (sec) sec.style.display = 'block';
  const display = document.getElementById('otpTargetEmailDisplay');
  if (display) display.textContent = email;
  const input = document.getElementById('regOtpInput');
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 100);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showBoothJoinSection() {
  // Restriction physique : un compte administrateur ne peut pas être un isoloir
  if (currentUser && currentUser.role === 'admin') {
    showCustomAlert(
      'Votre compte est de type Administrateur. Seuls les comptes Électeurs ou les Visiteurs non-connectés peuvent être utilisés comme isoloirs physiques.',
      'Accès Isoloir Refusé',
      'danger'
    );
    return;
  }
  hideAllSections();
  document.getElementById('boothJoinSection').style.display = 'block';
}

function showGuideSection() {
  hideAllSections();
  document.getElementById('guideSection').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showSettingsSection() {
  hideAllSections();
  document.getElementById('settingsSection').style.display = 'block';
  populateSettingsUI();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showAboutSection() {
  hideAllSections();
  document.getElementById('aboutSection').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function showAdminDashboard() {
  hideAllSections();
  document.getElementById('adminDashboardSection').style.display = 'block';
  document.getElementById('adminWelcomeTitle').textContent = `Bienvenue, ${currentUser.name || currentUser.full_name || 'Administrateur'}`;
  document.getElementById('adminUserEmail').textContent = `Compte Admin : ${currentUser.email}`;
  
  await loadMyRooms();
}

let voterCountdownInterval = null;

async function showVoterDashboard() {
  hideAllSections();
  const sec = document.getElementById('voterDashboardSection');
  if (sec) sec.style.display = 'block';

  const nameEl = document.getElementById('voterWelcomeName');
  const emailEl = document.getElementById('voterWelcomeEmail');
  if (nameEl) nameEl.textContent = `Bienvenue, ${currentUser ? (currentUser.full_name || currentUser.name || 'Électeur') : 'Électeur'}`;
  if (emailEl) emailEl.textContent = `Compte Électeur Certifié : ${currentUser ? currentUser.email : ''}`;

  // Rejoindre son canal utilisateur pour les alertes et notifications en temps réel
  if (socket && currentUser) {
    socket.emit('user:join', { user_id: currentUser.id });
  }

  // Vérifier si l'électeur a un salon mémorisé ou actif
  const savedVoterRoomId = localStorage.getItem('fidiko_voter_room_id');
  if (savedVoterRoomId) {
    await checkVoterRoomStatus(savedVoterRoomId);
  } else {
    showVoterJoinSubView();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showVoterJoinSubView() {
  const joinCard = document.getElementById('voterJoinRoomCard');
  const currentCard = document.getElementById('voterCurrentRoomCard');
  const historyCard = document.getElementById('voterHistoryCard');

  if (joinCard) joinCard.style.display = 'block';
  if (currentCard) currentCard.style.display = 'none';
  if (historyCard) historyCard.style.display = 'none';
}

function updateNavButtons() {
  const navAuthBtn = document.getElementById('navAuthBtn');
  const logoutBtn = document.getElementById('logoutBtn');
  const appRoleBadge = document.getElementById('appRoleBadge');
  const navHomeBtn = document.getElementById('navHomeBtn');
  const navDashboardBtn = document.getElementById('navDashboardBtn');

  if (currentToken && currentUser) {
    navAuthBtn.style.display = 'none';
    logoutBtn.style.display = 'inline-flex';
    if (navHomeBtn) navHomeBtn.style.display = 'inline-flex';
    if (navDashboardBtn) {
      navDashboardBtn.style.display = 'inline-flex';
      navDashboardBtn.querySelector('span').textContent = currentUser.role === 'admin' ? 'Tableau de Bord' : 'Mon Scrutin';
    }
    appRoleBadge.textContent = currentUser.role === 'admin' ? 'Administrateur' : 'Électeur';
  } else {
    navAuthBtn.style.display = 'inline-flex';
    logoutBtn.style.display = 'none';
    if (navHomeBtn) navHomeBtn.style.display = 'none';
    if (navDashboardBtn) navDashboardBtn.style.display = 'none';
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

// Gestion des Paramètres FIDIKO
function populateSettingsUI() {
  const deviceDisplay = document.getElementById('settingDeviceIdDisplay');
  if (deviceDisplay) {
    deviceDisplay.value = myDeviceId;
  }

  const vibToggle = document.getElementById('settingVibrationToggle');
  if (vibToggle) {
    vibToggle.checked = localStorage.getItem('fidiko_vibration') !== 'false';
  }

  const durationSelect = document.getElementById('settingThankYouDuration');
  if (durationSelect) {
    durationSelect.value = localStorage.getItem('fidiko_thankyou_duration') || '2500';
  }
}

function setupSettingsHandlers() {
  // Thème depuis les paramètres
  const darkBtn = document.getElementById('settingsThemeDarkBtn');
  const lightBtn = document.getElementById('settingsThemeLightBtn');

  if (darkBtn) {
    darkBtn.addEventListener('click', () => {
      applyTheme('dark');
      showCustomAlert('Thème Bleu Nuit activé.', 'Apparence', 'info');
    });
  }

  if (lightBtn) {
    lightBtn.addEventListener('click', () => {
      applyTheme('light');
      showCustomAlert('Thème Warm Cream activé.', 'Apparence', 'info');
    });
  }

  // Vibration toggle
  const vibToggle = document.getElementById('settingVibrationToggle');
  if (vibToggle) {
    vibToggle.addEventListener('change', (e) => {
      localStorage.setItem('fidiko_vibration', e.target.checked ? 'true' : 'false');
    });
  }

  // Durée d'affichage
  const durationSelect = document.getElementById('settingThankYouDuration');
  if (durationSelect) {
    durationSelect.addEventListener('change', (e) => {
      localStorage.setItem('fidiko_thankyou_duration', e.target.value);
    });
  }

  // Régénérer ID appareil
  const resetDeviceBtn = document.getElementById('settingResetDeviceIdBtn');
  if (resetDeviceBtn) {
    resetDeviceBtn.addEventListener('click', async () => {
      const confirmed = await showCustomDialog({
        title: 'Régénérer l\'ID Terminal',
        message: 'Voulez-vous générer un nouvel identifiant pour cet appareil ?\nL\'administrateur devra réassocier cet isoloir lors de la prochaine connexion.',
        icon: 'rotate',
        type: 'info',
        confirmText: 'Régénérer',
        cancelText: 'Annuler'
      });
      if (!confirmed) return;

      myDeviceId = 'device_' + Math.random().toString(36).substring(2, 9);
      localStorage.setItem('fidiko_device_id', myDeviceId);
      populateSettingsUI();
      showCustomAlert(`Nouvel identifiant terminal généré : ${myDeviceId}`, 'ID Régénéré', 'success');
    });
  }

  // Réinitialisation des données locales
  const clearStorageBtn = document.getElementById('settingClearStorageBtn');
  if (clearStorageBtn) {
    clearStorageBtn.addEventListener('click', async () => {
      const confirmed = await showCustomDialog({
        title: 'Réinitialiser Données Locales',
        message: 'Voulez-vous réinitialiser votre session et les préférences locales enregistrées dans ce navigateur ?',
        icon: 'trash',
        type: 'danger',
        confirmText: 'Réinitialiser',
        cancelText: 'Annuler'
      });
      if (!confirmed) return;

      localStorage.removeItem('fidiko_token');
      localStorage.removeItem('fidiko_user');
      localStorage.removeItem('fidiko_vibration');
      localStorage.removeItem('fidiko_thankyou_duration');
      currentToken = null;
      currentUser = null;
      currentRoom = null;
      await showCustomAlert('Les données locales de session ont été effacées.', 'Réinitialisation Faite', 'success');
      showLandingPage();
      updateNavButtons();
    });
  }
}

// 4. Synchronisation WebSockets Temps Réel & Appairage Handshake
function initSocketConnection() {
  socket = io(API_BASE || 'http://172.20.10.7:5000');

  socket.on('connect', () => {
    console.log('⚡ Connecté aux WebSockets FIDIKO:', socket.id);
  });

  socket.on('admin:pending_associations_update', (data) => {
    renderPendingAssociationsList(data.pending);
  });

  socket.on('admin:connected_devices_update', (data) => {
    renderConnectedDevicesList(data.devices);
  });

  socket.on('booth:association_accepted', (data) => {
    console.log('✅ Demande d\'association ACCEPTÉE !');
    showBoothViewState('locked');
  });

  socket.on('booth:association_rejected', (data) => {
    console.log('❌ Demande d\'association REFUSÉE !');
    showBoothViewState('rejected');
  });

  socket.on('booth:device_unlocked', (data) => {
    console.log('🔓 Cet isoloir a été déverrouillé !');
    showBoothViewState('active');
  });

  socket.on('booth:device_locked', (data) => {
    console.log('🔒 Cet isoloir est verrouillé.');
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

  socket.on('room:new_round_started', (data) => {
    console.log('🔄 Nouveau tour démarré:', data);
    if (currentRoom && currentRoom.id === data.room_id) {
      currentRoom = data.room;
      updateRoomStatusUI('ACTIVE');
      const counterEl = document.getElementById('liveGlobalVoteCount');
      if (counterEl) counterEl.textContent = '0';

      renderVoterCandidates(data.candidates);
      showBoothViewState('locked');
      showCustomAlert(`Le ${data.round_type === 'SECOND_ROUND' ? 'Deuxième Tour' : 'Nouveau Tour'} a démarré ! Seuls les candidats qualifiés sont en lice.`, 'Nouveau Tour de Scrutin', 'info');
    }
  });

  // Notif socket : Nouvelle demande d'accès d'un électeur reçue par l'Admin
  socket.on('voter:request_access', (data) => {
    console.log('📬 Nouvelle demande d\'accès électeur reçue:', data);
    if (currentRoom && currentRoom.id === data.room_id) {
      loadAdminRoomVoters(currentRoom.id);
      showCustomAlert(`Nouvelle demande de participation au vote de "${data.user.full_name}" (${data.user.email}).`, 'Demande d\'Électeur', 'info');
    }
  });

  // Notif socket : Statut d'un électeur mis à jour (pour l'admin et l'électeur)
  socket.on('voter:status_updated', (data) => {
    if (currentRoom && currentRoom.id === data.room_id) {
      loadAdminRoomVoters(currentRoom.id);
    }
  });

  // Notif socket privée pour l'électeur : validation ou refus de son accès
  socket.on('voter:my_access_updated', (data) => {
    console.log('🔔 Mise à jour de mon accès reçue:', data);
    showCustomAlert(data.message, 'Validation Scrutin', data.status === 'APPROVED' ? 'success' : 'danger');
    const savedVoterRoomId = localStorage.getItem('fidiko_voter_room_id');
    if (savedVoterRoomId && savedVoterRoomId === data.room_id) {
      checkVoterRoomStatus(data.room_id);
    }
  });

  // Notif socket privée pour l'électeur : annulation de son vote par l'administrateur
  socket.on('voter:my_vote_cancelled', (data) => {
    showCustomAlert(data.message, 'Vote Annulé', 'danger');
    const savedVoterRoomId = localStorage.getItem('fidiko_voter_room_id');
    if (savedVoterRoomId && savedVoterRoomId === data.room_id) {
      checkVoterRoomStatus(data.room_id);
    }
  });

  // Notifs de Rappel Automatique (10 minutes et 5 minutes avant la clôture)
  socket.on('room:vote_reminder', (data) => {
    console.log('⏰ Rappel de fin de vote reçu:', data);
    showCustomAlert(data.message, `Rappel Clôture (${data.minutes_left} min)`, data.minutes_left <= 5 ? 'danger' : 'info');
    if (navigator.vibrate) {
      navigator.vibrate([200, 100, 200]);
    }
  });

  socket.on('room:vote_reminder_broadcast', (data) => {
    console.log('📢 Broadcast rappel clôture:', data);
    showCustomAlert(data.message, `Scrutin : Plus que ${data.minutes_left} min !`, data.minutes_left <= 5 ? 'danger' : 'info');
  });
}

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

function respondAssociation(deviceId, approved) {
  if (!currentRoom) return;

  socket.emit('admin:respond_association', {
    room_id: currentRoom.id,
    device_id: deviceId,
    approved: approved,
  });
}

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

// 5. Configuration des Événements UI & 3 Options Landing Page
function setupEventListeners() {
  document.getElementById('brandHomeBtn').addEventListener('click', () => {
    if (currentToken && currentUser && currentUser.role === 'admin') {
      showAdminDashboard();
    } else {
      showLandingPage();
    }
  });

  // 3 OPTIONS DISTINCTES DE LA LANDING PAGE
  document.getElementById('navAuthBtn').addEventListener('click', showLoginSection);
  document.getElementById('landingLoginBtn').addEventListener('click', showLoginSection);
  document.getElementById('landingRegisterBtn').addEventListener('click', showRegisterSection);
  document.getElementById('landingJoinBoothBtn').addEventListener('click', showBoothJoinSection);

  // NAVIGATION VERS AIDE, PARAMÈTRES ET À PROPOS
  const navGuideBtn = document.getElementById('navGuideBtn');
  const navSettingsBtn = document.getElementById('navSettingsBtn');
  const navAboutBtn = document.getElementById('navAboutBtn');
  const footerGuideLink = document.getElementById('footerGuideLink');
  const footerSettingsLink = document.getElementById('footerSettingsLink');
  const footerAboutLink = document.getElementById('footerAboutLink');

  // GESTION DU MENU (AFFICHER / MASQUER SUR MOBILE ET DESKTOP)
  const mobileMenuToggleBtn = document.getElementById('mobileMenuToggleBtn');
  const navActionsMenu = document.getElementById('navActionsMenu');
  const navBackdrop = document.getElementById('navBackdrop');
  const menuToggleIcon = document.getElementById('menuToggleIcon');

  function openMobileMenu() {
    if (navActionsMenu) navActionsMenu.classList.add('open');
    if (navBackdrop) {
      navBackdrop.style.display = 'block';
      setTimeout(() => navBackdrop.classList.add('active'), 10);
    }
    if (mobileMenuToggleBtn) mobileMenuToggleBtn.setAttribute('aria-expanded', 'true');
    if (menuToggleIcon) {
      menuToggleIcon.classList.remove('fa-bars');
      menuToggleIcon.classList.add('fa-xmark');
    }
  }

  function closeMobileMenu() {
    if (navActionsMenu) navActionsMenu.classList.remove('open');
    if (navBackdrop) {
      navBackdrop.classList.remove('active');
      setTimeout(() => { navBackdrop.style.display = 'none'; }, 300);
    }
    if (mobileMenuToggleBtn) mobileMenuToggleBtn.setAttribute('aria-expanded', 'false');
    if (menuToggleIcon) {
      menuToggleIcon.classList.remove('fa-xmark');
      menuToggleIcon.classList.add('fa-bars');
    }
  }

  function toggleMenu() {
    const isMobile = window.innerWidth <= 992;
    if (isMobile) {
      if (navActionsMenu && navActionsMenu.classList.contains('open')) {
        closeMobileMenu();
      } else {
        openMobileMenu();
      }
    } else {
      // Grand écran : masquer ou réafficher la barre de navigation
      if (navActionsMenu) {
        const isHidden = navActionsMenu.classList.toggle('desktop-hidden');
        if (mobileMenuToggleBtn) {
          mobileMenuToggleBtn.setAttribute('aria-expanded', String(!isHidden));
        }
        if (menuToggleIcon) {
          if (isHidden) {
            menuToggleIcon.classList.remove('fa-bars');
            menuToggleIcon.classList.add('fa-bars-staggered');
          } else {
            menuToggleIcon.classList.remove('fa-bars-staggered');
            menuToggleIcon.classList.add('fa-bars');
          }
        }
      }
    }
  }

  if (mobileMenuToggleBtn) {
    mobileMenuToggleBtn.addEventListener('click', toggleMenu);
  }

  if (navBackdrop) {
    navBackdrop.addEventListener('click', closeMobileMenu);
  }

  window.addEventListener('resize', () => {
    if (window.innerWidth > 992) {
      closeMobileMenu();
    }
  });

  // BOUTON LOGO / MARQUE (Redirige vers Accueil si connecté, sinon Landing)
  const brandHomeBtn = document.getElementById('brandHomeBtn');
  if (brandHomeBtn) {
    brandHomeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (currentToken && currentUser) {
        showHomeSection();
      } else {
        showLandingPage();
      }
    });
  }

  // BOUTONS DE NAVIGATION PRINCIPAUX (ACCUEIL & ESPACE)
  const navHomeBtn = document.getElementById('navHomeBtn');
  if (navHomeBtn) {
    navHomeBtn.addEventListener('click', () => {
      showHomeSection();
      closeMobileMenu();
    });
  }

  const navDashboardBtn = document.getElementById('navDashboardBtn');
  if (navDashboardBtn) {
    navDashboardBtn.addEventListener('click', () => {
      if (currentUser && currentUser.role === 'admin') {
        showAdminDashboard();
      } else {
        showVoterDashboard();
      }
      closeMobileMenu();
    });
  }

  // BOUTONS DE LA PAGE D'ACCUEIL CONNECTÉE (#homeSection)
  const homeVoterJoinAsVoterBtn = document.getElementById('homeVoterJoinAsVoterBtn');
  if (homeVoterJoinAsVoterBtn) {
    homeVoterJoinAsVoterBtn.addEventListener('click', () => {
      showVoterDashboard();
    });
  }

  const homeVoterJoinAsBoothBtn = document.getElementById('homeVoterJoinAsBoothBtn');
  if (homeVoterJoinAsBoothBtn) {
    homeVoterJoinAsBoothBtn.addEventListener('click', () => {
      showBoothJoinSection();
    });
  }

  const homeAdminGoToDashboardBtn = document.getElementById('homeAdminGoToDashboardBtn');
  if (homeAdminGoToDashboardBtn) {
    homeAdminGoToDashboardBtn.addEventListener('click', () => {
      showAdminDashboard();
    });
  }

  // Fermer automatiquement le menu mobile lors du clic sur un lien/bouton de navigation
  const navItems = [
    navHomeBtn,
    navDashboardBtn,
    navGuideBtn,
    navSettingsBtn,
    navAboutBtn,
    document.getElementById('navAuthBtn'),
    document.getElementById('logoutBtn')
  ];
  navItems.forEach(item => {
    if (item) {
      item.addEventListener('click', () => {
        closeMobileMenu();
      });
    }
  });

  if (navGuideBtn) navGuideBtn.addEventListener('click', showGuideSection);
  if (navSettingsBtn) navSettingsBtn.addEventListener('click', showSettingsSection);
  if (navAboutBtn) navAboutBtn.addEventListener('click', showAboutSection);

  if (footerGuideLink) footerGuideLink.addEventListener('click', showGuideSection);
  if (footerSettingsLink) footerSettingsLink.addEventListener('click', showSettingsSection);
  if (footerAboutLink) footerAboutLink.addEventListener('click', showAboutSection);

  // Boutons de fermeture des sections d'info (Retour à l'accueil si connecté)
  document.querySelectorAll('.close-guide-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (currentToken && currentUser) showHomeSection();
      else showLandingPage();
    });
  });
  document.querySelectorAll('.close-settings-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (currentToken && currentUser) showHomeSection();
      else showLandingPage();
    });
  });
  document.querySelectorAll('.close-about-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (currentToken && currentUser) showHomeSection();
      else showLandingPage();
    });
  });

  // Gestion des boutons de la section Paramètres
  setupSettingsHandlers();

  document.querySelectorAll('.close-auth-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (currentToken && currentUser) showHomeSection();
      else showLandingPage();
    });
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

  const backToDashBtn = document.getElementById('backToDashboardFromResultsBtn');
  if (backToDashBtn) {
    backToDashBtn.addEventListener('click', () => {
      if (currentUser && currentUser.role === 'admin') {
        showAdminDashboard();
      } else {
        showLandingPage();
      }
    });
  }

  // ---------------------------------------------------------
  // GESTION DU MASQUAGE / VISIBILITÉ DU MOT DE PASSE (EYE TOGGLE)
  // ---------------------------------------------------------
  document.querySelectorAll('.password-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      const icon = btn.querySelector('i');
      if (input) {
        if (input.type === 'password') {
          input.type = 'text';
          if (icon) {
            icon.classList.remove('fa-eye');
            icon.classList.add('fa-eye-slash');
          }
        } else {
          input.type = 'password';
          if (icon) {
            icon.classList.remove('fa-eye-slash');
            icon.classList.add('fa-eye');
          }
        }
      }
    });
  });

  // Basculer entre Login et Inscription / Mot de passe oublié
  const loginToRegLink = document.getElementById('loginToRegisterLink');
  const regToLoginLink = document.getElementById('registerToLoginLink');
  const goToForgotLink = document.getElementById('goToForgotPasswordLink');
  const backToLoginFromForgot = document.getElementById('backToLoginFromForgotLink');
  const cancelOtpLink = document.getElementById('cancelOtpLink');

  if (loginToRegLink) loginToRegLink.addEventListener('click', showRegisterSection);
  if (regToLoginLink) regToLoginLink.addEventListener('click', showLoginSection);
  if (goToForgotLink) goToForgotLink.addEventListener('click', showForgotPasswordSection);
  if (backToLoginFromForgot) backToLoginFromForgot.addEventListener('click', showLoginSection);
  if (cancelOtpLink) cancelOtpLink.addEventListener('click', showRegisterSection);

  // Variable temporaire pour l'email en cours de validation OTP
  let pendingOtpEmail = '';
  let pendingResetEmail = '';

  // SE CONNECTER UNIQUEMENT
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const roleEl = document.getElementById('loginRole');
    const role = roleEl ? roleEl.value : null;

    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, role }),
      });
      const data = await res.json();
      
      // Si le compte nécessite validation OTP
      if (res.status === 403 && data.requires_otp) {
        pendingOtpEmail = data.email || email;
        showCustomAlert(data.error, 'Validation Requise', 'info');
        showOtpVerifySection(pendingOtpEmail);
        return;
      }

      if (!res.ok) throw new Error(data.error);

      currentToken = data.token;
      currentUser = data.user;
      localStorage.setItem('fidiko_token', currentToken);
      localStorage.setItem('fidiko_user', JSON.stringify(currentUser));
      
      updateNavButtons();
      showHomeSection();
    } catch (err) {
      showCustomAlert('Erreur de connexion: ' + err.message, 'Erreur de Connexion', 'danger');
    }
  });

  // S'INSCRIRE AVEC CONFIRMATION DE MOT DE PASSE ET ENVOI DE CODE OTP
  document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const full_name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const passwordConfirm = document.getElementById('regPasswordConfirm').value;
    const role = document.getElementById('regRole').value;

    // 1. Vérification stricte de correspondance des mots de passe
    if (password !== passwordConfirm) {
      showCustomAlert('Les deux mots de passe saisis ne sont pas identiques. Veuillez vérifier.', 'Mots de passe non concordants', 'danger');
      return;
    }

    if (password.length < 6) {
      showCustomAlert('Le mot de passe doit comporter au moins 6 caractères.', 'Sécurité du mot de passe', 'danger');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name, email, password, role }),
      });
      const data = await handleFetchResponse(res);

      pendingOtpEmail = email;
      await showCustomAlert(data.message, 'Code OTP Envoyé', 'success');

      // Basculer vers l'écran de validation OTP
      showOtpVerifySection(pendingOtpEmail);
    } catch (err) {
      showCustomAlert('Erreur lors de l\'inscription: ' + err.message, 'Erreur d\'Inscription', 'danger');
    }
  });

  // VALIDATION DU CODE OTP POUR FINALISER L'INSCRIPTION
  const otpVerifyForm = document.getElementById('otpVerifyForm');
  if (otpVerifyForm) {
    otpVerifyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const otpCode = document.getElementById('regOtpInput').value.trim();

      if (!pendingOtpEmail) {
        showCustomAlert('Session expirée ou e-mail manquant. Veuillez recommencer l\'inscription.', 'Erreur', 'danger');
        showRegisterSection();
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/api/auth/verify-registration-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: pendingOtpEmail, otp_code: otpCode }),
        });
        const data = await handleFetchResponse(res);

        currentToken = data.token;
        currentUser = data.user;
        localStorage.setItem('fidiko_token', currentToken);
        localStorage.setItem('fidiko_user', JSON.stringify(currentUser));

        await showCustomAlert('Votre compte a été vérifié et activé avec succès ! Bienvenue sur FIDIKO.', 'Compte Validé', 'success');
        updateNavButtons();
        showHomeSection();
      } catch (err) {
        showCustomAlert('Erreur de validation OTP: ' + err.message, 'Code Invalide', 'danger');
      }
    });
  }

  // RENVOYER UN CODE OTP D'INSCRIPTION
  const resendOtpBtn = document.getElementById('resendOtpBtn');
  if (resendOtpBtn) {
    resendOtpBtn.addEventListener('click', async () => {
      if (!pendingOtpEmail) return;
      try {
        const res = await fetch(`${API_BASE}/api/auth/resend-registration-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: pendingOtpEmail }),
        });
        const data = await handleFetchResponse(res);
        showCustomAlert(data.message, 'Nouveau Code OTP', 'success');
      } catch (err) {
        showCustomAlert('Erreur: ' + err.message, 'Erreur de Renvoi', 'danger');
      }
    });
  }

  // DEMANDE DE MOT DE PASSE OUBLIÉ (ÉTAPE 1)
  const forgotReqForm = document.getElementById('forgotPasswordRequestForm');
  if (forgotReqForm) {
    forgotReqForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('forgotEmail').value.trim();
      try {
        const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await handleFetchResponse(res);

        pendingResetEmail = email;
        const display = document.getElementById('forgotTargetEmailDisplay');
        if (display) display.textContent = email;

        await showCustomAlert(data.message, 'Code OTP Envoyé', 'info');
        document.getElementById('forgotPasswordStep1').style.display = 'none';
        document.getElementById('forgotPasswordStep2').style.display = 'block';
      } catch (err) {
        showCustomAlert('Erreur: ' + err.message, 'Erreur', 'danger');
      }
    });
  }

  // VALIDATION OTP & CHANGEMENT DE MOT DE PASSE (ÉTAPE 2)
  const resetSubmitForm = document.getElementById('resetPasswordSubmitForm');
  if (resetSubmitForm) {
    resetSubmitForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const otpCode = document.getElementById('resetOtpCode').value.trim();
      const newPassword = document.getElementById('newPassword').value;
      const newPasswordConfirm = document.getElementById('newPasswordConfirm').value;

      if (newPassword !== newPasswordConfirm) {
        showCustomAlert('Les deux mots de passe ne correspondent pas.', 'Erreur', 'danger');
        return;
      }

      if (newPassword.length < 6) {
        showCustomAlert('Le nouveau mot de passe doit comporter au moins 6 caractères.', 'Erreur', 'danger');
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: pendingResetEmail,
            otp_code: otpCode,
            new_password: newPassword,
          }),
        });
        const data = await handleFetchResponse(res);

        await showCustomAlert(data.message, 'Mot de Passe Modifié', 'success');
        showLoginSection();
      } catch (err) {
        showCustomAlert('Erreur: ' + err.message, 'Erreur de Réinitialisation', 'danger');
      }
    });
  }

  document.getElementById('openCreateRoomBtn').addEventListener('click', () => {
    document.getElementById('createRoomFormContainer').style.display = 'block';
  });

  document.getElementById('cancelCreateRoomBtn').addEventListener('click', () => {
    document.getElementById('createRoomFormContainer').style.display = 'none';
  });

  // CRÉATION DE SALON -> Statut initial INACTIVE
  document.getElementById('createRoomForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('roomTitleInput').value;
    const description = document.getElementById('roomDescInput').value;
    const startTimeInput = document.getElementById('roomStartTimeInput');
    const endTimeInput = document.getElementById('roomEndTimeInput');

    const start_time = startTimeInput && startTimeInput.value ? new Date(startTimeInput.value).toISOString() : null;
    const end_time = endTimeInput && endTimeInput.value ? new Date(endTimeInput.value).toISOString() : null;

    try {
      const res = await fetch(`${API_BASE}/api/rooms/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`,
        },
        body: JSON.stringify({ title, description, start_time, end_time }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      await showCustomAlert(`Salon "${data.room.title}" créé en statut INACTIVE ! Code: ${data.room.code}`, 'Salon Créé', 'success');
      document.getElementById('createRoomFormContainer').style.display = 'none';
      document.getElementById('createRoomForm').reset();
      
      loadRoomByCode(data.room.code);
    } catch (err) {
      showCustomAlert('Erreur: ' + err.message, 'Erreur de Création', 'danger');
    }
  });

  // BOUTON ACTIVATION DU SCRUTIN (INACTIVE -> ACTIVE -> CLOSED)
  document.getElementById('activateRoomBtn').addEventListener('click', async () => {
    if (!currentRoom) return;

    const newStatus = currentRoom.status === 'INACTIVE' ? 'ACTIVE' : 'INACTIVE';
    try {
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
      showCustomAlert(
        `Scrutin ${currentRoom.status === 'ACTIVE' ? 'ACTIVÉ ! Le gel strict des modifications est désormais en vigueur.' : 'repasse en mode INACTIVE (Préparation).'}`,
        'Statut du Scrutin',
        currentRoom.status === 'ACTIVE' ? 'success' : 'info'
      );
    } catch (err) {
      showCustomAlert('Erreur lors du changement d\'état du scrutin: ' + err.message, 'Erreur de Statut', 'danger');
    }
  });

  // SUPPRIMER LE SALON (Admin)
  document.getElementById('deleteRoomBtn').addEventListener('click', async () => {
    if (!currentRoom) return;
    const confirmed = await showCustomDialog({
      title: 'Supprimer le Salon',
      message: `Voulez-vous vraiment supprimer définitivement le salon "${currentRoom.title}" ?`,
      icon: 'trash',
      type: 'danger',
      confirmText: 'Oui, Supprimer',
      cancelText: 'Annuler'
    });
    if (!confirmed) return;

    try {
      const res = await fetch(`${API_BASE}/api/rooms/${currentRoom.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${currentToken}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      await showCustomAlert('Le salon a été supprimé avec succès.', 'Salon Supprimé', 'success');
      currentRoom = null;
      showAdminDashboard();
    } catch (err) {
      showCustomAlert('Erreur: ' + err.message, 'Erreur de Suppression', 'danger');
    }
  });

  // REJOINDRIS COMME ISOLOIR PHYSIQUE
  document.getElementById('joinRoomBtn').addEventListener('click', () => {
    const code = document.getElementById('guestRoomCode').value.trim();
    if (code) {
      loadRoomByCode(code);
    } else {
      showCustomAlert('Veuillez saisir un code à 6 chiffres.', 'Code Requis', 'info');
    }
  });

  // CHOIX DE LA PHOTO DU CANDIDAT (Depuis le téléphone ou le PC)
  const candPhotoFileInput = document.getElementById('candPhotoFile');
  const candPhotoPreview = document.getElementById('candPhotoPreview');
  const candPhotoPreviewContainer = document.getElementById('candPhotoPreviewContainer');
  const removePhotoBtn = document.getElementById('removePhotoBtn');

  if (candPhotoFileInput) {
    candPhotoFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        if (file.size > 5 * 1024 * 1024) {
          showCustomAlert('La taille de la photo ne doit pas dépasser 5 Mo.', 'Fichier Trop Volumineux', 'danger');
          candPhotoFileInput.value = '';
          return;
        }
        const reader = new FileReader();
        reader.onload = (event) => {
          selectedCandidatePhotoBase64 = event.target.result;
          if (candPhotoPreview) candPhotoPreview.src = selectedCandidatePhotoBase64;
          if (candPhotoPreviewContainer) candPhotoPreviewContainer.style.display = 'flex';
        };
        reader.readAsDataURL(file);
      }
    });
  }

  if (removePhotoBtn) {
    removePhotoBtn.addEventListener('click', () => {
      selectedCandidatePhotoBase64 = '';
      if (candPhotoFileInput) candPhotoFileInput.value = '';
      if (candPhotoPreviewContainer) candPhotoPreviewContainer.style.display = 'none';
    });
  }

  // AJOUTER UN CANDIDAT (Avec Numéro d'Ordre, Photo Choisie & Vérification de Gel)
  document.getElementById('addCandidateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentRoom) return;

    if (currentRoom.status !== 'INACTIVE') {
      showCustomAlert('GEL STRICT EN VIGUEUR : Impossible d\'ajouter un candidat en mode ACTIVE ou CLOSED.', 'Gel du Scrutin', 'danger');
      return;
    }

    const candidate_number = document.getElementById('candNumber').value;
    const first_name = document.getElementById('candFirstName').value;
    const last_name = document.getElementById('candLastName').value;
    const party_name = document.getElementById('candParty').value;
    const color_code = document.getElementById('candColor').value;
    const photo_url = selectedCandidatePhotoBase64 || '';

    try {
      const res = await fetch(`${API_BASE}/api/candidates/add`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`,
        },
        body: JSON.stringify({
          room_id: currentRoom.id,
          candidate_number,
          first_name,
          last_name,
          party_name,
          color_code,
          photo_url,
        }),
      });
      await handleFetchResponse(res);

      document.getElementById('addCandidateForm').reset();
      selectedCandidatePhotoBase64 = '';
      if (candPhotoPreviewContainer) candPhotoPreviewContainer.style.display = 'none';
      loadRoomByCode(currentRoom.code);
    } catch (err) {
      showCustomAlert('Erreur: ' + err.message, 'Erreur Candidat', 'danger');
    }
  });

  // CLÔTURER LE SCRUTIN (CLOSED)
  document.getElementById('closeRoomBtn').addEventListener('click', async () => {
    if (!currentRoom) return;
    const confirmed = await showCustomDialog({
      title: 'Clôture du Scrutin',
      message: 'Voulez-vous vraiment clôturer le vote et démarrer le compte à rebours de 10 secondes ?\nCette action est irréversible pour le tour en cours.',
      icon: 'stop',
      type: 'danger',
      confirmText: 'Clôturer le Scrutin',
      cancelText: 'Annuler'
    });
    if (!confirmed) return;

    try {
      const res = await fetch(`${API_BASE}/api/rooms/${currentRoom.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}`,
        },
        body: JSON.stringify({ status: 'CLOSED' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      currentRoom = data.room;
      updateRoomStatusUI('CLOSED');
      socket.emit('results:start_countdown', { room_id: currentRoom.id });
    } catch (err) {
      showCustomAlert('Erreur: ' + err.message, 'Erreur de Clôture', 'danger');
    }
  });
}

// Update Room Status UI & Enforce Strict Freeze Badges
function updateRoomStatusUI(status) {
  const badge = document.getElementById('adminRoomStatusBadge');
  const activateBtn = document.getElementById('activateRoomBtn');
  const deleteBtn = document.getElementById('deleteRoomBtn');
  const candSubmitBtn = document.getElementById('addCandidateSubmitBtn');
  const candFreezeBadge = document.getElementById('candidateFreezeBadge');

  if (!badge || !activateBtn) return;

  if (status === 'ACTIVE') {
    badge.textContent = '● SCRUTIN EN COURS (ACTIF)';
    badge.style.backgroundColor = 'rgba(6, 214, 160, 0.2)';
    badge.style.color = '#06D6A0';
    
    activateBtn.className = 'btn btn-outline';
    activateBtn.innerHTML = '<i class="fa-solid fa-pause"></i> Mettre en Pause (INACTIVE)';

    deleteBtn.disabled = true;
    deleteBtn.style.opacity = '0.4';
    deleteBtn.title = 'Impossible de supprimer un salon en mode ACTIVE';

    candSubmitBtn.disabled = true;
    candSubmitBtn.style.opacity = '0.4';
    candFreezeBadge.style.display = 'inline-block';
  } else if (status === 'CLOSED') {
    badge.textContent = '● SCRUTIN CLÔTURÉ';
    badge.style.backgroundColor = 'rgba(217, 4, 41, 0.2)';
    badge.style.color = '#D90429';

    activateBtn.style.display = 'none';

    deleteBtn.disabled = false;
    deleteBtn.style.opacity = '1';

    candSubmitBtn.disabled = true;
    candSubmitBtn.style.opacity = '0.4';
    candFreezeBadge.style.display = 'inline-block';
  } else {
    badge.textContent = '● SCRUTIN INACTIF (PRÉPARATION)';
    badge.style.backgroundColor = 'rgba(255, 209, 102, 0.2)';
    badge.style.color = '#FFD166';

    activateBtn.className = 'btn btn-success';
    activateBtn.innerHTML = '<i class="fa-solid fa-play"></i> Activer le Scrutin';

    deleteBtn.disabled = false;
    deleteBtn.style.opacity = '1';

    candSubmitBtn.disabled = false;
    candSubmitBtn.style.opacity = '1';
    candFreezeBadge.style.display = 'none';
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
      container.innerHTML = '<p style="color: var(--text-sub);">Vous n\'avez aucun salon. Cliquez sur "Créer un nouveau Salon de Vote" ci-dessus pour démarrer.</p>';
      return;
    }

    container.innerHTML = rooms.map(r => `
      <div class="candidate-card" style="margin-bottom: 0.75rem;">
        <div>
          <div class="candidate-name">${r.title} <span style="font-size: 0.8rem; padding: 0.2rem 0.5rem; border-radius: 12px; background: ${r.status === 'ACTIVE' ? 'rgba(6,214,160,0.2)' : 'rgba(255,209,102,0.2)'}; color: ${r.status === 'ACTIVE' ? '#06D6A0' : '#FFD166'}">${r.status}</span></div>
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
      
      // Affichage des horaires
      const startEl = document.getElementById('adminStartTimeDisplay');
      const endEl = document.getElementById('adminEndTimeDisplay');
      if (startEl) startEl.textContent = currentRoom.start_time ? new Date(currentRoom.start_time).toLocaleString('fr-FR') : 'Libre (Dès activation)';
      if (endEl) endEl.textContent = currentRoom.end_time ? new Date(currentRoom.end_time).toLocaleString('fr-FR') : 'Illimitée (Jusqu\'à clôture)';

      updateRoomStatusUI(currentRoom.status);
      renderAdminCandidates(data.candidates);
      loadAdminRoomVoters(currentRoom.id);
    } else {
      // Si l'utilisateur connecté est un électeur, il peut utiliser l'isoloir ou son espace
      socket.emit('booth:request_association', {
        room_id: currentRoom.id,
        device_id: myDeviceId,
        device_name: getDeviceName(),
        user_role: currentUser ? currentUser.role : 'visitor',
      });

      document.getElementById('voterBoothSection').style.display = 'block';
      document.getElementById('terminalDeviceLabel').innerHTML = `<i class="fa-solid fa-mobile-screen-button" style="color: #06D6A0;"></i> ${getDeviceName()}`;
      
      showBoothViewState('pending');
      renderVoterCandidates(data.candidates);
    }
  } catch (err) {
    showCustomAlert('Erreur lors du chargement du salon: ' + err.message, 'Erreur de Chargement', 'danger');
  }
}

function showBoothViewState(state) {
  const pendingView = document.getElementById('boothPendingView');
  const rejectedView = document.getElementById('boothRejectedView');
  const lockedView = document.getElementById('boothLockedView');
  const activeView = document.getElementById('boothActiveView');
  const thankYouView = document.getElementById('boothThankYouView');
  const statusBadge = document.getElementById('terminalStatusBadge');

  if (pendingView) pendingView.style.display = 'none';
  if (rejectedView) rejectedView.style.display = 'none';
  if (lockedView) lockedView.style.display = 'none';
  if (activeView) activeView.style.display = 'none';
  if (thankYouView) thankYouView.style.display = 'none';

  if (state === 'pending') {
    if (pendingView) pendingView.style.display = 'block';
    if (statusBadge) {
      statusBadge.textContent = '🟡 ATTENTE VALIDATION ADMIN...';
      statusBadge.style.backgroundColor = 'rgba(255,209,102,0.2)';
      statusBadge.style.color = '#FFD166';
    }
  } else if (state === 'rejected') {
    if (rejectedView) rejectedView.style.display = 'block';
    if (statusBadge) {
      statusBadge.textContent = '🔴 APPAIRAGE REFUSÉ';
      statusBadge.style.backgroundColor = 'rgba(217,4,41,0.2)';
      statusBadge.style.color = '#D90429';
    }
  } else if (state === 'locked') {
    if (lockedView) lockedView.style.display = 'block';
    if (statusBadge) {
      statusBadge.textContent = '🔴 ISOLOIR VERROUILLÉ';
      statusBadge.style.backgroundColor = 'rgba(255,209,102,0.2)';
      statusBadge.style.color = '#FFD166';
    }
  } else if (state === 'active') {
    if (activeView) activeView.style.display = 'block';
    if (statusBadge) {
      statusBadge.textContent = '🟢 ISOLOIR DÉVERROUILLÉ';
      statusBadge.style.backgroundColor = 'rgba(6,214,160,0.2)';
      statusBadge.style.color = '#06D6A0';
    }
  } else if (state === 'thankyou') {
    if (thankYouView) thankYouView.style.display = 'block';
    if (statusBadge) {
      statusBadge.textContent = '✅ VOTE ENREGISTRÉ';
      statusBadge.style.backgroundColor = 'rgba(6,214,160,0.2)';
      statusBadge.style.color = '#06D6A0';
    }
  }
}

// Helper d'affichage de la photo ou avatar initiales
function getCandidateAvatarHtml(c, size = 56) {
  if (c.photo_url && c.photo_url.trim() !== '') {
    return `
      <div style="position: relative; width: ${size}px; height: ${size}px; min-width: ${size}px;">
        <img src="${c.photo_url}" class="candidate-photo-img" style="width: ${size}px; height: ${size}px;" alt="${c.first_name}"
             onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
        <div class="candidate-avatar" style="background-color: ${c.color_code || '#1C2541'}; width: ${size}px; height: ${size}px; display: none; font-size: 1.2rem;">
          ${c.first_name[0]}${c.last_name[0]}
        </div>
      </div>
    `;
  }
  return `
    <div class="candidate-avatar" style="background-color: ${c.color_code || '#1C2541'}; width: ${size}px; height: ${size}px; min-width: ${size}px; font-size: 1.2rem;">
      ${c.first_name[0]}${c.last_name[0]}
    </div>
  `;
}

// Render Candidates Sorted by candidate_number
function renderAdminCandidates(candidates) {
  const container = document.getElementById('adminCandidatesList');
  if (!candidates || candidates.length === 0) {
    container.innerHTML = '<p style="color: var(--text-sub);">Aucun candidat enregistré dans la base de données.</p>';
    return;
  }

  const isFrozen = currentRoom && currentRoom.status !== 'INACTIVE';

  container.innerHTML = candidates.map(c => `
    <div class="candidate-card ${c.is_disqualified ? 'disqualified' : ''}" id="admin-cand-${c.id}">
      <div style="display: flex; align-items: center; gap: 1rem;">
        <div class="candidate-number-badge" style="width: 42px; height: 42px; min-width: 42px; font-size: 1.1rem;">
          N°${c.candidate_number}
        </div>
        ${getCandidateAvatarHtml(c, 52)}
        <div class="candidate-info">
          <div class="candidate-name" style="font-size: 1.15rem; font-weight: 800;">
            ${c.first_name} ${c.last_name} ${c.is_disqualified ? '<span style="color: var(--status-disqualified); font-size: 0.8rem;">(DISQUALIFIÉ)</span>' : ''}
          </div>
          <div class="candidate-party">${c.party_name || 'Candidat Indépendant'}</div>
        </div>
      </div>
      <div style="display: flex; gap: 0.5rem;">
        <button class="btn ${c.is_disqualified ? 'btn-success' : 'btn-danger'}" onclick="toggleDisqualification('${c.id}', ${!c.is_disqualified})">
          ${c.is_disqualified ? '<i class="fa-solid fa-user-check"></i> Réhabiliter' : '<i class="fa-solid fa-user-slash"></i> Disqualifier'}
        </button>
        <button class="btn btn-outline" ${isFrozen ? 'disabled style="opacity: 0.4;" title="Gel strict en vigueur"' : ''} onclick="deleteCandidate('${c.id}')">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>
  `).join('');
}

async function deleteCandidate(candidateId) {
  if (currentRoom && currentRoom.status !== 'INACTIVE') {
    showCustomAlert('GEL STRICT EN VIGUEUR : Impossible de supprimer un candidat lorsque le scrutin est ACTIF ou CLÔTURÉ.', 'Scrutin Verrouillé', 'danger');
    return;
  }
  const confirmed = await showCustomDialog({
    title: 'Supprimer le Candidat',
    message: 'Voulez-vous vraiment retirer ce candidat du scrutin ?',
    icon: 'trash',
    type: 'danger',
    confirmText: 'Supprimer',
    cancelText: 'Annuler'
  });
  if (!confirmed) return;

  try {
    const res = await fetch(`${API_BASE}/api/candidates/${candidateId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${currentToken}` },
    });
    await handleFetchResponse(res);

    loadRoomByCode(currentRoom.code);
  } catch (err) {
    showCustomAlert('Erreur: ' + err.message, 'Erreur de Suppression', 'danger');
  }
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
    await handleFetchResponse(res);
  } catch (err) {
    showCustomAlert('Erreur: ' + err.message, 'Erreur de Disqualification', 'danger');
  }
}

// Render Voter Candidates Sorted by candidate_number (Carte épurée entourée de sa couleur, clic direct)
function renderVoterCandidates(candidates) {
  const container = document.getElementById('voterCandidatesGrid');
  if (!candidates || candidates.length === 0) {
    container.innerHTML = '<p style="color: var(--text-sub); text-align: center; grid-column: 1 / -1;">Aucun candidat au scrutin.</p>';
    return;
  }

  container.innerHTML = candidates.map(c => {
    const candColor = c.color_code || '#1C2541';

    return `
      <div class="booth-candidate-card ${c.is_disqualified ? 'disqualified' : ''}" 
           id="voter-cand-${c.id}" 
           style="border-color: ${candColor}; box-shadow: 0 6px 22px ${candColor}35;" 
           onclick="castVote('${c.id}')">
        
        <!-- 1. NUMÉRO D'ORDRE -->
        <div class="candidate-number-badge" style="border-color: ${candColor}; color: ${candColor}; min-width: 52px; height: 52px; font-size: 1.35rem;">
          N°${c.candidate_number}
        </div>

        <!-- 2. PHOTO DU CANDIDAT (OU AVATAR COULEUR) -->
        <div style="position: relative; width: 68px; height: 68px; min-width: 68px;">
          ${c.photo_url && c.photo_url.trim() !== '' ? `
            <img src="${c.photo_url}" class="candidate-photo-img" 
                 style="width: 68px; height: 68px; border: 3px solid ${candColor};" alt="${c.first_name}"
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
            <div class="candidate-avatar" style="background-color: ${candColor}; width: 68px; height: 68px; display: none; font-size: 1.4rem; border: 3px solid ${candColor};">
              ${c.first_name[0]}${c.last_name[0]}
            </div>
          ` : `
            <div class="candidate-avatar" style="background-color: ${candColor}; width: 68px; height: 68px; font-size: 1.4rem; border: 3px solid ${candColor};">
              ${c.first_name[0]}${c.last_name[0]}
            </div>
          `}
        </div>

        <!-- 3. NOM, PRÉNOM & PARTI POLITIQUE -->
        <div class="candidate-info" style="margin-left: 0;">
          <div class="candidate-name" style="font-size: 1.45rem; font-weight: 900; line-height: 1.2;">
            ${c.first_name} ${c.last_name}
          </div>
          <div class="candidate-party" style="font-size: 1.05rem; color: var(--text-sub); margin-top: 0.25rem;">
            ${c.party_name || 'Candidat Indépendant'}
          </div>
        </div>

      </div>
    `;
  }).join('');
}

async function castVote(candidateId) {
  const allowVib = localStorage.getItem('fidiko_vibration') !== 'false';
  if (allowVib && navigator.vibrate) {
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
    await handleFetchResponse(res);

    // 1. Afficher immédiatement le message "Merci d'avoir voté !"
    showBoothViewState('thankyou');

    // 2. Fermer et verrouiller automatiquement l'isoloir selon la durée configurée
    const duration = parseInt(localStorage.getItem('fidiko_thankyou_duration') || '2500', 10);
    setTimeout(() => {
      socket.emit('booth:vote_completed', {
        room_id: currentRoom.id,
        device_id: myDeviceId,
      });

      if (currentUser && currentUser.role === 'voter') {
        showVoterDashboard();
      } else {
        showBoothViewState('locked');
      }
    }, duration);

  } catch (err) {
    showCustomAlert('Erreur lors du vote: ' + err.message, 'Erreur de Vote', 'danger');
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
        btn.innerHTML = '<i class="fa-solid fa-vote-yea"></i> Voter';
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
    const data = await handleFetchResponse(res);

    hideAllSections();
    const resultsSection = document.getElementById('resultsSection');
    resultsSection.style.display = 'block';

    const verdictContainer = document.getElementById('electionVerdictBanner');
    const validCandidates = (data.results || []).filter(r => !r.is_disqualified);

    // 1. CALCUL ET PROCLAMATION OFFICIELLE DU VERDICT ÉLECTORAL
    if (data.total_votes === 0 || validCandidates.length === 0) {
      verdictContainer.innerHTML = `
        <div class="card" style="text-align: center; border: 2px dashed var(--status-warning); background: rgba(255, 209, 102, 0.05); padding: 2rem;">
          <i class="fa-solid fa-inbox" style="font-size: 3rem; color: #FFD166; margin-bottom: 0.75rem;"></i>
          <h3 style="font-size: 1.4rem; font-weight: 800; color: #FFD166;">Aucun bulletin enregistré</h3>
          <p style="color: var(--text-sub);">Aucun vote n'a été déposé dans l'urne pour ce scrutin.</p>
        </div>
      `;
    } else {
      const topCand = validCandidates[0];
      const secondCand = validCandidates[1];

      // RÈGLE 1 : ÉGALITÉ PARFAITE EN TÊTE (SCRUTIN À REFAIRE)
      if (secondCand && topCand.vote_count === secondCand.vote_count && topCand.vote_count > 0) {
        const tieCandidates = validCandidates.filter(c => c.vote_count === topCand.vote_count);

        verdictContainer.innerHTML = `
          <div class="card" style="border: 3.5px solid #FFD166; background: rgba(255, 209, 102, 0.08); padding: 2.2rem; text-align: center; border-radius: 20px; box-shadow: 0 10px 30px rgba(255, 209, 102, 0.2);">
            <div style="font-size: 4rem; color: #FFD166; margin-bottom: 0.5rem; animation: pulse 1.2s infinite alternate;">
              <i class="fa-solid fa-scale-balanced"></i>
            </div>
            <div style="display: inline-block; padding: 0.4rem 1.4rem; border-radius: 30px; background: rgba(255, 209, 102, 0.25); color: #FFD166; font-weight: 900; font-size: 0.95rem; text-transform: uppercase; margin-bottom: 0.75rem;">
              Égalité Parfaite Détectée
            </div>
            <h2 style="font-size: 2.3rem; font-weight: 900; color: #FFD166; margin-bottom: 0.5rem;">
              ÉGALITÉ PARFAITE : LE SCRUTIN DOIT ÊTRE REFAIT
            </h2>
            <p style="color: var(--text-sub); font-size: 1.15rem; max-width: 750px; margin: 0 auto 1.75rem auto;">
              Les candidats ci-dessous sont arrivés ex æquo en tête avec exactement le même score (${topCand.percentage}% soit ${topCand.vote_count} voix). Conformément aux règles électorales, une nouvelle élection doit être organisée.
            </p>
            <div style="display: flex; justify-content: center; gap: 1.5rem; flex-wrap: wrap;">
              ${tieCandidates.map(c => `
                <div class="card" style="background: var(--navy-dark); border: 2.5px solid ${c.color_code || '#FFD166'}; padding: 1.25rem 1.75rem; display: flex; align-items: center; gap: 1.25rem; border-radius: 16px;">
                  <div class="candidate-number-badge" style="border-color: ${c.color_code}; color: ${c.color_code}; min-width: 48px; height: 48px; font-size: 1.2rem;">
                    N°${c.candidate_number}
                  </div>
                  ${getCandidateAvatarHtml(c, 64)}
                  <div style="text-align: left;">
                    <div style="font-size: 1.3rem; font-weight: 900;">${c.first_name} ${c.last_name}</div>
                    <div style="font-size: 0.95rem; color: var(--text-sub);">${c.party_name || 'Candidat Indépendant'}</div>
                    <div style="font-size: 1.05rem; font-weight: 800; color: #FFD166; margin-top: 0.3rem;">
                      ${c.vote_count} voix (${c.percentage}%)
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>

            <!-- ACTION : REFAIRE LE VOTE POUR LES EX ÆQUO (SCRUTIN NON CLÔTURÉ) -->
            <div style="margin-top: 2rem; border-top: 1px solid rgba(255,209,102,0.2); padding-top: 1.5rem;">
              <p style="color: #FFD166; font-weight: 700; margin-bottom: 1rem; font-size: 1.05rem;">
                <i class="fa-solid fa-hourglass-half"></i> Le scrutin n'est pas clôturé : un nouveau vote doit départager les candidats ex æquo.
              </p>
              <button class="btn btn-success" style="padding: 0.85rem 2rem; font-size: 1.1rem; font-weight: 800;" 
                      onclick='startNextRound("${roomId}", ${JSON.stringify(tieCandidates.map(c => c.candidate_id))}, "REMATCH_TIE")'>
                <i class="fa-solid fa-rotate-right"></i> Relancer le Vote pour les Candidats Ex Æquo
              </button>
            </div>
          </div>
        `;
      }
      // RÈGLE 2 : UN CANDIDAT ATTEINT PLUS DE 50% (MAJORITÉ ABSOLUE -> ÉLU AU 1er TOUR)
      else if (topCand.percentage > 50) {
        verdictContainer.innerHTML = `
          <div class="card" style="border: 3.5px solid #06D6A0; background: linear-gradient(135deg, rgba(6, 214, 160, 0.15), rgba(11, 19, 43, 0.95)); padding: 2.5rem; text-align: center; border-radius: 20px; box-shadow: 0 10px 35px rgba(6, 214, 160, 0.25);">
            <div style="font-size: 4.5rem; color: #FFD166; margin-bottom: 0.5rem; animation: pulse 1s infinite alternate;">
              <i class="fa-solid fa-trophy"></i>
            </div>
            <div style="display: inline-block; padding: 0.4rem 1.4rem; border-radius: 30px; background: rgba(6, 214, 160, 0.25); color: #06D6A0; font-weight: 900; font-size: 0.95rem; text-transform: uppercase; margin-bottom: 0.75rem; letter-spacing: 1px;">
              Majorité Absolue Atteinte (${topCand.percentage}%)
            </div>
            <h2 style="font-size: 2.6rem; font-weight: 900; color: var(--accent-white); margin-bottom: 0.3rem;">
              CANDIDAT PROCLAMÉ ÉLU AU PREMIER TOUR
            </h2>
            <p style="color: var(--text-sub); font-size: 1.15rem; margin-bottom: 2rem;">
              Le scrutin est désormais définitivement clos. Félicitations au vainqueur !
            </p>

            <!-- CARTE DU CANDIDAT ÉLU AVEC SES DESCRIPTIONS -->
            <div class="card" style="max-width: 620px; margin: 0 auto; background: var(--navy-dark); border: 3.5px solid ${topCand.color_code || '#06D6A0'}; padding: 1.75rem; display: flex; align-items: center; gap: 1.5rem; border-radius: 18px; box-shadow: 0 8px 25px rgba(0,0,0,0.4);">
              <div class="candidate-number-badge" style="min-width: 60px; height: 60px; font-size: 1.5rem; border-color: ${topCand.color_code}; color: ${topCand.color_code};">
                N°${topCand.candidate_number}
              </div>
              ${getCandidateAvatarHtml(topCand, 84)}
              <div style="text-align: left; flex: 1;">
                <div style="font-size: 1.65rem; font-weight: 900; color: var(--accent-white);">${topCand.first_name} ${topCand.last_name}</div>
                <div style="font-size: 1.05rem; color: var(--text-sub); margin-top: 0.25rem;">${topCand.party_name || 'Candidat Indépendant'}</div>
                <div style="display: flex; gap: 1rem; margin-top: 0.6rem; align-items: center;">
                  <span style="font-size: 1.4rem; font-weight: 900; color: #06D6A0;">
                    ${topCand.percentage}%
                  </span>
                  <span style="font-size: 1rem; color: var(--text-sub);">
                    (${topCand.vote_count} bulletins sur ${data.total_votes})
                  </span>
                </div>
              </div>
            </div>
          </div>
        `;
      }
      // RÈGLE 3 : AUCUN CANDIDAT N'ATTEINT 50% (BALLOTTAGE -> DEUXIÈME TOUR REQUIS)
      else {
        verdictContainer.innerHTML = `
          <div class="card" style="border: 3.5px solid #118AB2; background: rgba(17, 138, 178, 0.08); padding: 2.5rem; text-align: center; border-radius: 20px;">
            <div style="font-size: 4rem; color: #118AB2; margin-bottom: 0.5rem;">
              <i class="fa-solid fa-users-between-lines"></i>
            </div>
            <div style="display: inline-block; padding: 0.4rem 1.4rem; border-radius: 30px; background: rgba(17, 138, 178, 0.2); color: #118AB2; font-weight: 900; font-size: 0.95rem; text-transform: uppercase; margin-bottom: 0.75rem;">
              Ballottage - Aucun Candidat à plus de 50%
            </div>
            <h2 style="font-size: 2.3rem; font-weight: 900; color: #118AB2; margin-bottom: 0.5rem;">
              ORGANISATION D'UN DEUXIÈME TOUR NÉCESSAIRE
            </h2>
            <p style="color: var(--text-sub); font-size: 1.15rem; max-width: 750px; margin: 0 auto 2rem auto;">
              Aucun candidat n'a été élu au premier tour (> 50%). Le scrutin reste ouvert pour le second tour entre les deux candidats qualifiés :
            </p>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.5rem; max-width: 800px; margin: 0 auto;">
              <!-- 1er Qualifié -->
              <div class="card" style="background: var(--navy-dark); border: 3px solid ${topCand.color_code || '#06D6A0'}; padding: 1.75rem; border-radius: 16px; text-align: center;">
                <span style="display: inline-block; padding: 0.3rem 0.9rem; border-radius: 15px; background: rgba(6, 214, 160, 0.15); color: #06D6A0; font-weight: 800; font-size: 0.85rem; margin-bottom: 0.85rem;">
                  1er QUALIFIÉ SECOND TOUR
                </span>
                <div style="display: flex; justify-content: center; margin-bottom: 0.85rem;">
                  ${getCandidateAvatarHtml(topCand, 76)}
                </div>
                <div style="font-size: 1.35rem; font-weight: 900;">N°${topCand.candidate_number} - ${topCand.first_name} ${topCand.last_name}</div>
                <div style="font-size: 0.95rem; color: var(--text-sub); margin-top: 0.25rem;">${topCand.party_name || 'Candidat Indépendant'}</div>
                <div style="font-size: 1.35rem; font-weight: 900; color: #06D6A0; margin-top: 0.75rem;">
                  ${topCand.percentage}% <span style="font-size: 0.95rem; font-weight: 600; color: var(--text-sub);">(${topCand.vote_count} voix)</span>
                </div>
              </div>

              <!-- 2ème Qualifié -->
              ${secondCand ? `
                <div class="card" style="background: var(--navy-dark); border: 3px solid ${secondCand.color_code || '#FFD166'}; padding: 1.75rem; border-radius: 16px; text-align: center;">
                  <span style="display: inline-block; padding: 0.3rem 0.9rem; border-radius: 15px; background: rgba(255, 209, 102, 0.15); color: #FFD166; font-weight: 800; font-size: 0.85rem; margin-bottom: 0.85rem;">
                    2ème QUALIFIÉ SECOND TOUR
                  </span>
                  <div style="display: flex; justify-content: center; margin-bottom: 0.85rem;">
                    ${getCandidateAvatarHtml(secondCand, 76)}
                  </div>
                  <div style="font-size: 1.35rem; font-weight: 900;">N°${secondCand.candidate_number} - ${secondCand.first_name} ${secondCand.last_name}</div>
                  <div style="font-size: 0.95rem; color: var(--text-sub); margin-top: 0.25rem;">${secondCand.party_name || 'Candidat Indépendant'}</div>
                  <div style="font-size: 1.35rem; font-weight: 900; color: #FFD166; margin-top: 0.75rem;">
                    ${secondCand.percentage}% <span style="font-size: 0.95rem; font-weight: 600; color: var(--text-sub);">(${secondCand.vote_count} voix)</span>
                  </div>
                </div>
              ` : ''}
            </div>

            <!-- ACTION : LANCER LE 2ND TOUR POUR LES 2 QUALIFIÉS -->
            <div style="margin-top: 2rem; border-top: 1px solid rgba(17,138,178,0.2); padding-top: 1.5rem;">
              <p style="color: #118AB2; font-weight: 700; margin-bottom: 1rem; font-size: 1.05rem;">
                <i class="fa-solid fa-hourglass-half"></i> Le scrutin n'est pas encore clôturé. Les isoloirs recevront uniquement les 2 candidats sélectionnés.
              </p>
              <button class="btn btn-primary" style="padding: 0.85rem 2rem; font-size: 1.1rem; font-weight: 800; background: #118AB2; border-color: #118AB2;" 
                      onclick='startNextRound("${roomId}", ["${topCand.candidate_id}", "${secondCand ? secondCand.candidate_id : ''}"], "SECOND_ROUND")'>
                <i class="fa-solid fa-play"></i> Lancer le 2ème Tour (avec les 2 Candidats Qualifiés)
              </button>
            </div>
          </div>
        `;
      }
    }

    // 2. LISTE DÉTAILLÉE DES RÉSULTATS
    const container = document.getElementById('resultsListContainer');
    container.innerHTML = data.results.map(r => `
      <div class="result-row" style="background: var(--card-bg); border: 1.5px solid var(--border-color); padding: 1rem 1.25rem; border-radius: 12px; margin-bottom: 1rem;">
        <div class="result-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.6rem;">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <div class="candidate-number-badge" style="width: 36px; height: 36px; min-width: 36px; font-size: 1rem; border-color: ${r.color_code || '#06D6A0'}; color: ${r.color_code || '#06D6A0'};">
              N°${r.candidate_number}
            </div>
            <div>
              <span style="font-size: 1.15rem; font-weight: 800;">${r.first_name} ${r.last_name}</span>
              <span style="font-size: 0.85rem; color: var(--text-sub); margin-left: 0.5rem;">(${r.party_name || 'Indépendant'})</span>
              ${r.is_disqualified ? '<span style="color: var(--status-disqualified); font-weight: 700; font-size: 0.8rem; margin-left: 0.5rem;">[DISQUALIFIÉ]</span>' : ''}
            </div>
          </div>
          <span style="font-size: 1.2rem; font-weight: 900; color: var(--accent-white);">${r.vote_count} voix <strong style="color: #06D6A0;">(${r.percentage}%)</strong></span>
        </div>
        <div class="progress-track" style="height: 12px; background: var(--input-bg); border-radius: 8px;">
          <div class="progress-fill" style="width: ${r.percentage}%; background-color: ${r.color_code || '#06D6A0'};"></div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Erreur récupération résultats:', err);
  }
}

// Fonction pour démarrer le second tour ou le tour d'égalité
async function startNextRound(roomId, qualifiedIds, roundType) {
  const cleanIds = (qualifiedIds || []).filter(id => id && id.trim() !== '');
  if (cleanIds.length < 2) {
    showCustomAlert('Erreur: Impossible de lancer un nouveau tour avec moins de 2 candidats.', 'Tour Improbable', 'danger');
    return;
  }

  const roundName = roundType === 'SECOND_ROUND' ? 'Deuxième Tour' : 'Nouveau Tour (Départage des Ex Æquo)';
  const confirmed = await showCustomDialog({
    title: `Lancement du ${roundName}`,
    message: `Voulez-vous officiellement lancer le ${roundName} ?\n\n• Seuls les ${cleanIds.length} candidats qualifiés seront soumis au vote.\n• L'urne est réinitialisée pour ce nouveau tour.\n• Le scrutin redevient ACTIF sans être clôturé.`,
    icon: roundType === 'SECOND_ROUND' ? 'play' : 'rotate',
    type: 'success',
    confirmText: 'Démarrer le Tour',
    cancelText: 'Annuler'
  });
  if (!confirmed) return;

  try {
    const res = await fetch(`${API_BASE}/api/rooms/${roomId}/start-round`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`,
      },
      body: JSON.stringify({
        qualified_candidate_ids: cleanIds,
        round_type: roundType,
      }),
    });
    const data = await handleFetchResponse(res);

    await showCustomAlert(data.message, 'Nouveau Tour Lancé', 'success');

    currentRoom = data.room;
    loadRoomByCode(currentRoom.code);
  } catch (err) {
    showCustomAlert('Erreur lors du lancement du nouveau tour: ' + err.message, 'Erreur de Démarrage', 'danger');
  }
}

// ==========================================================================
// MODULE : GESTION DES ÉLECTEURS PAR L'ADMINISTRATEUR (VALIDATION & ANNULATION)
// ==========================================================================

let adminVotersCache = [];
let currentAdminVoterTab = 'pending';

async function loadAdminRoomVoters(roomId) {
  if (!currentToken || !roomId) return;

  try {
    const res = await fetch(`${API_BASE}/api/rooms/${roomId}/voters`, {
      headers: { 'Authorization': `Bearer ${currentToken}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    adminVotersCache = data.voters || [];
    renderAdminVotersList();
  } catch (err) {
    console.error('Erreur chargement électeurs admin:', err);
  }
}

function renderAdminVotersList() {
  const container = document.getElementById('adminVotersList');
  if (!container) return;

  const pending = adminVotersCache.filter(v => v.status === 'PENDING_APPROVAL');
  const approved = adminVotersCache.filter(v => v.status === 'APPROVED');
  const voted = adminVotersCache.filter(v => v.status === 'VOTED');
  const cancelled = adminVotersCache.filter(v => v.status === 'CANCELLED' || v.status === 'REJECTED');

  // Mise à jour des compteurs sur les onglets
  const cp = document.getElementById('countPendingVoters');
  const ca = document.getElementById('countApprovedVoters');
  const cv = document.getElementById('countVotedVoters');
  const cc = document.getElementById('countCancelledVoters');

  if (cp) cp.textContent = pending.length;
  if (ca) ca.textContent = approved.length;
  if (cv) cv.textContent = voted.length;
  if (cc) cc.textContent = cancelled.length;

  let currentList = [];
  if (currentAdminVoterTab === 'pending') currentList = pending;
  else if (currentAdminVoterTab === 'approved') currentList = approved;
  else if (currentAdminVoterTab === 'voted') currentList = voted;
  else if (currentAdminVoterTab === 'cancelled') currentList = cancelled;

  if (currentList.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 2rem; color: var(--text-sub);">
        <i class="fa-solid fa-folder-open" style="font-size: 2rem; margin-bottom: 0.5rem; opacity: 0.5;"></i>
        <p style="margin: 0; font-size: 0.95rem;">Aucun électeur dans cette catégorie pour le moment.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = currentList.map(v => {
    let actionsHtml = '';
    let badgeHtml = '';

    if (v.status === 'PENDING_APPROVAL') {
      badgeHtml = `<span style="background: rgba(255, 209, 102, 0.2); color: #FFD166; padding: 0.25rem 0.6rem; border-radius: 12px; font-weight: 700; font-size: 0.8rem;"><i class="fa-solid fa-clock"></i> En Attente</span>`;
      actionsHtml = `
        <div style="display: flex; gap: 0.5rem;">
          <button class="btn btn-success" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;" onclick="handleAdminApproveVoter('${v.user_id}', true)">
            <i class="fa-solid fa-check"></i> Accepter
          </button>
          <button class="btn btn-outline" style="padding: 0.4rem 0.8rem; font-size: 0.85rem; color: var(--status-disqualified); border-color: var(--status-disqualified);" onclick="handleAdminApproveVoter('${v.user_id}', false)">
            <i class="fa-solid fa-times"></i> Refuser
          </button>
        </div>
      `;
    } else if (v.status === 'APPROVED') {
      badgeHtml = `<span style="background: rgba(6, 214, 160, 0.2); color: #06D6A0; padding: 0.25rem 0.6rem; border-radius: 12px; font-weight: 700; font-size: 0.8rem;"><i class="fa-solid fa-check"></i> Accès Validé (Non voté)</span>`;
      actionsHtml = `
        <span style="font-size: 0.85rem; color: var(--text-sub);">
          Validé le ${v.approved_at ? new Date(v.approved_at).toLocaleTimeString('fr-FR') : ''}
        </span>
      `;
    } else if (v.status === 'VOTED') {
      badgeHtml = `<span style="background: rgba(17, 138, 178, 0.2); color: #118AB2; padding: 0.25rem 0.6rem; border-radius: 12px; font-weight: 700; font-size: 0.8rem;"><i class="fa-solid fa-check-double"></i> A Voté</span>`;
      actionsHtml = `
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <span style="font-size: 0.85rem; color: var(--text-sub);">Voté à ${v.voted_at ? new Date(v.voted_at).toLocaleTimeString('fr-FR') : ''}</span>
          <button class="btn btn-danger" style="padding: 0.4rem 0.8rem; font-size: 0.85rem;" onclick="handleAdminCancelVote('${v.user_id}', '${(v.full_name || 'Électeur').replace(/'/g, "\\'")}')">
            <i class="fa-solid fa-ban"></i> Annuler le vote
          </button>
        </div>
      `;
    } else if (v.status === 'CANCELLED') {
      badgeHtml = `<span style="background: rgba(217, 4, 41, 0.2); color: var(--status-disqualified); padding: 0.25rem 0.6rem; border-radius: 12px; font-weight: 700; font-size: 0.8rem;"><i class="fa-solid fa-ban"></i> Vote Annulé par Admin</span>`;
      actionsHtml = `
        <span style="font-size: 0.85rem; color: var(--text-sub);">
          Annulé le ${v.cancelled_at ? new Date(v.cancelled_at).toLocaleTimeString('fr-FR') : ''}
        </span>
      `;
    } else if (v.status === 'REJECTED') {
      badgeHtml = `<span style="background: rgba(217, 4, 41, 0.2); color: var(--status-disqualified); padding: 0.25rem 0.6rem; border-radius: 12px; font-weight: 700; font-size: 0.8rem;"><i class="fa-solid fa-xmark"></i> Demande Refusée</span>`;
    }

    return `
      <div class="candidate-card" style="margin-bottom: 0.75rem; padding: 0.9rem 1.2rem; background: var(--card-bg); border: 1px solid var(--border-color);">
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <div style="width: 40px; height: 40px; border-radius: 50%; background: var(--navy-light); display: flex; align-items: center; justify-content: center; font-size: 1.1rem; color: #06D6A0;">
            <i class="fa-solid fa-user"></i>
          </div>
          <div>
            <div style="font-weight: 800; font-size: 1rem; color: var(--text-main);">
              ${v.full_name || 'Électeur sans nom'}
              <span style="margin-left: 0.5rem;">${badgeHtml}</span>
            </div>
            <div style="font-size: 0.85rem; color: var(--text-sub); margin-top: 0.2rem;">
              ${v.email || 'Email non renseigné'} ${v.requested_at ? `&bull; Demande : ${new Date(v.requested_at).toLocaleTimeString('fr-FR')}` : ''}
            </div>
          </div>
        </div>
        <div>
          ${actionsHtml}
        </div>
      </div>
    `;
  }).join('');
}

async function handleAdminApproveVoter(userId, approved) {
  if (!currentRoom || !currentToken) return;

  try {
    const res = await fetch(`${API_BASE}/api/rooms/${currentRoom.id}/voters/${userId}/approve`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`,
      },
      body: JSON.stringify({ approved }),
    });
    const data = await handleFetchResponse(res);
    await showCustomAlert(data.message, approved ? 'Demande Acceptée' : 'Demande Refusée', approved ? 'success' : 'info');
    await loadAdminRoomVoters(currentRoom.id);
  } catch (err) {
    showCustomAlert('Erreur lors de la validation: ' + err.message, 'Erreur', 'danger');
  }
}

async function handleAdminCancelVote(userId, voterName) {
  if (!currentRoom || !currentToken) return;

  const confirmed = await showCustomDialog({
    title: 'Annuler le Vote de l\'Électeur',
    message: `Voulez-vous vraiment annuler le vote en ligne de "${voterName}" ?\n\nCette action sera tracée dans le journal d'audit et l'électeur en sera immédiatement notifié.`,
    icon: 'trash',
    type: 'danger',
    confirmText: 'Oui, Annuler le Vote',
    cancelText: 'Retour',
  });

  if (!confirmed) return;

  try {
    const res = await fetch(`${API_BASE}/api/rooms/${currentRoom.id}/voters/${userId}/cancel-vote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`,
      },
    });
    const data = await handleFetchResponse(res);
    await showCustomAlert(data.message, 'Vote Annulé avec Succès', 'success');
    await loadAdminRoomVoters(currentRoom.id);
  } catch (err) {
    showCustomAlert('Erreur lors de l\'annulation: ' + err.message, 'Erreur', 'danger');
  }
}

// Configuration des écouteurs pour la gestion des électeurs côté Admin
function setupAdminVoterTabs() {
  document.querySelectorAll('.voter-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.voter-tab-btn').forEach(b => {
        b.classList.remove('active', 'btn-primary');
        b.classList.add('btn-outline');
      });
      btn.classList.remove('btn-outline');
      btn.classList.add('active', 'btn-primary');
      currentAdminVoterTab = btn.getAttribute('data-tab');
      renderAdminVotersList();
    });
  });

  const refreshBtn = document.getElementById('refreshAdminVotersBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      if (currentRoom) loadAdminRoomVoters(currentRoom.id);
    });
  }
}

// ==========================================================================
// MODULE : ESPACE ÉLECTEUR (DEMANDES D'ACCÈS, STATUTS, HORAIRES & VOTE)
// ==========================================================================

let activeVoterRoom = null;

async function checkVoterRoomStatus(roomIdOrCode) {
  if (!currentToken) return;

  try {
    const res = await fetch(`${API_BASE}/api/rooms/${roomIdOrCode}/my-status`, {
      headers: { 'Authorization': `Bearer ${currentToken}` },
    });
    const data = await handleFetchResponse(res);

    activeVoterRoom = data.room;
    localStorage.setItem('fidiko_voter_room_id', activeVoterRoom.id);

    // Rejoindre le salon WebSocket pour recevoir les changements d'état du salon
    if (socket) {
      socket.emit('room:join', { room_id: activeVoterRoom.id });
    }

    renderVoterRoomDetails(data);
  } catch (err) {
    console.error('Erreur vérification statut électeur:', err);
    localStorage.removeItem('fidiko_voter_room_id');
    showVoterJoinSubView();
  }
}

function renderVoterRoomDetails(data) {
  const joinCard = document.getElementById('voterJoinRoomCard');
  const currentCard = document.getElementById('voterCurrentRoomCard');
  const historyCard = document.getElementById('voterHistoryCard');

  if (joinCard) joinCard.style.display = 'none';
  if (historyCard) historyCard.style.display = 'none';
  if (currentCard) currentCard.style.display = 'block';

  const room = data.room;
  const voterStatus = data.voter_status;

  document.getElementById('voterRoomTitle').textContent = room.title;
  document.getElementById('voterRoomCodeDisplay').innerHTML = `Code du salon : <strong style="color: #06D6A0;">${room.code}</strong>`;

  // Affichage des horaires
  const startText = document.getElementById('voterStartTimeText');
  const endText = document.getElementById('voterEndTimeText');
  if (startText) startText.textContent = room.start_time ? new Date(room.start_time).toLocaleString('fr-FR') : 'Dès activation par l\'Admin';
  if (endText) endText.textContent = room.end_time ? new Date(room.end_time).toLocaleString('fr-FR') : 'Jusqu\'à clôture';

  // Lancer le timer de compte à rebours
  startVoterCountdown(room);

  // Rendu du Badge de Statut
  const badgeContainer = document.getElementById('voterStatusBadgeContainer');
  const actionBox = document.getElementById('voterActionStatusBox');
  const voteBtnContainer = document.getElementById('voterGoToVoteContainer');

  voteBtnContainer.style.display = 'none';

  if (voterStatus === 'PENDING_APPROVAL') {
    badgeContainer.innerHTML = `
      <span style="background: rgba(255, 209, 102, 0.2); color: #FFD166; padding: 0.5rem 1rem; border-radius: 20px; font-weight: 800; font-size: 0.9rem;">
        <i class="fa-solid fa-hourglass-half"></i> EN ATTENTE DE VALIDATION ADMIN
      </span>
    `;
    actionBox.innerHTML = `
      <p style="margin: 0; color: var(--text-main); font-size: 0.95rem; line-height: 1.5;">
        <i class="fa-solid fa-circle-info" style="color: #FFD166;"></i> Votre demande d'accès a été transmise à l'administrateur du salon. Dès qu'il aura validé votre demande, vous pourrez voter si le scrutin est ouvert.
      </p>
    `;
  } else if (voterStatus === 'APPROVED') {
    badgeContainer.innerHTML = `
      <span style="background: rgba(6, 214, 160, 0.2); color: #06D6A0; padding: 0.5rem 1rem; border-radius: 20px; font-weight: 800; font-size: 0.9rem;">
        <i class="fa-solid fa-check-circle"></i> DEMANDE APPROUVÉE PAR L'ADMIN
      </span>
    `;

    // Vérifier si la plage horaire et le statut permettent de voter
    const now = new Date();
    const isStarted = !room.start_time || now >= new Date(room.start_time);
    const isEnded = room.end_time && now > new Date(room.end_time);

    if (room.status !== 'ACTIVE') {
      actionBox.innerHTML = `
        <p style="margin: 0; color: var(--text-main); font-size: 0.95rem;">
          <i class="fa-solid fa-lock" style="color: #FFD166;"></i> Le salon est actuellement en statut <strong>${room.status}</strong>. Le vote sera accessible dès son activation par l'administrateur.
        </p>
      `;
    } else if (!isStarted) {
      actionBox.innerHTML = `
        <p style="margin: 0; color: var(--text-main); font-size: 0.95rem;">
          <i class="fa-solid fa-hourglass-start" style="color: #06D6A0;"></i> Le scrutin ouvre le <strong>${new Date(room.start_time).toLocaleString('fr-FR')}</strong>. Veuillez patienter jusqu'à l'heure d'ouverture.
        </p>
      `;
    } else if (isEnded) {
      actionBox.innerHTML = `
        <p style="margin: 0; color: var(--status-disqualified); font-size: 0.95rem;">
          <i class="fa-solid fa-hourglass-end"></i> L'heure limite de vote (<strong>${new Date(room.end_time).toLocaleString('fr-FR')}</strong>) est dépassée. Le scrutin est terminé pour ce salon.
        </p>
      `;
    } else {
      actionBox.innerHTML = `
        <p style="margin: 0; color: #06D6A0; font-weight: 700; font-size: 1rem;">
          <i class="fa-solid fa-door-open"></i> Le scrutin est ACTIF et vous êtes autorisé à voter !
        </p>
      `;
      voteBtnContainer.style.display = 'block';
    }
  } else if (voterStatus === 'VOTED') {
    badgeContainer.innerHTML = `
      <span style="background: rgba(17, 138, 178, 0.2); color: #118AB2; padding: 0.5rem 1rem; border-radius: 20px; font-weight: 800; font-size: 0.9rem;">
        <i class="fa-solid fa-check-double"></i> VOUS AVEZ DÉJÀ VOTÉ
      </span>
    `;
    actionBox.innerHTML = `
      <p style="margin: 0; color: var(--text-main); font-size: 0.95rem;">
        <i class="fa-solid fa-shield-halved" style="color: #06D6A0;"></i> Votre bulletin est scellé dans l'urne anonyme PostgreSQL. Merci pour votre participation !
      </p>
    `;
  } else if (voterStatus === 'CANCELLED') {
    badgeContainer.innerHTML = `
      <span style="background: rgba(217, 4, 41, 0.2); color: var(--status-disqualified); padding: 0.5rem 1rem; border-radius: 20px; font-weight: 800; font-size: 0.9rem;">
        <i class="fa-solid fa-ban"></i> VOTE ANNULÉ PAR L'ADMIN
      </span>
    `;
    actionBox.innerHTML = `
      <p style="margin: 0; color: var(--status-disqualified); font-size: 0.95rem;">
        <i class="fa-solid fa-triangle-exclamation"></i> Votre vote a été annulé par l'administrateur du salon.
      </p>
    `;
  } else if (voterStatus === 'REJECTED') {
    badgeContainer.innerHTML = `
      <span style="background: rgba(217, 4, 41, 0.2); color: var(--status-disqualified); padding: 0.5rem 1rem; border-radius: 20px; font-weight: 800; font-size: 0.9rem;">
        <i class="fa-solid fa-xmark"></i> DEMANDE REFUSÉE
      </span>
    `;
    actionBox.innerHTML = `
      <p style="margin: 0; color: var(--status-disqualified); font-size: 0.95rem;">
        <i class="fa-solid fa-circle-xmark"></i> L'administrateur n'a pas autorisé votre participation à ce salon.
      </p>
    `;
  }
}

function startVoterCountdown(room) {
  if (voterCountdownInterval) clearInterval(voterCountdownInterval);

  const timerEl = document.getElementById('voterCountdownTimerText');
  if (!timerEl) return;

  function update() {
    if (!room.end_time) {
      timerEl.textContent = 'Non définie';
      return;
    }

    const now = Date.now();
    const endMs = new Date(room.end_time).getTime();
    const diff = endMs - now;

    if (diff <= 0) {
      timerEl.textContent = 'Clôturé';
      timerEl.style.color = '#D90429';
      return;
    }

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const secs = Math.floor((diff % (1000 * 60)) / 1000);

    const pad = (n) => String(n).padStart(2, '0');
    timerEl.textContent = `${pad(hours)}:${pad(mins)}:${pad(secs)}`;

    if (diff <= 5 * 60 * 1000) {
      timerEl.style.color = '#D90429';
    } else if (diff <= 10 * 60 * 1000) {
      timerEl.style.color = '#FFD166';
    } else {
      timerEl.style.color = '#06D6A0';
    }
  }

  update();
  voterCountdownInterval = setInterval(update, 1000);
}

// Charger et afficher l'historique des votes de l'électeur
async function loadVoterHistory() {
  if (!currentToken) return;

  const container = document.getElementById('voterHistoryList');
  if (!container) return;

  try {
    const res = await fetch(`${API_BASE}/api/rooms/voter/history`, {
      headers: { 'Authorization': `Bearer ${currentToken}` },
    });
    const history = await handleFetchResponse(res);

    if (!history || history.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 2rem; color: var(--text-sub);">
          <i class="fa-solid fa-box-open" style="font-size: 2.5rem; margin-bottom: 0.75rem; opacity: 0.5;"></i>
          <p style="margin: 0; font-size: 1rem;">Vous n'avez encore participé à aucun salon de vote.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = history.map(item => {
      let statusBadge = '';
      if (item.participation_status === 'VOTED') {
        statusBadge = '<span style="background: rgba(6, 214, 160, 0.2); color: #06D6A0; padding: 0.25rem 0.6rem; border-radius: 12px; font-weight: 700; font-size: 0.8rem;"><i class="fa-solid fa-check-double"></i> A Voté</span>';
      } else if (item.participation_status === 'APPROVED') {
        statusBadge = '<span style="background: rgba(17, 138, 178, 0.2); color: #118AB2; padding: 0.25rem 0.6rem; border-radius: 12px; font-weight: 700; font-size: 0.8rem;"><i class="fa-solid fa-check"></i> Validé</span>';
      } else if (item.participation_status === 'PENDING_APPROVAL') {
        statusBadge = '<span style="background: rgba(255, 209, 102, 0.2); color: #FFD166; padding: 0.25rem 0.6rem; border-radius: 12px; font-weight: 700; font-size: 0.8rem;"><i class="fa-solid fa-clock"></i> En Attente</span>';
      } else {
        statusBadge = `<span style="background: rgba(217, 4, 41, 0.2); color: var(--status-disqualified); padding: 0.25rem 0.6rem; border-radius: 12px; font-weight: 700; font-size: 0.8rem;">${item.participation_status}</span>`;
      }

      return `
        <div class="candidate-card" style="margin-bottom: 0.85rem; padding: 1.1rem 1.4rem; background: var(--card-bg); border: 1.5px solid var(--border-color);">
          <div>
            <div style="font-weight: 800; font-size: 1.15rem; margin-bottom: 0.25rem;">
              ${item.title}
              <span style="margin-left: 0.5rem;">${statusBadge}</span>
              <span style="font-size: 0.75rem; padding: 0.2rem 0.5rem; border-radius: 10px; background: var(--input-bg); color: var(--text-sub); margin-left: 0.4rem;">
                Salon ${item.room_status}
              </span>
            </div>
            <div style="font-size: 0.88rem; color: var(--text-sub);">
              Code : <strong style="color: #06D6A0;">${item.code}</strong> &bull;
              ${item.voted_at ? `Voté le ${new Date(item.voted_at).toLocaleString('fr-FR')}` : `Demande le ${new Date(item.requested_at).toLocaleString('fr-FR')}`}
            </div>
          </div>
          <div>
            <button class="btn btn-outline" style="font-size: 0.85rem;" onclick="checkVoterRoomStatus('${item.room_id}')">
              <i class="fa-solid fa-eye"></i> Voir le Salon
            </button>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<p style="color: var(--status-disqualified);">Erreur: ${err.message}</p>`;
  }
}

// Initialiser les écouteurs du dashboard électeur
function setupVoterDashboardListeners() {
  const reqForm = document.getElementById('voterRequestAccessForm');
  if (reqForm) {
    reqForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = document.getElementById('voterRoomCodeInput').value.trim();

      try {
        const res = await fetch(`${API_BASE}/api/rooms/${code}/request-access`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentToken}`,
          },
        });
        const data = await handleFetchResponse(res);
        await showCustomAlert(data.message, 'Demande Envoyée', 'success');
        checkVoterRoomStatus(code);
      } catch (err) {
        showCustomAlert('Erreur: ' + err.message, 'Demande d\'Accès', 'danger');
      }
    });
  }

  const navHistBtn = document.getElementById('voterNavHistoryBtn');
  const navJoinBtn = document.getElementById('voterNavJoinBtn');
  const refreshHistBtn = document.getElementById('refreshVoterHistoryBtn');

  if (navHistBtn) {
    navHistBtn.addEventListener('click', () => {
      document.getElementById('voterJoinRoomCard').style.display = 'none';
      document.getElementById('voterCurrentRoomCard').style.display = 'none';
      document.getElementById('voterHistoryCard').style.display = 'block';
      loadVoterHistory();
    });
  }

  if (navJoinBtn) {
    navJoinBtn.addEventListener('click', showVoterJoinSubView);
  }

  if (refreshHistBtn) {
    refreshHistBtn.addEventListener('click', loadVoterHistory);
  }

  const launchVoteBtn = document.getElementById('voterLaunchVoteBtn');
  if (launchVoteBtn) {
    launchVoteBtn.addEventListener('click', () => {
      if (!activeVoterRoom) return;
      // Ouvrir directement l'interface de vote sécurisée pour cet électeur
      loadRoomForVoterVoting(activeVoterRoom.code);
    });
  }
}

// Afficher l'isoloir de vote directement pour l'électeur en ligne approuvé
async function loadRoomForVoterVoting(code) {
  try {
    const res = await fetch(`${API_BASE}/api/rooms/code/${code}`);
    const data = await handleFetchResponse(res);

    currentRoom = data.room;
    hideAllSections();

    document.getElementById('voterBoothSection').style.display = 'block';
    document.getElementById('terminalDeviceLabel').innerHTML = `
      <i class="fa-solid fa-check-to-slot" style="color: #06D6A0;"></i> Vote Certifié : ${currentUser ? currentUser.full_name : 'Électeur'}
    `;

    renderVoterCandidates(data.candidates);
    showBoothViewState('active');
  } catch (err) {
    showCustomAlert('Erreur lors de l\'ouverture du vote: ' + err.message, 'Erreur', 'danger');
  }
}

// Initialisation globale des nouveaux modules
document.addEventListener('DOMContentLoaded', () => {
  setupAdminVoterTabs();
  setupVoterDashboardListeners();
});
