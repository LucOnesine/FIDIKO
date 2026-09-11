-- FIDIKO PostgreSQL Database Migration Schema
-- Target PostgreSQL: 14+

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Nettoyage si réinitialisation
DROP TABLE IF EXISTS logs CASCADE;
DROP TABLE IF EXISTS room_voters CASCADE;
DROP TABLE IF EXISTS votes_secure CASCADE;
DROP TABLE IF EXISTS kiosks CASCADE;
DROP TABLE IF EXISTS candidates CASCADE;
DROP TABLE IF EXISTS rooms CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- 1. Table Utilisateurs (Auth, Rôles & Validation OTP)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    phone_number VARCHAR(30),
    otp_code VARCHAR(6),
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    role VARCHAR(30) NOT NULL DEFAULT 'voter' CHECK (role IN ('admin', 'voter', 'booth_operator')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Table Salons de Vote (3 États Strictement Contrôlés)
CREATE TABLE rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(8) UNIQUE NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    admin_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL DEFAULT 'INACTIVE' CHECK (status IN ('INACTIVE', 'ACTIVE', 'CLOSED')),
    countdown_started_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Table Candidats (Avec Numéro d'Ordre & Gel en mode ACTIVE)
CREATE TABLE candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    candidate_number INT NOT NULL, -- Numéro d'ordre officiel (1, 2, 3...)
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    party_name VARCHAR(150),
    color_code VARCHAR(7) NOT NULL DEFAULT '#1C2541',
    photo_url TEXT,
    party_logo_url TEXT,
    is_disqualified BOOLEAN NOT NULL DEFAULT FALSE,
    disqualified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_candidate_number_per_room UNIQUE (room_id, candidate_number)
);

-- 4. Table Isoloirs Physiques (Appairage & Contrôle par Appareil)
CREATE TABLE kiosks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    device_id VARCHAR(100) UNIQUE NOT NULL,
    device_name VARCHAR(150) NOT NULL,
    is_approved BOOLEAN NOT NULL DEFAULT FALSE, -- Statut Handshake (Accepté / Refusé)
    is_unlocked BOOLEAN NOT NULL DEFAULT FALSE, -- Déverrouillage individuel pour 1 vote
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'LOCKED', 'UNLOCKED', 'REJECTED')),
    votes_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. Table Bulletins de Vote Sécurisés (Anonymat Cryptographique)
CREATE TABLE votes_secure (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    vote_hash VARCHAR(64) UNIQUE NOT NULL,
    voted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 6. Table Registre d'Éligibilité des Votants (Registre d'Émargement Anti-Double Vote)
CREATE TABLE room_voters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    booth_device_id VARCHAR(100),
    voted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_voter_in_room UNIQUE (room_id, user_id)
);

-- 7. Table Logs d'Audit
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
CREATE INDEX idx_candidates_room_num ON candidates(room_id, candidate_number);
CREATE INDEX idx_kiosks_room_device ON kiosks(room_id, device_id);
CREATE INDEX idx_votes_room_cand ON votes_secure(room_id, candidate_id);

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
CREATE TRIGGER trg_kiosks_updated_at BEFORE UPDATE ON kiosks FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
