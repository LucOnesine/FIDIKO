const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const roomRoutes = require('./routes/roomRoutes');
const candidateRoutes = require('./routes/candidateRoutes');
const voteRoutes = require('./routes/voteRoutes');
const socketHandler = require('./sockets/socketHandler');

const app = express();
const server = http.createServer(app);

// Enable CORS pour Flutter Web, mobile et applications hybrides
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Attach Socket.io server
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  },
});

app.set('socketio', io);
socketHandler(io);

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const dbCheck = await db.query('SELECT NOW()');
    res.json({
      status: 'online',
      app: 'FIDIKO Real-time Voting Engine',
      db_time: dbCheck.rows[0].now,
      environment: process.env.NODE_ENV || 'development',
    });
  } catch (err) {
    res.status(500).json({ status: 'offline', error: 'Erreur de connexion PostgreSQL: ' + err.message });
  }
});

// API Routes (DOIVENT ÊTRE MONTÉES AVANT LES FICHIERS STATIQUES)
app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/candidates', candidateRoutes);
app.use('/api/votes', voteRoutes);

// Catch-all 404 JSON pour toutes les requêtes /api/* non trouvées
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'Endpoint API introuvable.' });
});

// Servir les fichiers statiques de l'application Web (Frontend/public)
app.use(express.static(path.join(__dirname, '../../Frontend/public')));

// Servir index.html pour les routes clientes (Single Page App)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../Frontend/public/index.html'));
});

const PORT = process.env.PORT || 5000;

// Écoute sur 0.0.0.0 pour autoriser l'accès depuis n'importe quel téléphone sur le réseau local Wi-Fi
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
=====================================================
🚀 Serveur FIDIKO démarré sur le port : ${PORT}
🌐 Accessible localement sur : http://localhost:${PORT}
📱 Accessible sur smartphone Wi-Fi (utilisez votre IP locale)
🗄️ Base de données PostgreSQL : ${process.env.DB_NAME || 'fidiko_db'}
⚡ WebSockets prêts pour la synchronisation temps réel
=====================================================
  `);
});
