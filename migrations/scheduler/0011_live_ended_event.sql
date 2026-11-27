-- Migration 0011 — Go live: the pre-signed "ended" announcement, held by
-- the server until the session ends.
--
-- Additive only: four new columns on live_sessions (existing rows read
-- NULL / 0). Nothing existing is altered or read.
--
-- Database: zapcooking-scheduler (D1), binding SCHEDULER_DB. Apply by
-- hand, preview first — see APPLIED.md. The code that reads these columns
-- fails soft while they are missing (the store route answers 500, which
-- the host page ignores; the sweep logs and skips its publish step), but
-- apply this BEFORE deploying it.
--
-- Why: only the host can sign the kind 30311 that says a stream has
-- ended, and the host page is often gone by then (tab closed, connection
-- lost, the 90-minute limit). So whenever the host page signs a live
-- announcement it also signs the matching ended one and leaves it here;
-- when the session ends by any path the server publishes it. The server
-- never builds or signs an event.
--
-- live_sessions.ended_event: the signed kind 30311 with status "ended",
-- as JSON (id, pubkey, created_at, kind, tags, content, sig), at most
-- 8 KB. Validated before it is stored: the session's id as `d`, the
-- session's host as pubkey, a valid signature. Only the newest is kept
-- (by its created_at). Not readable by anyone until the session has
-- ended; public after that, like the event itself.
--
-- live_sessions.ended_event_relays: a JSON array of up to 8 relay URLs
-- the host page published the live announcement to (wss:// only, public
-- hostnames), published to in addition to the fixed list.
--
-- live_sessions.ended_publish_state: NULL while nothing has been settled;
-- 'published' once at least one relay took the event (or already had a
-- newer one); 'gave_up' after the last failed try.
--
-- live_sessions.ended_publish_tries: failed publish attempts so far.
--
-- All four go with the row, 30 days after the session ended.

ALTER TABLE live_sessions ADD COLUMN ended_event TEXT;
ALTER TABLE live_sessions ADD COLUMN ended_event_relays TEXT;
ALTER TABLE live_sessions ADD COLUMN ended_publish_state TEXT;
ALTER TABLE live_sessions ADD COLUMN ended_publish_tries INTEGER NOT NULL DEFAULT 0;
