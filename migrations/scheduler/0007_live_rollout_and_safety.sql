-- Migration 0007 — Go live staged rollout and safety: approved hosts,
-- blocked hosts, stream reports, report holds, temporary suspensions and
-- the action log. (Folds in the design of draft PR #976.)
--
-- Additive only: six new tables, all live_ prefixed, three indexes, and
-- one seed row. Nothing existing is altered or read. No foreign keys:
-- D1 enforces them, and the account-deletion purge must be able to
-- remove a host's unheld sessions without first walking these tables.
--
-- Database: zapcooking-scheduler (D1), binding SCHEDULER_DB. Apply by
-- hand, preview first — see APPLIED.md.
--
-- No media is recorded. No viewer or reporter IP is stored: a reporter is
-- a daily-salted IP hash (the per-IP rate limiter's), never the address.

-- Hosts approved to go live while the hosting mode is "approved" (the
-- default). Managed from /admin/live. In "members" mode the list is not
-- consulted: any active member may host.
CREATE TABLE live_approved_hosts (
  pubkey      TEXT PRIMARY KEY,   -- 64 lowercase hex
  created_at  INTEGER NOT NULL,   -- unix seconds
  added_by    TEXT NOT NULL       -- admin pubkey, or 'migration'
);

-- Seed: the admin account (the `seth` zap.cooking key), the only host
-- before this migration.
INSERT INTO live_approved_hosts (pubkey, created_at, added_by)
VALUES ('a723805cda67251191c8786f4da58f797e6977582301354ba8e91bcb0342dc9c', 1794700800, 'migration');

-- Accounts the admin has blocked from going live, in every mode. A block
-- also ends the account's open session when it is set. Unblock deletes
-- the row. Kept when the account is deleted.
CREATE TABLE live_blocked_hosts (
  pubkey      TEXT PRIMARY KEY,   -- 64 lowercase hex
  created_at  INTEGER NOT NULL
);

-- Reports on a stream or on one comment in its chat. One per reporter per
-- target (the stream, or one comment).
CREATE TABLE live_reports (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL,
  reporter_hash   TEXT NOT NULL,  -- daily-salted IP hash, or 'unverified:<uuid>'
  reason          TEXT NOT NULL
                  CHECK (reason IN ('child_safety', 'nudity', 'violence', 'spam', 'other')),
  details         TEXT NOT NULL DEFAULT '',   -- the reporter's note, at most 300 chars
  comment_id      TEXT,           -- the reported comment's event id; NULL = the stream
  comment_pubkey  TEXT,           -- that comment's author
  created_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX live_reports_one_per_reporter_idx
  ON live_reports (session_id, reporter_hash, COALESCE(comment_id, ''));
CREATE INDEX live_reports_session_idx ON live_reports (session_id, created_at);

-- The report hold. Opened by the first report on a session; released only
-- by the admin. While open, the session row and its reports are kept past
-- every retention rule and through the account-deletion purge.
-- snapshot_json is the session's public facts at the first report (never
-- the Cloudflare input id).
CREATE TABLE live_holds (
  session_id     TEXT PRIMARY KEY,
  opened_at      INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'released')),
  released_at    INTEGER,
  released_by    TEXT,            -- admin pubkey
  snapshot_json  TEXT NOT NULL DEFAULT '{}'
);

-- Temporary hosting suspension set by an automatic stream end (only when
-- LIVE_SAFETY_AUTO_END is 'true'). Create is refused until suspended_until.
CREATE TABLE live_host_suspensions (
  host_pubkey      TEXT PRIMARY KEY,
  suspended_until  INTEGER NOT NULL,
  reason           TEXT NOT NULL,
  session_id       TEXT NOT NULL
);

-- The action log: every admin action and every automatic one, with time
-- and actor. Not deleted by any retention rule.
CREATE TABLE live_actions (
  id             TEXT PRIMARY KEY,
  occurred_at    INTEGER NOT NULL,
  actor          TEXT NOT NULL,   -- admin pubkey, or 'system'
  action         TEXT NOT NULL,   -- approve | unapprove | mode | end | off | block | unblock
                                  -- | hide | unhide | release_hold | auto_end
  session_id     TEXT,
  target_pubkey  TEXT,
  detail         TEXT NOT NULL DEFAULT ''
);
CREATE INDEX live_actions_time_idx ON live_actions (occurred_at);
