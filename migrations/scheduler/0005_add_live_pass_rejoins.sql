-- Migration 0005 — live_sessions.pass_rejoins, the ceiling on rejoin passes.
--
-- Additive only: one new column on live_sessions, with a default, so
-- every existing row reads 0. Nothing else is altered or read.
--
-- Database: zapcooking-scheduler (D1), binding SCHEDULER_DB. Apply by
-- hand, preview first — see APPLIED.md.
--
-- pass_rejoins counts joins admitted on a rejoin pass, per session. Past
-- 3x the guest cap a pass is no longer honoured and the viewer is treated
-- as a new guest. Like guest_joins it is a plain per-session integer:
-- nothing about any viewer is stored. Never returned by a public endpoint.

ALTER TABLE live_sessions ADD COLUMN pass_rejoins INTEGER NOT NULL DEFAULT 0;
