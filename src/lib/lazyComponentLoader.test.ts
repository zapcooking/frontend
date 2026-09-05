import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get, writable } from 'svelte/store';

/**
 * Lazy component loader — the state machine behind the on-demand longform
 * editor in +layout.svelte. These cover the failure paths the static
 * `longformLoadStarted` latch got wrong: a failed chunk import must be
 * retryable by the user, must never retry on its own, and must not lose
 * the draft the user opened.
 */

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$lib/nip37DraftService', () => ({
  publishArticleDraftDebounced: vi.fn(),
  publishArticleDraft: vi.fn(async () => true),
  deleteDraftRemote: vi.fn(async () => undefined),
  isDraftSyncAvailable: () => false,
  fetchRemoteDrafts: vi.fn(async () => [])
}));

import { createLazyLoader, bindLazyLoaderToOpenState } from './lazyComponentLoader';

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

/** Flush microtasks so promise callbacks inside the loader run. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const Component = { name: 'FakeEditor' };

function makeLoader() {
  const attempts: Deferred<{ default: typeof Component }>[] = [];
  const load = vi.fn(() => {
    const d = deferred<{ default: typeof Component }>();
    attempts.push(d);
    return d.promise;
  });
  const loader = createLazyLoader(load, { label: 'test' });
  return { loader, load, attempts };
}

describe('createLazyLoader', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it('starts idle and loads on request', async () => {
    const { loader, load, attempts } = makeLoader();
    expect(get(loader).status).toBe('idle');

    loader.request();
    expect(get(loader).status).toBe('loading');
    expect(load).toHaveBeenCalledTimes(1);

    attempts[0].resolve({ default: Component });
    await flush();
    expect(get(loader)).toMatchObject({ status: 'loaded', component: Component, error: null });
  });

  it('surfaces an initial failure and recovers on a user-triggered retry', async () => {
    const { loader, load, attempts } = makeLoader();
    const err = new Error('Failed to fetch dynamically imported module');

    loader.request();
    attempts[0].reject(err);
    await flush();

    expect(get(loader)).toMatchObject({ status: 'failed', error: err, component: null });
    expect(warn).toHaveBeenCalledTimes(1);
    // No automatic second attempt.
    expect(load).toHaveBeenCalledTimes(1);

    // The session's one recovery reload is a separate mechanism; from the
    // loader's point of view the retry is simply a fresh import call.
    loader.retry();
    expect(get(loader).status).toBe('loading');
    expect(load).toHaveBeenCalledTimes(2);

    attempts[1].resolve({ default: Component });
    await flush();
    expect(get(loader)).toMatchObject({ status: 'loaded', component: Component, error: null });
  });

  it('repeated failures never retry on their own', async () => {
    const { loader, load, attempts } = makeLoader();

    loader.request();
    attempts[0].reject(new Error('boom 1'));
    await flush();
    expect(get(loader).status).toBe('failed');

    // Further requests while failed (e.g. reactive re-runs) do nothing.
    loader.request();
    loader.request();
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(get(loader).status).toBe('failed');

    // Only an explicit retry starts another attempt, and it can fail again
    // without spiralling.
    loader.retry();
    attempts[1].reject(new Error('boom 2'));
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(get(loader)).toMatchObject({ status: 'failed', attempts: 2 });
    expect((get(loader).error as Error).message).toBe('boom 2');

    // While an attempt is in flight, retry() is ignored.
    loader.retry(); // starts #3
    loader.retry(); // in flight: ignored
    expect(load).toHaveBeenCalledTimes(3);
    attempts[2].reject(new Error('boom 3'));
    await flush();
    expect(get(loader)).toMatchObject({ status: 'failed', attempts: 3 });
  });

  it('closing after a failure clears the error and reopening attempts again', async () => {
    const { loader, load, attempts } = makeLoader();

    loader.request();
    attempts[0].reject(new Error('boom'));
    await flush();
    expect(get(loader).status).toBe('failed');

    loader.release();
    expect(get(loader)).toMatchObject({ status: 'idle', error: null });
    expect(load).toHaveBeenCalledTimes(1);

    loader.request();
    expect(load).toHaveBeenCalledTimes(2);
    attempts[1].resolve({ default: Component });
    await flush();
    expect(get(loader).status).toBe('loaded');
  });

  it('closing while loading keeps a later success without surfacing anything, and drops a later failure', async () => {
    const { loader, load, attempts } = makeLoader();

    // Success after close: component retained for the next open.
    loader.request();
    loader.release();
    expect(get(loader).status).toBe('loading');
    attempts[0].resolve({ default: Component });
    await flush();
    expect(get(loader)).toMatchObject({ status: 'loaded', component: Component });

    // Failure after close: no error is surfaced for a closed editor.
    const second = makeLoader();
    second.loader.request();
    second.loader.release();
    second.attempts[0].reject(new Error('boom'));
    await flush();
    expect(get(second.loader)).toMatchObject({ status: 'idle', error: null });
    expect(second.load).toHaveBeenCalledTimes(1);

    // Reopening after that starts a fresh attempt.
    second.loader.request();
    expect(second.load).toHaveBeenCalledTimes(2);
  });

  it('rapid repeated requests share a single in-flight import', async () => {
    const { loader, load, attempts } = makeLoader();

    for (let i = 0; i < 10; i++) loader.request();
    loader.release();
    loader.request();
    loader.retry();
    expect(load).toHaveBeenCalledTimes(1);
    expect(get(loader).attempts).toBe(1);

    attempts[0].resolve({ default: Component });
    await flush();
    expect(get(loader).status).toBe('loaded');

    // Once loaded, nothing ever imports again.
    loader.release();
    loader.request();
    loader.retry();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('is inert when disabled (SSR)', () => {
    const { loader, load } = makeLoader();
    const ssr = createLazyLoader(load, { enabled: false });
    ssr.request();
    ssr.retry();
    expect(load).not.toHaveBeenCalled();
    expect(get(ssr).status).toBe('idle');
    expect(get(loader).status).toBe('idle');
  });

  it('routes a synchronous throw from the import function into the failed state', async () => {
    const load = vi.fn(() => {
      throw new Error('sync boom');
    });
    const loader = createLazyLoader(load as unknown as () => Promise<{ default: unknown }>);
    loader.request();
    await flush();
    expect(get(loader).status).toBe('failed');
    expect((get(loader).error as Error).message).toBe('sync boom');
  });
});

describe('bindLazyLoaderToOpenState', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests while open and releases when closed', async () => {
    const { loader, load, attempts } = makeLoader();
    const open = writable(false);
    const unbind = bindLazyLoaderToOpenState(loader, open);
    expect(load).not.toHaveBeenCalled();

    open.set(true);
    expect(load).toHaveBeenCalledTimes(1);

    attempts[0].reject(new Error('boom'));
    await flush();
    expect(get(loader).status).toBe('failed');

    open.set(false);
    expect(get(loader).status).toBe('idle');

    open.set(true);
    expect(load).toHaveBeenCalledTimes(2);

    unbind();
    open.set(false);
    open.set(true);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('longform editor: draft preservation across failure and retry', () => {
  // articleDraftStore persists to localStorage when `browser` is true.
  const storage = new Map<string, string>();
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
      clear: () => storage.clear()
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('retry keeps the selected draft, and reopening reuses the loaded component', async () => {
    const store = await import('../components/reads/articleDraftStore');
    store.drafts.set([]);
    store.currentDraftId.set(null);
    store.longformEditorOpen.set(false);

    const { loader, load, attempts } = makeLoader();
    const unbind = bindLazyLoaderToOpenState(loader, store.longformEditorOpen);

    // User opens a new draft: one draft exists and is selected; the chunk
    // import starts.
    store.openNewDraft();
    const draftId = get(store.currentDraftId);
    expect(draftId).toBeTruthy();
    expect(get(store.drafts)).toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(1);

    // The chunk fails; the editor stays open with the same draft selected.
    attempts[0].reject(new Error('boom'));
    await flush();
    expect(get(loader).status).toBe('failed');
    expect(get(store.longformEditorOpen)).toBe(true);
    expect(get(store.currentDraftId)).toBe(draftId);

    // Retry only re-imports: no new draft, same selection.
    loader.retry();
    expect(load).toHaveBeenCalledTimes(2);
    attempts[1].resolve({ default: Component });
    await flush();
    expect(get(loader).component).toBe(Component);
    expect(get(store.currentDraftId)).toBe(draftId);
    expect(get(store.drafts)).toHaveLength(1);
    expect(get(store.drafts)[0].id).toBe(draftId);

    // Close and reopen the same draft: no further import, same component.
    store.closeEditor();
    expect(get(store.currentDraftId)).toBe(draftId);
    store.openDraft(draftId!);
    expect(get(store.longformEditorOpen)).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
    expect(get(loader).component).toBe(Component);

    unbind();
  });

  it('closing while the chunk is loading leaves the editor closed when it resolves', async () => {
    const store = await import('../components/reads/articleDraftStore');
    store.drafts.set([]);
    store.currentDraftId.set(null);
    store.longformEditorOpen.set(false);

    const { loader, attempts } = makeLoader();
    const unbind = bindLazyLoaderToOpenState(loader, store.longformEditorOpen);

    store.openNewDraft();
    const draftId = get(store.currentDraftId);
    store.closeEditor();
    expect(get(store.longformEditorOpen)).toBe(false);

    attempts[0].resolve({ default: Component });
    await flush();
    // Component retained, editor still closed, draft still selected for reopen.
    expect(get(loader).component).toBe(Component);
    expect(get(store.longformEditorOpen)).toBe(false);
    expect(get(store.currentDraftId)).toBe(draftId);

    unbind();
  });
});
