import type NDK from '@nostr-dev-kit/ndk';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import type { Cook } from '$lib/landing/content';
import { fetchCuratedReads } from '$lib/reads/curatedReads';
import { eventToArticleData, isRelevantToReads, type ArticleData } from '$lib/articleUtils';
import { isBlockedFromReads, readsModerationAvailable } from '$lib/reads/moderationClient';
import { createSpamClassifier, type SpamReason } from '$lib/reads/spamRules';
import { toSpamEvent } from '$lib/reads/allReadsView';
import { loadFollowing } from './social';

/**
 * The data behind the discovery column's lower panels, loaded only when a
 * panel is about to scroll into view (FeedDiscoveryRail). Each loader
 * resolves to "nothing" rather than throwing: an empty panel is hidden.
 */

let cooks: Promise<Cook[]> | null = null;

/** The /explore cooks (org `feed-foodies`, rotated daily), from the cached landing build; once per session. */
export function loadCooks(): Promise<Cook[]> {
  cooks ??= fetch('/api/landing/cooks', { headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : { cooks: [] }))
    .then((d: { cooks?: Cook[] }) => (Array.isArray(d.cooks) ? d.cooks : []))
    .catch(() => {
      cooks = null; // try again next time
      return [];
    });
  return cooks;
}

const FOLLOWING_TIMEOUT_MS = 4000;

/** The reader's follows, or null when they couldn't be read in time (nobody is left out for it). */
export async function readerFollowing(ndk: NDK, me: string): Promise<Set<string> | null> {
  if (!me) return null;
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), FOLLOWING_TIMEOUT_MS));
  try {
    const set = await Promise.race([loadFollowing(ndk, me), timeout]);
    return set ? new Set([...set].map((p) => p.toLowerCase())) : null;
  } catch {
    return null;
  }
}

const MODERATION_WAIT_MS = 8000;

/**
 * The curated hides are really here: an overlay fetch succeeded (a failed
 * one is tried again; `readsModerationReady` alone is also set by a
 * failure). False after a failure or the timeout: the panel stays hidden.
 */
function moderationLoaded(): Promise<boolean> {
  const timeout = new Promise<boolean>((r) => setTimeout(() => r(false), MODERATION_WAIT_MS));
  return Promise.race([readsModerationAvailable().catch(() => false), timeout]);
}

export interface FreshReads {
  articles: ArticleData[];
  spam: Map<string, SpamReason>;
  /** The Reads filter (topic relevance, curated hides) for one article. */
  keep: (a: ArticleData) => boolean;
}

/**
 * The Reads section's curated articles (feed relay: trusted authors only),
 * mapped as /reads maps them, plus the spam rules' verdicts. Null when the
 * curated hides couldn't be loaded (failed or timed out): nothing is shown
 * that /reads would hide.
 */
export async function loadFreshReads(ndk: NDK): Promise<FreshReads | null> {
  const [{ events }, loaded] = await Promise.all([fetchCuratedReads(), moderationLoaded()]);
  if (!loaded) return null;
  const seen = new Set<string>();
  const list: ArticleData[] = [];
  for (const raw of events) {
    const article = eventToArticleData(
      new NDKEvent(ndk, raw as ConstructorParameters<typeof NDKEvent>[1]),
      true
    );
    if (article && !seen.has(article.id)) {
      seen.add(article.id);
      list.push(article);
    }
  }
  // Preview de-duplication happens after the cover and Reads filters, in
  // the selection (pickReads), as /reads orders them.
  return {
    articles: list,
    spam: createSpamClassifier()(list.map(toSpamEvent)),
    keep: (a) => isRelevantToReads(a) && !isBlockedFromReads(a.event)
  };
}
