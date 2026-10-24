-- Migration 0002 — account_deletion_requests, for /api/account/deletion-request.
--
-- Additive only: one new table and its indexes. Nothing existing is
-- altered, and membership records do not live in this database at all
-- (they are on member-relay).
--
-- Database: zapcooking-scheduler (D1) — the project's only D1 database.
-- It lives here rather than in a new database because the request also
-- purges this database's scheduled_events rows for the same pubkey, and
-- one binding keeps that in one place. Applied to both
-- zapcooking-scheduler and zapcooking-scheduler-preview.
--
-- One row per request, and at most one PENDING row per pubkey (the
-- partial unique index). A repeat while pending updates that row; a
-- repeat after completion starts a new one, so a completed row is kept
-- as the record that we did it. Staff work the 'pending' rows
-- (membership + credits on member-relay, Pantry events, and a manual
-- Stripe check whenever billing is not 'cancelled') and set
-- status = 'completed' when done.

CREATE TABLE account_deletion_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pubkey        TEXT NOT NULL,         -- hex; the NIP-98 signer, never a body field
  status        TEXT NOT NULL DEFAULT 'pending',
                -- 'pending' | 'completed'
  source        TEXT NOT NULL,         -- 'web' | 'ios' | 'android' | 'other'
  billing       TEXT NOT NULL,
                -- Stripe renewal outcome of the latest attempt:
                -- 'cancelled' | 'none' | 'error' | 'unavailable'
                -- 'none' means no subscription carries this pubkey in
                -- its metadata. Subscriptions created before that
                -- metadata existed can still be renewing, so staff
                -- checks Stripe by hand for anything but 'cancelled'.
  scheduled_posts_removed INTEGER NOT NULL DEFAULT 0,
  attempts      INTEGER NOT NULL DEFAULT 1,  -- requests folded into this row
  requested_at  INTEGER NOT NULL,      -- unix seconds; first request (the 30-day clock)
  updated_at    INTEGER NOT NULL,      -- latest request or status change
  completed_at  INTEGER
);

CREATE UNIQUE INDEX idx_deletion_one_pending
  ON account_deletion_requests (pubkey) WHERE status = 'pending';
CREATE INDEX idx_deletion_status ON account_deletion_requests (status, requested_at);
CREATE INDEX idx_deletion_pubkey ON account_deletion_requests (pubkey, id);
