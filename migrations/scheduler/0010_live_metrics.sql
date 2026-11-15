-- Migration 0010 — Go live metrics: viewer time and zaps per session, and
-- a monthly per-host summary that outlives the 30-day session purge.
--
-- Additive only: three new columns on live_sessions (NULL by default, so
-- every existing row reads "not recorded yet"), one partial index, and one
-- new table, live_ prefixed. Nothing existing is altered or read.
--
-- Database: zapcooking-scheduler (D1), binding SCHEDULER_DB. Apply by
-- hand, preview first — see APPLIED.md. The sweep's close-out step reads
-- these columns, and fails soft (logs and skips) while they are missing,
-- but apply this BEFORE deploying the code that reads it.
--
-- live_sessions.viewer_seconds: total time viewers spent watching, summed
-- by the session's presence Durable Object from the anonymous heartbeats
-- (each heartbeat of a code already counted adds the time since that
-- code's previous one, capped at 60 s). One integer per session; nothing
-- per viewer. NULL when it could not be read (the object was unreachable
-- for an hour after the end).
--
-- live_sessions.zap_sats: sats in the zap receipts (kind 9735) on the
-- session's "Live now" note, read from public relays a few minutes after
-- the end. 0 when the session had no note.
--
-- live_sessions.metrics_at: when the sweep recorded the two numbers above
-- and folded the session into live_host_monthly (unix seconds). Set once;
-- a session is folded exactly once (one D1 batch, conditional on this
-- being NULL).
--
-- live_host_monthly: one row per host per calendar month (UTC, by the
-- stream's start). Sessions that never went live are not counted. Kept
-- for 24 months (the sweep deletes older months) and deleted at the
-- host's account-deletion request. Shown to admins only
-- (/admin/live/metrics).

ALTER TABLE live_sessions ADD COLUMN viewer_seconds INTEGER;
ALTER TABLE live_sessions ADD COLUMN zap_sats INTEGER;
ALTER TABLE live_sessions ADD COLUMN metrics_at INTEGER;

-- The sweep's close-out list: ended sessions not recorded yet.
CREATE INDEX live_sessions_metrics_pending_idx
  ON live_sessions (ended_at) WHERE status = 'ended' AND metrics_at IS NULL;

CREATE TABLE live_host_monthly (
  host_pubkey     TEXT NOT NULL,              -- 64 lowercase hex
  month           TEXT NOT NULL,              -- 'YYYY-MM', UTC, of the stream's start
  streams         INTEGER NOT NULL DEFAULT 0, -- sessions that went live
  stream_seconds  INTEGER NOT NULL DEFAULT 0, -- sum of (ended_at - started_at)
  longest_seconds INTEGER NOT NULL DEFAULT 0, -- the longest single stream
  viewer_seconds  INTEGER NOT NULL DEFAULT 0, -- sum of live_sessions.viewer_seconds
  peak_watching   INTEGER NOT NULL DEFAULT 0, -- the highest single-stream peak
  zap_sats        INTEGER NOT NULL DEFAULT 0, -- sum of live_sessions.zap_sats
  updated_at      INTEGER NOT NULL,           -- unix seconds
  PRIMARY KEY (host_pubkey, month)
);
