-- Migration 0007 — Go live open hosting: accounts blocked from hosting,
-- and the report hold on a session.
--
-- Additive only: one new table, live_ prefixed, and one new nullable
-- column on live_sessions (existing rows read NULL). Nothing existing is
-- altered or read.
--
-- Database: zapcooking-scheduler (D1), binding SCHEDULER_DB. Apply by
-- hand, preview first — see APPLIED.md.
--
-- live_blocked_hosts holds the accounts the admin has blocked from going
-- live. A blocked account cannot create a session or publish to one; the
-- block also ends its open session at the moment it is set. Unblock
-- deletes the row. Written only by POST /api/admin/live (admin NIP-98).
-- The row is kept when the account asks to be deleted: a deletion must
-- not lift a moderation block.
--
-- live_sessions.report_hold_at is the legal hold. It is set (unix
-- seconds, first report wins) when a stream or one of its comments is
-- reported, and cleared only by the admin (POST /api/admin/live,
-- action "release"). A held session is exempt from the 30-day deletion
-- of ended rows and from the account-deletion purge until it is released.

CREATE TABLE live_blocked_hosts (
  pubkey      TEXT PRIMARY KEY,   -- the blocked host (64 lowercase hex)
  created_at  INTEGER NOT NULL    -- unix seconds
);

ALTER TABLE live_sessions ADD COLUMN report_hold_at INTEGER;
