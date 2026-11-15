-- Migration 0009 — live_terms_acceptance, the record that a host agreed
-- to the live-hosting terms ("I'm 18+, agree and go live").
--
-- Additive only: one new table, live_ prefixed. Nothing existing is
-- altered or read.
--
-- Database: zapcooking-scheduler (D1), binding SCHEDULER_DB. Apply by
-- hand, preview first — see APPLIED.md. The create route reads this table
-- on every create and fails (500) while it is missing, so apply it BEFORE
-- the code that reads it is deployed.
--
-- One row per account per terms version (LIVE_TERMS_VERSION in
-- src/lib/live/config.ts). Bumping the version asks every host again; the
-- rows for earlier versions stay, so each agreement keeps its own time.
-- A repeat agreement to the same version keeps the first time.
--
-- Retention (Privacy Policy §9): deleted after the account is deleted,
-- unless one of the account's streams is under an open report hold. See
-- deleteTermsAcceptances in src/lib/live/terms.server.ts.

CREATE TABLE live_terms_acceptance (
  pubkey         TEXT NOT NULL,   -- 64 lowercase hex; the NIP-98 signer, never a body field
  terms_version  TEXT NOT NULL,   -- the LIVE_TERMS_VERSION agreed to
  accepted_at    INTEGER NOT NULL, -- unix seconds
  PRIMARY KEY (pubkey, terms_version)
);
