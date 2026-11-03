import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

/**
 * A sign-in can switch accounts while a bookmark load started from the
 * stored pubkey (locked passkey session) is still in flight. That load must
 * never answer for — or be republished under — the new account.
 */

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const NOTE = 'c'.repeat(64);

type Handler = (...args: unknown[]) => void;
interface FakeSub {
  author: string;
  handlers: Record<string, Handler>;
  done?: boolean;
}
interface Published {
  pubkey: string;
  tags: string[][];
  content: string;
}

const h = vi.hoisted(() => ({ subs: [] as FakeSub[], published: [] as Published[] }));

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$lib/toast', () => ({ showToast: vi.fn() }));
vi.mock('$lib/nip89', () => ({ addClientTagToEvent: vi.fn() }));
vi.mock('$lib/outboxPublish', () => ({ outboxRelaySet: vi.fn(async () => undefined) }));
vi.mock('@nostr-dev-kit/ndk', () => ({
  NDKEvent: class {
    kind = 0;
    tags: string[][] = [];
    content = '';
    created_at = 0;
    async publish() {
      const { userPublickey } = await import('$lib/nostr');
      const { get } = await import('svelte/store');
      h.published.push({ pubkey: get(userPublickey), tags: this.tags, content: this.content });
    }
  }
}));
vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  const ndkInstance = {
    subscribe: (filter: { authors: string[] }) => {
      const entry: FakeSub = { author: filter.authors[0], handlers: {} };
      h.subs.push(entry);
      return {
        on: (name: string, fn: Handler) => (entry.handlers[name] = fn),
        stop: () => {}
      };
    }
  };
  return {
    ndk: writable(ndkInstance),
    userPublickey: writable(''),
    ensureNdkConnected: async () => {}
  };
});

// Bound per test by freshStore(): resetModules gives the store a fresh
// $lib/nostr mock, and the test must drive that same instance.
let userPublickey: { set: (v: string) => void };

/** Answer the pending subscription for `author` with its list (or none). */
async function answer(author: string, list: { ids: string[]; content?: string } | null) {
  await vi.advanceTimersByTimeAsync(0); // let the load reach subscribe()
  const sub = h.subs.find((s: FakeSub) => s.author === author && !s.done);
  if (!sub) throw new Error(`no pending load for ${author.slice(0, 4)}`);
  sub.done = true;
  if (list) {
    sub.handlers.event?.({
      pubkey: author,
      created_at: 100,
      content: list.content ?? '',
      tags: [['d', 'bookmarks'], ...list.ids.map((id) => ['e', id])]
    });
  }
  sub.handlers.eose?.();
  await vi.advanceTimersByTimeAsync(1000);
}

async function freshStore() {
  vi.resetModules();
  const store = (await import('./noteBookmarksStore')).noteBookmarksStore;
  userPublickey = (await import('$lib/nostr')).userPublickey;
  return store;
}

beforeEach(() => {
  vi.useFakeTimers();
  h.subs.length = 0;
  h.published.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('noteBookmarksStore across an account switch', () => {
  it("does not answer for B with A's in-flight load", async () => {
    const store = await freshStore();
    userPublickey.set(A);
    const loadA = store.load();

    userPublickey.set(B); // signed in as someone else mid-load
    const loadB = store.load();

    await answer(A, { ids: [NOTE], content: 'A-private-ciphertext' });
    await loadA;
    await answer(B, null);
    await loadB;

    const state = get(store);
    expect(state.pubkey).toBe(B);
    expect(state.ids.has(NOTE)).toBe(false);
  });

  it('ensureSaved saves for B even though A had the note', async () => {
    const store = await freshStore();
    userPublickey.set(A);
    const loadA = store.load();
    userPublickey.set(B);

    const ensured = store.ensureSaved(NOTE);
    await answer(A, { ids: [NOTE], content: 'A-private-ciphertext' });
    await loadA;
    await answer(B, null);

    expect(await ensured).toBe(true);
    expect(h.published).toHaveLength(1);
    expect(h.published[0].pubkey).toBe(B);
    expect(h.published[0].tags).toContainEqual(['e', NOTE]);
    // Nothing of A's relay copy rides along under B.
    expect(h.published[0].content).toBe('');
  });

  it('ensureSaved never unsaves a note the account already has', async () => {
    const store = await freshStore();
    userPublickey.set(B);
    const ensured = store.ensureSaved(NOTE);
    await answer(B, { ids: [NOTE] });

    expect(await ensured).toBe(true);
    expect(h.published).toHaveLength(0);
    expect(get(store).ids.has(NOTE)).toBe(true);
  });

  it("keeps the account's own relay copy when publishing", async () => {
    const store = await freshStore();
    userPublickey.set(B);
    const toggled = store.toggle(NOTE);
    await answer(B, { ids: [], content: 'B-private-ciphertext' });

    expect(await toggled).toBe(true);
    expect(h.published[0].content).toBe('B-private-ciphertext');
  });
});
