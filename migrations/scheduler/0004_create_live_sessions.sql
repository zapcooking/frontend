-- Migration 0004 — live_sessions, for Go live (live cook-alongs).
--
-- Additive only: one new table and its three indexes, all prefixed live_.
-- Nothing existing is altered or read.
--
-- Database: zapcooking-scheduler (D1), the project's only D1 database
-- (binding SCHEDULER_DB). Apply by hand, preview first — see APPLIED.md.
--
-- One row per broadcast session. It holds NOTHING about viewers: no IP,
-- no pubkey, no per-viewer row. guest_joins and cap_refusals are plain
-- per-session integers.
--
-- Columns used from the first PR (session create / read / end):
--   id, host_pubkey, title, recipe_a, host_token_hash, status,
--   end_reason, created_at, ended_at
-- Columns created now and used by the later PRs, so that those PRs need
-- no further migration:
--   cf_input_uid, cf_play_url, publish_lock, publish_lock_at, reconnects,
--   started_at            (publish relay)
--   guest_joins, cap_refusals                        (play relay and cap)
--   disconnected_streak                              (sweep)
--
-- Never returned by any endpoint: host_token_hash, cf_input_uid,
-- cf_play_url, publish_lock, publish_lock_at. The Cloudflare publish URL
-- is never stored at all.

CREATE TABLE live_sessions (
  id                  TEXT PRIMARY KEY,   -- 32 lowercase hex chars (128 random bits); the /live/<id> slug
  host_pubkey         TEXT NOT NULL,      -- hex; the NIP-98 signer at create, never a body field
  title               TEXT NOT NULL,
  recipe_a            TEXT,               -- '<kind>:<pubkey>:<d>' of the attached recipe, or NULL (title only)
  host_token_hash     TEXT NOT NULL,      -- sha256 hex of the per-session host token; '' once the session has ended
  status              TEXT NOT NULL DEFAULT 'created',
                      -- 'created' | 'live' | 'ended'
  end_reason          TEXT,
                      -- 'host' | 'timeout' | 'abandoned' | 'never_started' | 'admin' | 'error'
  cf_input_uid        TEXT,               -- current Cloudflare live input; NULL before first publish and after end
  cf_play_url         TEXT,               -- that input's play address; server-side only
  publish_lock        TEXT,               -- nonce while a publish is in flight
  publish_lock_at     INTEGER,            -- unix seconds; a lock older than 30 s is stale
  reconnects          INTEGER NOT NULL DEFAULT 0,
  guest_joins         INTEGER NOT NULL DEFAULT 0,   -- guest cap counter, per session
  cap_refusals        INTEGER NOT NULL DEFAULT 0,   -- guests turned away at the cap, per session
  disconnected_streak INTEGER NOT NULL DEFAULT 0,   -- consecutive 'disconnected' sweep readings
  created_at          INTEGER NOT NULL,   -- unix seconds
  started_at          INTEGER,            -- first successful publish
  ended_at            INTEGER
);

CREATE INDEX live_sessions_status_idx ON live_sessions (status, created_at);

-- At most one session that is not ended per host.
CREATE UNIQUE INDEX live_sessions_one_active_idx
  ON live_sessions (host_pubkey) WHERE status IN ('created', 'live');

-- Rolling-hour create limit, counted by row creation time.
CREATE INDEX live_sessions_host_created_idx ON live_sessions (host_pubkey, created_at);
