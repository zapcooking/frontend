/**
 * Lazarus recovery publish: the one write path. Everything in the vendored
 * core is scan/rank/draft; this module turns a draft into a signed event on
 * an explicit user click, then refreshes the app's local copy so the client's
 * next edit doesn't rebuild from the clobbered version.
 *
 * Spec safeguards implemented here (SPEC.md "Recover"):
 *  - re-read the current version from the write relays immediately before
 *    signing; if a newer one appeared since the review, return 'changed' so
 *    the UI recomputes the delta and asks again; if no write relay answers,
 *    abort, since assuming the reviewed version is still current could
 *    overwrite an unseen edit, unless the user explicitly overrides after a
 *    failed retry;
 *  - the recovered event is dated after the version it replaces
 *    (buildLazarusRecoveryDraft);
 *  - the signing account must be the list's author — checked again after
 *    signing, so an account switch mid-approval aborts the publish;
 *  - success is judged on the user's write relays (for a relay list, the
 *    ones the restored version names); the other relays that answered the
 *    scan get the recovery as a best effort.
 */

import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk';
import type NDK from '@nostr-dev-kit/ndk';
import type { NDKRelay } from '@nostr-dev-kit/ndk';
import type { Event } from 'nostr-tools';
import { resetCache as resetFollowListCache } from '$lib/followListCache';
import { profileCacheManager } from '$lib/profileCache';
import { muteListStore } from '$lib/muteListStore';
import { buildLazarusRecoveryDraft } from './recovery';
import { fetchLatestLazarusVersion, getLazarusPublishRelays } from './source';

const SIGN_TIMEOUT_MS = 30000;
const PUBLISH_TIMEOUT_MS = 15000;

export type LazarusPublishResult =
  | { status: 'published'; event: NDKEvent; publishedRelays: string[] }
  | { status: 'changed'; latest: Event };

export class LazarusPublishError extends Error {
  constructor(
    public code:
      | 'no-signer'
      | 'current-unreadable'
      | 'sign-failed'
      | 'sign-timeout'
      | 'wrong-account'
      | 'publish-failed',
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'LazarusPublishError';
  }
}

function toRelaySet(ndk: NDK, urls: string[]): NDKRelaySet {
  // getRelay(url, connect, temporary) — temporary=true arms a 30s removal
  // timer for relays outside explicitRelayUrls, same as the publish queue.
  const relays = urls
    .map((url) => ndk.pool.getRelay(url, true, true))
    .filter((r): r is NonNullable<typeof r> => !!r);
  return new NDKRelaySet(new Set(relays), ndk);
}

async function publishBestEffort(ndk: NDK, event: NDKEvent, urls: string[]) {
  if (!urls.length) return;
  try {
    await event.publish(toRelaySet(ndk, urls), PUBLISH_TIMEOUT_MS);
  } catch {
    // Best effort by spec: relays that answered the scan but aren't write
    // relays keep serving the clobbered copy otherwise; failure here does
    // not fail the recovery.
  }
}

/** Refresh the app's local copy of the recovered kind, so the next edit
 * builds on the recovered version instead of the clobbered one. */
function refreshLocalCopy(kind: number, pubkey: string) {
  if (kind === 3) resetFollowListCache();
  else if (kind === 0) profileCacheManager.invalidateProfile(pubkey);
  else if (kind === 10000) muteListStore.invalidate();
  // Other registry kinds have no local store in this app.
}

export async function publishLazarusRecovery(opts: {
  /** The chosen candidate, verbatim. */
  chosen: Event;
  /** The current version the reviewed delta was computed against: the scan's,
   * or the newer one a 'changed' result returned. */
  reviewedCurrent: Event | undefined;
  /** The list's author. The signing account must be this account. */
  pubkey: string;
  ndk: NDK;
  /** Relays that answered the scan — the recovery goes to them too. */
  respondingRelays: string[];
  /**
   * The explicit override after a failed retry (spec 0.6.0 "Recover"): the
   * user confirmed they want to restore even though the current version
   * could not be confirmed. Never set by the client without a separate,
   * non-pre-selected confirmation, and never remembered between restores.
   */
  allowUnconfirmed?: boolean;
}): Promise<LazarusPublishResult> {
  const { chosen, reviewedCurrent, pubkey, ndk, respondingRelays, allowUnconfirmed } = opts;

  if (!ndk.signer) {
    throw new LazarusPublishError('no-signer', 'This account is view-only and cannot restore');
  }

  // Remote signers need their session ready before the first request.
  const { getAuthManager } = await import('$lib/authManager');
  const authManager = getAuthManager();
  if (authManager) await authManager.ensureNip46SignerReady();

  // Re-read the current version: if another view, device or client edited
  // the list since the review, the delta the user approved is stale. This
  // fails closed — when no write relay can be reached to confirm the
  // current version, the restore aborts rather than assume the reviewed
  // version is still current.
  let latest: Event | undefined;
  try {
    latest = await fetchLatestLazarusVersion(chosen.kind, pubkey);
  } catch (e) {
    // The override is the only way past an unreachable re-read, and only
    // after the user retried and confirmed explicitly: relay lists naming
    // only dead relays are common, and restoring an older relay list is
    // often the fix.
    if (!allowUnconfirmed) {
      throw new LazarusPublishError(
        'current-unreadable',
        "Couldn't reach your write relays to confirm the current version — nothing was published. Please retry.",
        { cause: e }
      );
    }
    latest = reviewedCurrent;
  }
  // Only a newer version counts as a change. The write relays can hold an
  // older copy than the scan found (a clobber published to other relays
  // never reached them); that copy is no edit, and the recovery must still
  // be dated after the reviewed version.
  if (latest && (!reviewedCurrent || latest.created_at > reviewedCurrent.created_at)) {
    return { status: 'changed', latest };
  }

  const draft = buildLazarusRecoveryDraft(chosen, { current: reviewedCurrent });

  const event = new NDKEvent(ndk);
  event.kind = draft.kind;
  event.content = draft.content;
  event.tags = draft.tags;
  event.created_at = draft.created_at;
  event.pubkey = pubkey;

  try {
    await Promise.race([
      event.sign(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('sign timeout')), SIGN_TIMEOUT_MS)
      )
    ]);
  } catch (e) {
    const timedOut = e instanceof Error && e.message === 'sign timeout';
    throw new LazarusPublishError(
      timedOut ? 'sign-timeout' : 'sign-failed',
      timedOut ? 'Signing timed out — nothing was published' : 'Failed to sign the recovery event',
      { cause: e }
    );
  }

  // The signer may have stamped its own account (an account switch during
  // the approval). Restoring one account's list as another's is forbidden.
  if (event.pubkey !== pubkey || event.id == null) {
    throw new LazarusPublishError(
      'wrong-account',
      'The signing account changed — the list was not restored'
    );
  }

  const { write, extra } = await getLazarusPublishRelays(pubkey, respondingRelays, chosen);
  let published: Set<NDKRelay>;
  try {
    published = await event.publish(toRelaySet(ndk, write), PUBLISH_TIMEOUT_MS);
    if (!published || published.size === 0) {
      throw new Error('no write relay accepted the event');
    }
  } catch (e) {
    throw new LazarusPublishError(
      'publish-failed',
      'No write relay accepted the recovery event — please retry',
      { cause: e }
    );
  }

  // Best effort, after success is judged: the answering relays keep serving
  // the clobbered copy otherwise.
  void publishBestEffort(ndk, event, extra);

  refreshLocalCopy(event.kind, pubkey);

  return {
    status: 'published',
    event,
    // The relays that actually took the recovery event — not every relay
    // the pool happens to hold a connection to (scan relays included).
    publishedRelays: Array.from(published, (relay) => relay.url)
  };
}
