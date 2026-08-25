CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('USER', 'ADMIN');
CREATE TYPE transaction_status AS ENUM ('PROCESSING', 'SUCCESS', 'FAILED', 'REFUNDED');
CREATE TYPE transaction_type AS ENUM ('TRANSFER', 'REFUND');
CREATE TYPE ledger_entry_type AS ENUM ('DEBIT', 'CREDIT');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'USER',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  account_number VARCHAR(30) NOT NULL UNIQUE,
  currency CHAR(3) NOT NULL DEFAULT 'IDR',
  balance NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type transaction_type NOT NULL DEFAULT 'TRANSFER',
  status transaction_status NOT NULL DEFAULT 'PROCESSING',
  actor_user_id UUID NOT NULL REFERENCES users(id),
  sender_account_id UUID NOT NULL REFERENCES accounts(id),
  receiver_account_id UUID NOT NULL REFERENCES accounts(id),
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL,
  description VARCHAR(255),
  idempotency_key VARCHAR(100) NOT NULL,
  related_transaction_id UUID UNIQUE REFERENCES transactions(id),
  failure_code VARCHAR(80),
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CHECK (sender_account_id <> receiver_account_id),
  UNIQUE (actor_user_id, idempotency_key)
);

CREATE INDEX idx_transactions_sender_created ON transactions(sender_account_id, created_at DESC);
CREATE INDEX idx_transactions_receiver_created ON transactions(receiver_account_id, created_at DESC);

CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  account_id UUID NOT NULL REFERENCES accounts(id),
  entry_type ledger_entry_type NOT NULL,
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  balance_after NUMERIC(18,2) NOT NULL CHECK (balance_after >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (transaction_id, account_id)
);
