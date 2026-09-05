import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get, writable } from 'svelte/store';

/**
 * Cheffy messenger lazy-loading — the wiring +layout.svelte uses:
 * a lazyComponentLoader instance driven by cheffyMessengerWanted
 * (route eligibility × $cheffyOpen), with the pending-ops pill as loading
 * feedback. Covers the review finding on #679 (import must respect
 * showCheffy) and the failed-import recovery paths.
 */

vi.mock('$app/environment', () => ({ browser: false }));
vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return { ndk: writable(null), userPublickey: writable('') };
});
vi.mock('$lib/nip98', () => ({ signNip98AuthHeader: vi.fn() }));
vi.mock('$lib/photoAsk', () => ({
  askAboutPhoto: vi.fn(),
  fileToBase64: vi.fn(),
  isPhotoAskRetryable: () => false
}));

import { createLazyLoader, bindLazyLoaderToOpenState } from './lazyComponentLoader';
import { trackLoadingPendingOp } from './lazyLoadFeedback';
import { isCheffyRoute, cheffyMessengerWanted, CHEFFY_EXCLUDED_PREFIXES } from './cheffyRoutes';
import { pendingOps } from './stores/pendingOps';
import {
  cheffyOpen,
  openCheffy,
  closeCheffy,
  cheffyThread,
  cheffyDraft,
  cheffyExperienceMode,
  cheffyConversion,
  type ChatMessage
} from './stores/cheffyChat';

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const Messenger = { name: 'FakeCheffyMessenger' };
const pendingLabels = () => get(pendingOps).map((op) => op.label);

/** Mirrors the layout: loader + route×open gate + pending pill. */
function wire(initialPath: string) {
  const attempts: Deferred<{ default: typeof Messenger }>[] = [];
  const load = vi.fn(() => {
    const d = deferred<{ default: typeof Messenger }>();
    attempts.push(d);
    return d.promise;
  });
  const loader = createLazyLoader(load, { label: 'cheffy-test' });
  const pathname = writable(initialPath);
  const wanted = cheffyMessengerWanted(pathname, cheffyOpen);
  const cleanups = [
    bindLazyLoaderToOpenState(loader, wanted),
    trackLoadingPendingOp(loader, wanted, 'Loading Cheffy…')
  ];
  return {
    loader,
    load,
    attempts,
    pathname,
    wanted,
    /** What the layout's render gate sees: eligible route AND loaded. */
    renders: () => isCheffyRoute(get(pathname)) && get(loader).component !== null,
    /** What the layout's error-dialog gate sees. */
    showsError: () => get(wanted) && get(loader).status === 'failed',
    cleanup: () => cleanups.forEach((fn) => fn())
  };
}

describe('isCheffyRoute', () => {
  it('excludes the messaging, cheffy, zappy and auth surfaces and their subpaths', () => {
    for (const prefix of CHEFFY_EXCLUDED_PREFIXES) {
      expect(isCheffyRoute(prefix), prefix).toBe(false);
      expect(isCheffyRoute(`${prefix}/anything/deeper`), `${prefix}/…`).toBe(false);
    }
  });

  it('allows ordinary routes', () => {
    for (const path of ['/', '/explore', '/recipe/abc', '/my-kitchen/grocery/1', '/reads']) {
      expect(isCheffyRoute(path), path).toBe(true);
    }
  });
});

describe('Cheffy messenger lazy loading', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    cheffyOpen.set(false);
  });
  afterEach(() => {
    warn.mockRestore();
    cheffyOpen.set(false);
  });

  it('cheffyOpen=true on an excluded route starts no import and shows no pill', () => {
    const w = wire('/login');
    openCheffy();
    expect(get(cheffyOpen)).toBe(true);
    expect(w.load).not.toHaveBeenCalled();
    expect(get(w.wanted)).toBe(false);
    expect(pendingLabels()).toEqual([]);

    w.pathname.set('/onboarding/step-2');
    w.pathname.set('/cheffy');
    expect(w.load).not.toHaveBeenCalled();
    w.cleanup();
  });

  it('navigating to an eligible route while open starts the requested load', async () => {
    const w = wire('/login');
    openCheffy();
    expect(w.load).not.toHaveBeenCalled();

    w.pathname.set('/explore');
    expect(get(w.wanted)).toBe(true);
    expect(w.load).toHaveBeenCalledTimes(1);
    expect(pendingLabels()).toEqual(['Loading Cheffy…']);

    w.attempts[0].resolve({ default: Messenger });
    await flush();
    expect(w.renders()).toBe(true);
    expect(pendingLabels()).toEqual([]);
    w.cleanup();
  });

  it('navigating away while loading prevents late UI, then reuses the component', async () => {
    const w = wire('/explore');
    openCheffy();
    expect(w.load).toHaveBeenCalledTimes(1);
    expect(pendingLabels()).toEqual(['Loading Cheffy…']);

    w.pathname.set('/login');
    expect(get(w.wanted)).toBe(false);
    expect(pendingLabels()).toEqual([]);

    w.attempts[0].resolve({ default: Messenger });
    await flush();
    // Loaded and retained, but nothing renders on the excluded route.
    expect(get(w.loader).component).toBe(Messenger);
    expect(w.renders()).toBe(false);
    expect(w.showsError()).toBe(false);

    // Back on an eligible route: renders immediately with no new import.
    w.pathname.set('/');
    expect(w.renders()).toBe(true);
    expect(w.load).toHaveBeenCalledTimes(1);
    w.cleanup();
  });

  it('navigating away while loading also hides a late failure', async () => {
    const w = wire('/explore');
    openCheffy();
    w.pathname.set('/messages/abc');
    w.attempts[0].reject(new Error('boom'));
    await flush();
    expect(get(w.loader).status).toBe('idle');
    expect(w.showsError()).toBe(false);
    // Next eligible visit starts a fresh attempt.
    w.pathname.set('/explore');
    expect(w.load).toHaveBeenCalledTimes(2);
    w.cleanup();
  });

  it('first-load failure shows the error and an explicit retry recovers', async () => {
    const w = wire('/explore');
    openCheffy();
    w.attempts[0].reject(new Error('Failed to fetch dynamically imported module'));
    await flush();
    expect(w.showsError()).toBe(true);
    expect(pendingLabels()).toEqual([]);
    expect(get(cheffyOpen)).toBe(true);
    expect(w.load).toHaveBeenCalledTimes(1);

    w.loader.retry();
    expect(pendingLabels()).toEqual(['Loading Cheffy…']);
    expect(w.load).toHaveBeenCalledTimes(2);
    w.attempts[1].resolve({ default: Messenger });
    await flush();
    expect(w.renders()).toBe(true);
    expect(w.showsError()).toBe(false);
    expect(pendingLabels()).toEqual([]);
    w.cleanup();
  });

  it('repeated failures never retry on their own', async () => {
    const w = wire('/explore');
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    openCheffy();
    w.attempts[0].reject(new Error('boom 1'));
    await flush();

    // Store churn and re-navigation on the same eligible route don't retry.
    cheffyOpen.set(true);
    w.pathname.set('/explore');
    w.pathname.set('/recipe/x');
    await flush();
    expect(w.load).toHaveBeenCalledTimes(1);
    expect(w.showsError()).toBe(true);

    w.loader.retry();
    w.attempts[1].reject(new Error('boom 2'));
    await flush();
    expect(w.load).toHaveBeenCalledTimes(2);
    expect(w.showsError()).toBe(true);
    expect((get(w.loader).error as Error).message).toBe('boom 2');
    expect(reload).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    w.cleanup();
  });

  it('Close after a failure sets cheffyOpen=false; reopening attempts again', async () => {
    const w = wire('/explore');
    openCheffy();
    w.attempts[0].reject(new Error('boom'));
    await flush();
    expect(w.showsError()).toBe(true);

    closeCheffy(); // the dialog's Close action
    expect(get(cheffyOpen)).toBe(false);
    expect(get(w.loader).status).toBe('idle');
    expect(w.showsError()).toBe(false);
    expect(w.load).toHaveBeenCalledTimes(1);

    openCheffy();
    expect(w.load).toHaveBeenCalledTimes(2);
    w.attempts[1].resolve({ default: Messenger });
    await flush();
    expect(w.renders()).toBe(true);
    w.cleanup();
  });

  it('rapid repeated open/close produces one in-flight import', async () => {
    const w = wire('/explore');
    for (let i = 0; i < 8; i++) {
      openCheffy();
      closeCheffy();
    }
    openCheffy();
    expect(w.load).toHaveBeenCalledTimes(1);
    expect(get(w.loader).attempts).toBe(1);
    w.attempts[0].resolve({ default: Messenger });
    await flush();

    closeCheffy();
    openCheffy();
    expect(w.load).toHaveBeenCalledTimes(1);
    expect(w.renders()).toBe(true);
    w.cleanup();
  });

  it('conversation, composer draft and preview state survive a failed import', async () => {
    const thread: ChatMessage[] = [
      { id: 'm1', role: 'user', kind: 'text', content: 'What can I cook with eggs?' } as ChatMessage,
      { id: 'm2', role: 'cheffy', kind: 'text', content: 'Shakshuka!' } as ChatMessage
    ];
    cheffyThread.set(thread);
    cheffyDraft.set('and with spinach?');
    cheffyExperienceMode.set(true);
    cheffyConversion.set('response');

    const w = wire('/explore');
    openCheffy();
    w.attempts[0].reject(new Error('boom'));
    await flush();
    expect(w.showsError()).toBe(true);

    expect(get(cheffyThread)).toBe(thread);
    expect(get(cheffyDraft)).toBe('and with spinach?');
    expect(get(cheffyExperienceMode)).toBe(true);
    expect(get(cheffyConversion)).toBe('response');

    w.loader.retry();
    w.attempts[1].resolve({ default: Messenger });
    await flush();
    expect(w.renders()).toBe(true);
    expect(get(cheffyThread)).toBe(thread);
    expect(get(cheffyDraft)).toBe('and with spinach?');

    cheffyThread.set([]);
    cheffyDraft.set('');
    cheffyExperienceMode.set(false);
    cheffyConversion.set(null);
    w.cleanup();
  });

  it('cleanup removes subscriptions and any pending pill', () => {
    const w = wire('/explore');
    openCheffy();
    expect(pendingLabels()).toEqual(['Loading Cheffy…']);
    w.cleanup();
    expect(pendingLabels()).toEqual([]);
    closeCheffy();
    openCheffy();
    expect(w.load).toHaveBeenCalledTimes(1); // unbound: no further requests
  });
});
