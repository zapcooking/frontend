import { describe, it, expect, vi } from 'vitest';
/**
 * fetchMuteListStrict against NDK's EOSE timing: NDK fires `eose` once about
 * half the pool answered; a relay that has no copy answers fastest. The
 * list must still be found when it arrives shortly after that EOSE.
 */
vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return { ndk: writable(null), ensureNdkConnected: vi.fn() };
});
vi.mock('$lib/muteListStore', () => ({ muteListStore: { invalidate: vi.fn(), load: vi.fn() } }));
vi.mock('$lib/outboxPublish', () => ({ outboxRelaySet: vi.fn() }));
vi.mock('$lib/encryptionService', () => ({ encrypt: vi.fn(), decrypt: vi.fn(), detectEncryptionMethod: vi.fn() }));
vi.mock('$lib/eventFetch', () => ({ buildPoolRelaySet: () => ({ relays: new Set() }) }));
import { fetchMuteListStrict } from './muteToggle';

const ME = 'a'.repeat(64);
function fakeNdk(script: (emit: (ev: string, payload?: unknown) => void) => void) {
  const handlers: Record<string, ((p?: unknown) => void)[]> = {};
  const sub = {
    on: (ev: string, cb: (p?: unknown) => void) => void (handlers[ev] ??= []).push(cb),
    stop: vi.fn()
  };
  const emit = (ev: string, payload?: unknown) => handlers[ev]?.forEach((cb) => cb(payload));
  const ndk = { subscribe: vi.fn(() => { queueMicrotask(() => script(emit)); return sub; }) };
  return { ndk, sub };
}
const list = (created_at: number) => ({ pubkey: ME, kind: 10000, created_at, tags: [], content: '' });

describe('fetchMuteListStrict', () => {
  it('finds a list that arrives after an empty EOSE (within the grace)', async () => {
    const { ndk, sub } = fakeNdk((emit) => {
      emit('eose');
      setTimeout(() => emit('event', list(10)), 100);
    });
    const r = await fetchMuteListStrict(ndk as never, ME, { graceMs: 400 });
    expect(r.status).toBe('found');
    expect(sub.stop).toHaveBeenCalled();
  });

  it('an empty EOSE with nothing in the grace is a confirmed absence', async () => {
    const { ndk } = fakeNdk((emit) => emit('eose'));
    const r = await fetchMuteListStrict(ndk as never, ME, { graceMs: 50 });
    expect(r.status).toBe('absent');
  });

  it('keeps the newest copy when several relays answer', async () => {
    const { ndk } = fakeNdk((emit) => {
      emit('event', list(5));
      emit('event', list(9));
      emit('eose');
    });
    const r = await fetchMuteListStrict(ndk as never, ME, { graceMs: 50 });
    expect(r).toMatchObject({ status: 'found', event: { created_at: 9 } });
  });
});
