const db = require('../config/db');

async function migrate() {
  try {
    await db.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_code VARCHAR(6);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_otp_code VARCHAR(6);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_otp_expires TIMESTAMPTZ;
    `);
    console.log('✅ Migration PostgreSQL réussie : colonnes otp_code, is_verified, reset_otp_code, reset_otp_expires vérifiées ou ajoutées !');
    process.exit(0);
  } catch (err) {
    console.error('❌ Erreur de migration:', err);
    process.exit(1);
  }
}

migrate();
