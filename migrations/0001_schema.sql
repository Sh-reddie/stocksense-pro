-- StockSense Pro — D1 Database Schema
-- Per-user portfolio data, keyed by Cloudflare Access email
--
-- To apply:
--   wrangler d1 execute stocksense-db --file=migrations/0001_schema.sql --remote

CREATE TABLE IF NOT EXISTS user_data (
  email      TEXT    NOT NULL,
  key        TEXT    NOT NULL,   -- e.g. 'holdings', 'watchlist', 'cfg', 'orders', etc.
  value      TEXT    NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (email, key)
);

CREATE INDEX IF NOT EXISTS idx_user_data_email ON user_data(email);

-- Optional: user profile table for display name / preferences
CREATE TABLE IF NOT EXISTS users (
  email      TEXT    PRIMARY KEY,
  name       TEXT,
  created_at INTEGER NOT NULL DEFAULT 0
);
