-- Migration 0001 — scheduled_events table for the Scheduled Posts feature.
--
-- Database: zapcooking-scheduler (D1). Applied with:
--   wrangler d1 migrations apply zapcooking-scheduler --remote
-- The D1 bindings (`SCHEDULER_DB` in wrangler.jsonc and
-- workers/cron/wrangler.toml, with migrations_dir pointed here) land in
-- the follow-up API-routes PR; this file is checked in first so the
-- schema is reviewable alongside the crypto/auth modules it serves.

CREATE TABLE scheduled_events (
  id            TEXT PRIMARY KEY,      -- the Nostr event id (64-char hex)
  pubkey        TEXT NOT NULL,         -- author pubkey (hex), must match NIP-98 auth
  kind          INTEGER NOT NULL,      -- allowlist: 1, 1068, 6969, 30023, 35000
  publish_at    INTEGER NOT NULL,      -- unix seconds; MUST equal event.created_at
  relay_mode    TEXT NOT NULL,         -- 'all' | 'pantry'
  ciphertext    TEXT NOT NULL,         -- base64(AES-256-GCM(full signed event JSON))
  iv            TEXT NOT NULL,         -- base64, 12 random bytes per row
  status        TEXT NOT NULL DEFAULT 'pending',
                -- 'pending' | 'publishing' | 'sent' | 'failed' | 'cancelled'
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_at    INTEGER NOT NULL,      -- row creation (unix seconds)
  updated_at    INTEGER NOT NULL,
  sent_at       INTEGER
);

CREATE INDEX idx_sched_due    ON scheduled_events (status, publish_at);
CREATE INDEX idx_sched_pubkey ON scheduled_events (pubkey, status);
