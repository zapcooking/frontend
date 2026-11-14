-- Migration 0006 — live_sessions.note_id, the session's "Live now" note.
--
-- Additive only: one new nullable column on live_sessions, so every
-- existing row reads NULL. Nothing else is altered or read.
--
-- Database: zapcooking-scheduler (D1), binding SCHEDULER_DB. Apply by
-- hand, preview first — see APPLIED.md.
--
-- note_id is the event id (64 lowercase hex) of the kind 1 note the host
-- posts when going live. Viewers read it with the session to find the
-- stream's comments (replies to the note) and its zaps. NULL means the
-- host went live without a note: no comments, no zap total. Set once, by
-- the host (host token), while the session has not ended. It is public:
-- the note itself is public on Nostr. Nothing about viewers is stored.

ALTER TABLE live_sessions ADD COLUMN note_id TEXT;
