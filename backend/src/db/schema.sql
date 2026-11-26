-- CertChain: схема на релационната база данни (PostgreSQL)
-- В базата се пазят потребители, метаданни и препратки към файловете.
-- Доказателственият запис (хеш, издател, време, статус) е в блокчейна.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('ADMIN', 'ISSUER', 'HOLDER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE certificate_status AS ENUM ('PENDING', 'ISSUED', 'FAILED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                  VARCHAR(255) NOT NULL UNIQUE,
  password_hash          VARCHAR(100) NOT NULL,
  full_name              VARCHAR(200) NOT NULL,
  role                   user_role NOT NULL,
  organization_name      VARCHAR(200),
  wallet_address         CHAR(42) UNIQUE,
  encrypted_private_key  TEXT,
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT issuer_has_wallet CHECK (role <> 'ISSUER' OR (wallet_address IS NOT NULL AND encrypted_private_key IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS certificates (
  id                  UUID PRIMARY KEY,
  certificate_number  VARCHAR(30) NOT NULL UNIQUE,
  chain_id            CHAR(66) NOT NULL UNIQUE,
  issuer_id           UUID NOT NULL REFERENCES users(id),
  holder_id           UUID REFERENCES users(id),
  holder_name         VARCHAR(200) NOT NULL,
  holder_email        VARCHAR(255) NOT NULL,
  title               VARCHAR(200) NOT NULL,
  program             VARCHAR(200) NOT NULL,
  description         VARCHAR(1000),
  grade               VARCHAR(50),
  issue_date          DATE NOT NULL,
  pdf_path            VARCHAR(500) NOT NULL,
  document_hash       CHAR(66) NOT NULL UNIQUE,
  status              certificate_status NOT NULL DEFAULT 'PENDING',
  tx_hash             CHAR(66),
  block_number        BIGINT,
  error_message       VARCHAR(500),
  revoke_reason       VARCHAR(500),
  revoked_at          TIMESTAMPTZ,
  revoke_tx_hash      CHAR(66),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_certificates_issuer ON certificates(issuer_id);
CREATE INDEX IF NOT EXISTS idx_certificates_holder ON certificates(holder_id);
CREATE INDEX IF NOT EXISTS idx_certificates_holder_email ON certificates(lower(holder_email));

CREATE SEQUENCE IF NOT EXISTS certificate_number_seq START 1001;

CREATE TABLE IF NOT EXISTS verification_logs (
  id              BIGSERIAL PRIMARY KEY,
  certificate_id  UUID REFERENCES certificates(id),
  method          VARCHAR(10) NOT NULL CHECK (method IN ('ID', 'FILE')),
  result          VARCHAR(20) NOT NULL,
  client_hash     CHAR(16),
  duration_ms     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verification_logs_created ON verification_logs(created_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    UUID REFERENCES users(id),
  action      VARCHAR(50) NOT NULL,
  entity_id   UUID,
  details     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
