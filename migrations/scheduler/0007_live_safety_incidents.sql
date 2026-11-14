-- Migration 0007: durable Go Live safety reports and preservation holds.
-- Apply to SCHEDULER_DB before deploying the API (see migrations/scheduler/APPLIED.md).
-- No media is recorded. No plaintext viewer or reporter IPs are stored.
CREATE TABLE IF NOT EXISTS live_safety_reports (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  reporter_hash TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('child_safety','nudity','violence','spam','other')),
  details TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE(session_id, reporter_hash),
  FOREIGN KEY (session_id) REFERENCES live_sessions(id)
);
CREATE INDEX IF NOT EXISTS live_safety_reports_session_idx ON live_safety_reports (session_id, created_at);
CREATE INDEX IF NOT EXISTS live_safety_reports_created_idx ON live_safety_reports (created_at);
CREATE TABLE IF NOT EXISTS live_safety_holds (
  session_id TEXT PRIMARY KEY REFERENCES live_sessions(id),
  opened_at INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','released')),
  released_at INTEGER
);
CREATE TABLE IF NOT EXISTS live_safety_actions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  occurred_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS live_safety_actions_session_idx ON live_safety_actions (session_id, occurred_at);
