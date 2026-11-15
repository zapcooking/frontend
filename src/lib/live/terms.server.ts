/**
 * Go live — the hosting agreement: a host confirms they are 18 or older
 * and agrees to the Terms of Service (including the Live Stream Conduct
 * rules) before going live, once per account per LIVE_TERMS_VERSION.
 *
 * Table (migration 0009): live_terms_acceptance (pubkey, terms_version,
 * accepted_at). It is a statement by the host, not age verification.
 *
 * Retention (Privacy Policy §9 "Hosting agreement"): an account's rows are
 * deleted once the account has asked to be deleted, unless one of its
 * streams is under an open report hold; then they wait for the release.
 */
import type { LiveDb } from './sessions.server';

/** Has this account agreed to this version of the hosting terms? */
export async function hasAcceptedTerms(
  db: LiveDb,
  pubkey: string,
  version: string
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS x FROM live_terms_acceptance WHERE pubkey = ?1 AND terms_version = ?2')
    .bind(pubkey.toLowerCase(), version)
    .first<{ x: number }>();
  return !!row;
}

/** Record an agreement. A repeat for the same version keeps the first time. */
export async function recordTermsAcceptance(
  db: LiveDb,
  pubkey: string,
  version: string,
  now: number
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO live_terms_acceptance (pubkey, terms_version, accepted_at)
       VALUES (?1, ?2, ?3)`
    )
    .bind(pubkey.toLowerCase(), version, now)
    .run();
}

/** No stream hosted by the row's account is under an open hold. */
const NOT_HELD = `NOT EXISTS (
    SELECT 1 FROM live_sessions s JOIN live_holds h ON h.session_id = s.id
     WHERE s.host_pubkey = live_terms_acceptance.pubkey AND h.status = 'open')`;

/**
 * Delete one account's agreements, unless one of its streams is under an
 * open hold (account deletion, at the request).
 */
export async function deleteTermsAcceptancesFor(db: LiveDb, pubkey: string): Promise<number> {
  const result = await db
    .prepare(`DELETE FROM live_terms_acceptance WHERE pubkey = ?1 AND ${NOT_HELD}`)
    .bind(pubkey.toLowerCase())
    .run();
  return result.meta?.changes ?? 0;
}

/**
 * The sweep: delete agreements made before their account asked to be
 * deleted, once no stream of that account is under an open hold. Catches
 * rows a hold kept at the request, after the hold is released. An
 * agreement made after the request (the key came back and hosted again)
 * is kept.
 */
export async function cleanupTermsAcceptances(db: LiveDb): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM live_terms_acceptance
        WHERE EXISTS (SELECT 1 FROM account_deletion_requests d
                       WHERE d.pubkey = live_terms_acceptance.pubkey
                         AND d.requested_at >= live_terms_acceptance.accepted_at)
          AND ${NOT_HELD}`
    )
    .bind()
    .run();
  return result.meta?.changes ?? 0;
}
