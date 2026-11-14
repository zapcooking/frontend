-- Migration 0006 — Go live comments: the session's "Live now" note, and
-- accounts hidden from live comments.
--
-- Additive only: one new nullable column on live_sessions (existing rows
-- read NULL) and one new table, live_ prefixed. Nothing existing is
-- altered or read.
--
-- Database: zapcooking-scheduler (D1), binding SCHEDULER_DB. Apply by
-- hand, preview first — see APPLIED.md.
--
-- live_sessions.note_id is the event id (64 lowercase hex) of the kind 1
-- note the host posts when going live. Viewers read it with the session
-- to find the stream's comments (replies to the note) and its zaps. NULL
-- means the host went live without a note: no comments, no zap total.
-- Set once, by the host (host token), while the session has not ended.
-- Public: the note itself is public on Nostr.
--
-- live_hidden_authors holds the commenters whose comments are left out of
-- Go live chats, by moderation decision:
--   scope = a host's pubkey  hidden by that host, in all of their streams
--   scope = 'global'         hidden by the admin, in every Go live chat
-- pubkey is the COMMENTER's key (someone who posted a public comment),
-- never a viewer's: nothing about viewers is stored. Unhide deletes the
-- row. Read by GET /api/live/<id>/hidden, written by POST to the same
-- path (NIP-98: the session's host for their scope, the admin for any).

ALTER TABLE live_sessions ADD COLUMN note_id TEXT;

CREATE TABLE live_hidden_authors (
  scope       TEXT NOT NULL,      -- host pubkey (64 hex) or 'global'
  pubkey      TEXT NOT NULL,      -- the hidden commenter (64 hex)
  created_at  INTEGER NOT NULL,   -- unix seconds
  PRIMARY KEY (scope, pubkey)
);
