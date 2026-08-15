-- FIDIKO PostgreSQL Database Migration Schema
-- Target PostgreSQL version: 14+

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Drop existing tables if re-initializing (Order respects FK constraints)
DROP TABLE IF EXISTS logs CASCADE;
DROP TABLE IF EXISTS room_voters CASCADE;
DROP TABLE IF EXISTS votes_secure CASCADE;
DROP TABLE IF EXISTS candidates CASCADE;
DROP TABLE IF EXISTS rooms CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- 1. Table Utilisateurs (Auth & Rôles)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    role VARCHAR(30) NOT NULL DEFAULT 'voter' CHECK (role IN ('admin', 'voter', 'booth_operator')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Table Salons de Vote (Rooms)
CREATE TABLE rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(8) UNIQUE NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    admin_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed', 'revealed')),
    is_booth_unlocked BOOLEAN NOT NULL DEFAULT FALSE,
    countdown_started_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Table Candidats (CRUD & Disqualification temps réel)
CREATE TABLE candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    party_name VARCHAR(150),
    color_code VARCHAR(7) NOT NULL DEFAULT '#1C2541',
    photo_url TEXT,
    party_logo_url TEXT,
    is_disqualified BOOLEAN NOT NULL DEFAULT FALSE,
    disqualified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. Table Bulletins de Vote Sécurisés (Anonymat Cryptographique)
-- Aucun lien direct entre le voter_id et la table votes_secure pour préserver le secret du vote.
CREATE TABLE votes_secure (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    vote_hash VARCHAR(64) UNIQUE NOT NULL,
    voted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. Table Registre d'Éligibilité des Votants (Registre d'Émargement)
-- Empêche le double vote sans révéler le choix du votant.
CREATE TABLE room_voters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    booth_device_id VARCHAR(100),
    has_voted BOOLEAN NOT NULL DEFAULT TRUE,
    voted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_per_room UNIQUE (room_id, user_id),
    CONSTRAINT chk_voter_identity CHECK (user_id IS NOT NULL OR booth_device_id IS NOT NULL)
);

-- 6. Table Logs d'Audit et Événements
CREATE TABLE logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- INDEXATION OPTIMISÉE
CREATE INDEX idx_rooms_code ON rooms(code);
CREATE INDEX idx_candidates_room ON candidates(room_id);
CREATE INDEX idx_votes_room_candidate ON votes_secure(room_id, candidate_id);
CREATE INDEX idx_room_voters ON room_voters(room_id, user_id);

-- TRIGGER AUTOMATIQUE UPDATED_AT
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = CURRENT_TIMESTAMP;
   RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER trg_rooms_updated_at BEFORE UPDATE ON rooms FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
CREATE TRIGGER trg_candidates_updated_at BEFORE UPDATE ON candidates FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
