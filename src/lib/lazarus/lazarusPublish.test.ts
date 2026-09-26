import { beforeEach, describe, expect, it, vi } from 'vitest';
import type NDK from '@nostr-dev-kit/ndk';
import type { Event } from 'nostr-tools';

/** The one write path, with the signer, the relay adapter and the app's
 * local stores mocked out: the pre-sign re-check, the recovery's timestamp,
 * and the relays reported as accepting it. */

const state = vi.hoisted(() => ({
  /** Relays that accept a publish; the rest of the relay set rejects it. */
  accepting: new Set<string>(),
  signed: 0
}));

vi.mock('@nostr-dev-kit/ndk', () => ({
  NDKEvent: class {
    kind = 0;
    content = '';
    tags: string[][] = [];
    created_at = 0;
    pubkey = '';
    id?: string;
    async sign() {
      state.signed += 1;
      this.id = `signed-${this.created_at}`;
    }
    async publish(relaySet: { relays: Set<{ url: string }> }) {
      return new Set([...relaySet.relays].filter((relay) => state.accepting.has(relay.url)));
    }
  },
  NDKRelaySet: class {
    constructor(public relays: Set<{ url: string }>) {}
  }
}));

vi.mock('$lib/followListCache', () => ({ resetCache: vi.fn() }));
vi.mock('$lib/profileCache', () => ({ profileCacheManager: { invalidateProfile: vi.fn() } }));
vi.mock('$lib/muteListStore', () => ({ muteListStore: { invalidate: vi.fn() } }));
vi.mock('$lib/authManager', () => ({ getAuthManager: () => null }));
vi.mock('./source', () => ({
  fetchLatestLazarusVersion: vi.fn(),
  getLazarusPublishRelays: vi.fn()
}));

import { fetchLatestLazarusVersion, getLazarusPublishRelays } from './source';
import { publishLazarusRecovery } from './lazarusPublish';

const PUBKEY = 'a'.repeat(64);
const WRITE_RELAYS = ['wss://write-a', 'wss://write-b'];
const NOW = Math.floor(Date.now() / 1000);

const mockedFetchLatest = vi.mocked(fetchLatestLazarusVersion);

function followList(id: string, createdAt: number, count: number): Event {
  return {
    id: id.padStart(64, '0'),
    pubkey: PUBKEY,
    created_at: createdAt,
    kind: 3,
    tags: Array.from({ length: count }, (_, i) => ['p', i.toString(16).padStart(64, '0')]),
    content: '',
    sig: 'sig'
  };
}

// The version to restore, and a clobber dated an hour ahead of this clock.
const healthy = followList('1', NOW - 86400, 40);
const clobbered = followList('2', NOW + 3600, 3);

const ndk = {
  signer: {},
  pool: { getRelay: (url: string) => ({ url }) }
} as unknown as NDK;

function restore(reviewedCurrent: Event | undefined) {
  return publishLazarusRecovery({
    chosen: healthy,
    reviewedCurrent,
    pubkey: PUBKEY,
    ndk,
    respondingRelays: []
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.accepting = new Set(WRITE_RELAYS);
  state.signed = 0;
  vi.mocked(getLazarusPublishRelays).mockResolvedValue({ write: WRITE_RELAYS, extra: [] });
});

describe('publishLazarusRecovery', () => {
  it('restores over an older copy on the write relays, dated after the reviewed version', async () => {
    // The clobber was published elsewhere and the write relays still hold an
    // older version: no edit since the review.
    mockedFetchLatest.mockResolvedValue(followList('3', NOW - 3600, 38));
    const result = await restore(clobbered);
    expect(result.status).toBe('published');
    expect(result.status === 'published' && result.event.created_at).toBe(
      clobbered.created_at + 1
    );
  });

  it('asks again when a newer version appeared, then restores on the retry', async () => {
    const newer = followList('4', NOW + 7200, 5);
    mockedFetchLatest.mockResolvedValue(newer);
    expect(await restore(clobbered)).toEqual({ status: 'changed', latest: newer });

    // The retry passes the version the delta was recomputed against.
    const retry = await restore(newer);
    expect(retry.status).toBe('published');
    expect(retry.status === 'published' && retry.event.created_at).toBe(newer.created_at + 1);
  });

  it('treats a version found when none was reviewed as a change', async () => {
    const found = followList('5', NOW - 60, 10);
    mockedFetchLatest.mockResolvedValue(found);
    expect(await restore(undefined)).toEqual({ status: 'changed', latest: found });
  });

  it('aborts before signing when no write relay answers the re-read', async () => {
    mockedFetchLatest.mockRejectedValue(new Error('no write relay answered'));
    await expect(restore(clobbered)).rejects.toMatchObject({ code: 'current-unreadable' });
    expect(state.signed).toBe(0);
  });

  it('reports only the write relays that accepted the recovery', async () => {
    mockedFetchLatest.mockResolvedValue(clobbered);
    state.accepting = new Set(['wss://write-b']);
    const result = await restore(clobbered);
    expect(result.status === 'published' && result.publishedRelays).toEqual(['wss://write-b']);
  });

  describe('the unreachable re-read override (spec 0.6.0)', () => {
    it('restores anyway when explicitly allowed, dated after the reviewed version', async () => {
      mockedFetchLatest.mockRejectedValue(new Error('no write relay answered'));
      const result = await publishLazarusRecovery({
        chosen: healthy,
        reviewedCurrent: clobbered,
        pubkey: PUBKEY,
        ndk,
        respondingRelays: [],
        allowUnconfirmed: true
      });
      // The override proceeds against the reviewed version — the only one the
      // delta was computed against — and still dates after it.
      expect(result.status).toBe('published');
      expect(result.status === 'published' && result.event.created_at).toBe(
        clobbered.created_at + 1
      );
      expect(state.signed).toBe(1);
    });

    it('never treats a write relay that answered with an older copy as changed under the override', async () => {
      // With the override in force the re-read result is unused; an older
      // copy on a reachable relay would otherwise read as "no change" anyway,
      // and the recovery must still be dated after the reviewed clobber.
      mockedFetchLatest.mockResolvedValue(followList('6', NOW - 7200, 39));
      const result = await publishLazarusRecovery({
        chosen: healthy,
        reviewedCurrent: clobbered,
        pubkey: PUBKEY,
        ndk,
        respondingRelays: [],
        allowUnconfirmed: true
      });
      expect(result.status).toBe('published');
      expect(result.status === 'published' && result.event.created_at).toBe(
        clobbered.created_at + 1
      );
    });
  });
});
