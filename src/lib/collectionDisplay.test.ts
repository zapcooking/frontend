import { describe, it, expect, vi } from 'vitest';
import type { NDKEvent } from '@nostr-dev-kit/ndk';

/**
 * collectionDisplay imports DEFAULT_LIST_ID / DEFAULT_LIST_TITLE from the
 * cookbook store, which reaches `$lib/nostr` and therefore
 * `$app/environment`. Mocked at the boundary exactly as
 * stores/cookbookStore.test.ts does — the store module itself stays real,
 * so the default-list case below is asserted against the shipped
 * constants rather than against a copy of them.
 */
vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return {
    ndk: writable<unknown>(null),
    userPublickey: writable(''),
    ensureNdkConnected: vi.fn(async () => {})
  };
});
vi.mock('$lib/connectionMonitor', () => ({
  isCurrentlyOnline: vi.fn(() => true),
  onConnect: vi.fn(() => () => {})
}));
vi.mock('$lib/offlineStorage', () => ({
  offlineStorage: {
    getAllCookbooks: vi.fn(async () => []),
    saveCookbook: vi.fn(async () => {}),
    getPendingOperations: vi.fn(async () => []),
    markCookbookSynced: vi.fn(async () => {}),
    queueOperation: vi.fn(async () => {}),
    removeOperation: vi.fn(async () => {}),
    updateOperationRetry: vi.fn(async () => {}),
    clearFailedOperations: vi.fn(async () => {}),
    getQueueStatus: vi.fn(async () => ({ pending: 0, failed: 0 }))
  }
}));

import {
  getCollectionTitle,
  getCollectionSummary,
  getCollectionImage,
  COLLECTION_FALLBACK_TITLE
} from './collectionDisplay';
import { DEFAULT_LIST_ID, DEFAULT_LIST_TITLE } from './stores/cookbookStore';

/**
 * These pin the function bodies, which were never the bug — the bug was
 * that the component called them with no arguments, so Svelte saw no
 * reactive dependency and ran them once at init. That defect lives in
 * the compiled output, and its test is collectionReactivity.test.ts
 * alongside the page. These two files are a pair; neither catches the
 * other's failure.
 */

function ev(tags: string[][]): NDKEvent {
  return { tags } as unknown as NDKEvent;
}

const COVER = 'https://image.nostr.build/cover.jpg';

describe('getCollectionTitle', () => {
  it('returns the title tag', () => {
    expect(getCollectionTitle(ev([['title', 'Happy Food']]))).toBe('Happy Food');
  });

  it('falls back when there is no event yet', () => {
    expect(getCollectionTitle(null)).toBe(COLLECTION_FALLBACK_TITLE);
  });

  it('falls back on an event with no title tag', () => {
    expect(getCollectionTitle(ev([['d', 'happy-food']]))).toBe(COLLECTION_FALLBACK_TITLE);
  });

  it('falls back on an empty title tag rather than rendering nothing', () => {
    expect(getCollectionTitle(ev([['title', '']]))).toBe(COLLECTION_FALLBACK_TITLE);
  });

  it('names the default list from its d tag, ignoring any stored title', () => {
    const tags = [
      ['d', DEFAULT_LIST_ID],
      ['title', 'whatever was stored']
    ];
    expect(getCollectionTitle(ev(tags))).toBe(DEFAULT_LIST_TITLE);
  });
});

describe('getCollectionSummary', () => {
  it('returns the summary tag', () => {
    expect(getCollectionSummary(ev([['summary', 'Everything worth making twice.']]))).toBe(
      'Everything worth making twice.'
    );
  });

  it('is undefined with no event and with no summary tag', () => {
    expect(getCollectionSummary(null)).toBeUndefined();
    expect(getCollectionSummary(ev([['d', 'happy-food']]))).toBeUndefined();
  });
});

describe('getCollectionImage', () => {
  it('prefers the loaded cover over the legacy image tag', () => {
    const tags = [['image', 'https://image.nostr.build/legacy.jpg']];
    expect(getCollectionImage(ev(tags), COVER)).toBe(COVER);
  });

  it('falls back to the legacy image tag when no cover has loaded', () => {
    const tags = [['image', 'https://image.nostr.build/legacy.jpg']];
    expect(getCollectionImage(ev(tags), undefined)).toBe('https://image.nostr.build/legacy.jpg');
  });

  it('is undefined with neither', () => {
    expect(getCollectionImage(null, undefined)).toBeUndefined();
    expect(getCollectionImage(ev([['d', 'happy-food']]), undefined)).toBeUndefined();
  });
});
