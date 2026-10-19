import type NDK from '@nostr-dev-kit/ndk';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import { get } from 'svelte/store';
import type { Cook } from '$lib/landing/content';
import { fetchCuratedReads } from '$lib/reads/curatedReads';
import {
  deduplicatePreviewArticles,
  eventToArticleData,
  isRelevantToReads,
  type ArticleData
} from '$lib/articleUtils';
import {
  ensureReadsModerationLoaded,
  isBlockedFromReads,
  readsModerationReady
} from '$lib/reads/moderationClient';
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

function moderationReady(): Promise<boolean> {
  if (get(readsModerationReady)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      unsub();
      resolve(false);
    }, MODERATION_WAIT_MS);
    const unsub = readsModerationReady.subscribe((ready) => {
      if (!ready) return;
      clearTimeout(t);
      queueMicrotask(() => unsub());
      resolve(true);
    });
  });
}

export interface FreshReads {
  articles: ArticleData[];
  spam: Map<string, SpamReason>;
  /** The Reads filter (topic relevance, curated hides) for one article. */
  keep: (a: ArticleData) => boolean;
}

/**
 * The Reads section's curated articles (feed relay: trusted authors only),
 * mapped and de-duplicated as /reads does, plus the spam rules' verdicts.
 * Null when the curated hides couldn't be loaded: nothing is shown that
 * /reads would hide.
 */
export async function loadFreshReads(ndk: NDK): Promise<FreshReads | null> {
  ensureReadsModerationLoaded();
  const [{ events }, ready] = await Promise.all([fetchCuratedReads(), moderationReady()]);
  if (!ready) return null;
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
  const articles = deduplicatePreviewArticles(list);
  return {
    articles,
    spam: createSpamClassifier()(articles.map(toSpamEvent)),
    keep: (a) => isRelevantToReads(a) && !isBlockedFromReads(a.event)
  };
}
