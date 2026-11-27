-- Migration 0008 — live_sessions.peak_watching and live_sessions.joins,
-- the after-the-stream counts for the host.
--
-- Additive only: two new columns on live_sessions, with defaults, so every
-- existing row reads 0. Nothing else is altered or read.
--
-- Database: zapcooking-scheduler (D1), binding SCHEDULER_DB. Apply by
-- hand, preview first — see APPLIED.md.
--
-- peak_watching is the highest "watching now" count the session reached.
-- That count comes from an anonymous heartbeat: each watch page sends a
-- random code made fresh on every page load, and a Durable Object per
-- session counts the distinct codes heard in the last ~60 s. The codes
-- are held by that object (in memory, and in its own storage until they
-- expire, so a restart does not empty the count) and never written here.
--
-- joins counts viewers admitted by the play relay (members and guests),
-- not counting rejoins on a pass and not counting the host.
--
-- Like guest_joins and pass_rejoins, both are plain per-session integers:
-- nothing about any viewer is stored. They are shown to the session's
-- host only (End reply, and GET /api/live/<id>/stats signed by the host),
-- and are deleted with the row (ended rows: 30 days).

ALTER TABLE live_sessions ADD COLUMN peak_watching INTEGER NOT NULL DEFAULT 0;
ALTER TABLE live_sessions ADD COLUMN joins INTEGER NOT NULL DEFAULT 0;
