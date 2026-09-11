const db = require('../config/db');

async function migrate() {
  try {
    console.log('⚡ Démarrage de la migration PostgreSQL FIDIKO (Espace Électeur & Multi-comptes)...');

    // 1. Adapter la contrainte d'unicité sur users (permettre même email avec rôle différent)
    await db.query(`
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'users_email_role_unique'
        ) THEN
          ALTER TABLE users ADD CONSTRAINT users_email_role_unique UNIQUE (email, role);
        END IF;
      END $$;
    `);
    console.log('✅ Contrainte users_email_role_unique configurée (même email autorisé pour admin et voter).');

    // 2. Ajouter start_time et end_time dans rooms
    await db.query(`
      ALTER TABLE rooms ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ;
      ALTER TABLE rooms ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ;
    `);
    console.log('✅ Colonnes start_time et end_time vérifiées dans la table rooms.');

    // 3. Adapter room_voters pour suivre les demandes d'accès et le statut complet
    await db.query(`
      ALTER TABLE room_voters ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'APPROVED';
      ALTER TABLE room_voters ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE room_voters ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
      ALTER TABLE room_voters ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
      ALTER TABLE room_voters ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL;
    `);
    console.log('✅ Colonnes d\'émargement et de suivi (status, requested_at, approved_at, cancelled_at) ajoutées à room_voters.');

    console.log('🎉 Migration BDD terminée avec succès !');
    process.exit(0);
  } catch (error) {
    console.error('❌ Erreur de migration:', error);
    process.exit(1);
  }
}

migrate();
