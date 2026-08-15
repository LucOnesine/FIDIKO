const fs = require('fs');
const path = require('path');
const db = require('../config/db');

async function initDatabase() {
  try {
    console.log('⚡ Initialisation de la base de données PostgreSQL FIDIKO...');
    const schemaPath = path.join(__dirname, '../../schema.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');

    await db.query(sql);
    console.log('✅ Base de données PostgreSQL fidiko_db initialisée avec succès avec toutes ses tables, triggers et index !');
    process.exit(0);
  } catch (error) {
    console.error('❌ Erreur lors de l\'initialisation de la base de données:', error.message);
    process.exit(1);
  }
}

initDatabase();
