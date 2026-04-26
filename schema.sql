-- schema.sql
-- PostgreSQL schema for Neon.tech
-- Run once in the Neon.tech SQL console.
-- Note: GORM AutoMigrate also creates and updates these tables on first backend boot.

CREATE TABLE IF NOT EXISTS users (
    id                    BIGSERIAL PRIMARY KEY,
    created_at            TIMESTAMPTZ,
    updated_at            TIMESTAMPTZ,
    deleted_at            TIMESTAMPTZ,
    username              TEXT        NOT NULL UNIQUE,
    password              TEXT        NOT NULL,
    currency              TEXT        DEFAULT 'USD',
    ai_advice_enabled     BOOLEAN     DEFAULT FALSE,
    ai_humor_enabled      BOOLEAN     DEFAULT FALSE,
    monthly_spending_goal NUMERIC(12,2) DEFAULT 0,
    expected_salary       NUMERIC(12,2) DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users (deleted_at);

CREATE TABLE IF NOT EXISTS categories (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES users(id),
    name       TEXT        NOT NULL,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS transactions (
    id          BIGSERIAL    PRIMARY KEY,
    user_id     BIGINT       NOT NULL REFERENCES users(id),
    category_id BIGINT       NOT NULL REFERENCES categories(id),
    amount      NUMERIC(10,2) NOT NULL,
    description TEXT,
    date        TIMESTAMPTZ  NOT NULL,
    created_at  TIMESTAMPTZ,
    updated_at  TIMESTAMPTZ,
    type        VARCHAR(10)  NOT NULL DEFAULT 'expense',
    income_type VARCHAR(20)  NOT NULL DEFAULT 'one_time'
);
