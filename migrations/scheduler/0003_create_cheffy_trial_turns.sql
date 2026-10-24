-- Lifetime Cheffy text samples. Apply to the existing preview D1 database
-- before production. No prompts or model answers are stored here.
-- Reservations count toward the cap; definite upstream failures release them.
-- The conditional INSERT in cheffyTrial.server.ts is atomic across Workers.
CREATE TABLE cheffy_trial_turns (
  pubkey TEXT NOT NULL,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (pubkey, request_id)
);
