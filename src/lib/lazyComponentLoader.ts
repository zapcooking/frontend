/**
 * Lazy component loader
 *
 * Small Svelte 4-compatible state machine for loading a component chunk on
 * demand (e.g. a heavy modal that must stay out of the root layout's static
 * import graph). It distinguishes idle / loading / loaded / failed so the UI
 * can show feedback and offer a retry instead of latching on the first
 * failure.
 *
 * Rules:
 * - At most one import attempt is in flight at a time.
 * - `request()` starts an attempt only from `idle`. A failed attempt is never
 *   retried automatically; only `retry()` (an intentional user action) or a
 *   later `release()` + `request()` cycle (closing and reopening) starts
 *   another one, so a persistent failure can't turn into a retry loop.
 * - `release()` means the caller no longer wants the component right now. It
 *   clears a failure (so the next request attempts again) and ignores the
 *   error of an attempt that is still in flight. A successful in-flight
 *   attempt is retained either way, so a later request is instant.
 * - Once loaded, the component is kept for the lifetime of the loader.
 * - Browsers cache a failed module fetch for the life of the document
 *   (verified in Chrome: a plain re-import of the same URL rejects again
 *   without a network request). When the failure names the module URL, a
 *   retry therefore imports it through a cache-busting query instead, and
 *   re-appends stylesheets that failed to load (see retryFailedImport).
 */

import { writable, type Readable } from 'svelte/store';

export type LazyLoadStatus = 'idle' | 'loading' | 'loaded' | 'failed';

export interface LazyLoadState<T> {
  status: LazyLoadStatus;
  /** Set once an attempt succeeds; never cleared afterwards. */
  component: T | null;
  /** The rejection of the most recent attempt while `status === 'failed'`. */
  error: unknown;
  /** Number of import attempts started so far (diagnostics and tests). */
  attempts: number;
}

/**
 * Alternative import used for attempts that follow a failure. Return null
 * to fall back to the loader's normal `load`. Defaults to
 * `retryFailedImport`.
 */
export type RetryImport = (error: unknown, attempt: number) => Promise<unknown> | null;

export interface LazyLoaderOptions {
  /** When false (e.g. during SSR) every action is a no-op. Defaults to true. */
  enabled?: boolean;
  /** Tag used in the console warning logged when an attempt fails. */
  label?: string;
  /** Override or disable (null) the cache-busting retry strategy. */
  retryImport?: RetryImport | null;
}

/** Extract the module URL from a browser's dynamic-import failure message. */
export function failedModuleUrl(error: unknown): string | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  // Chrome: "Failed to fetch dynamically imported module: <url>"
  // Firefox: "error loading dynamically imported module: <url>"
  // Safari gives no URL ("Importing a module script failed.").
  const match = /dynamically imported module:?\s*(https?:\/\/[^\s'"()]+)/i.exec(message);
  return match ? match[1] : null;
}

/**
 * Re-append any stylesheet <link> that never produced a sheet (its fetch
 * failed), with a cache-busting query so the browser fetches it again.
 * Vite's preload helper adds a component chunk's CSS this way and never
 * retries it on its own.
 */
export function reloadFailedStylesheets(attempt: number, doc: Document | undefined = globalThis.document): number {
  if (!doc) return 0;
  let count = 0;
  for (const link of Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))) {
    if (link.sheet !== null || !link.href) continue;
    const retry = doc.createElement('link');
    retry.rel = 'stylesheet';
    retry.href = `${link.href}${link.href.includes('?') ? '&' : '?'}retry=${attempt}`;
    link.replaceWith(retry);
    count += 1;
  }
  return count;
}

/**
 * Default retry strategy: when `error` names the module that failed, import
 * it again under a unique query string so the browser's module map (which
 * remembers the failure) is bypassed. Returns null when the URL is unknown
 * so the loader falls back to the original import.
 */
export function retryFailedImport(
  error: unknown,
  attempt: number,
  importer: (url: string) => Promise<unknown> = (url) => import(/* @vite-ignore */ url)
): Promise<unknown> | null {
  const url = failedModuleUrl(error);
  if (!url) return null;
  reloadFailedStylesheets(attempt);
  return importer(`${url}${url.includes('?') ? '&' : '?'}retry=${attempt}`);
}

export interface LazyLoader<T> extends Readable<LazyLoadState<T>> {
  /** The UI wants the component now (e.g. the modal was opened). */
  request(): void;
  /** User-initiated retry after a failure. No-op in any other state. */
  retry(): void;
  /** The UI no longer wants the component (e.g. the modal was closed). */
  release(): void;
}

export function createLazyLoader<T>(
  load: () => Promise<{ default: T }>,
  options: LazyLoaderOptions = {}
): LazyLoader<T> {
  const { enabled = true, label = 'lazy-loader', retryImport = retryFailedImport } = options;

  let state: LazyLoadState<T> = { status: 'idle', component: null, error: null, attempts: 0 };
  const store = writable<LazyLoadState<T>>(state);
  const set = (patch: Partial<LazyLoadState<T>>) => {
    state = { ...state, ...patch };
    store.set(state);
  };

  // Whether the caller currently wants the component. Decides whether a
  // failure is surfaced (`failed`) or quietly dropped (`idle`).
  let wanted = false;
  // Most recent failure, kept across release() so a reopen after a failure
  // also goes through the cache-busting retry path.
  let lastFailure: unknown = null;

  function start(): void {
    if (state.status === 'loading' || state.status === 'loaded') return;
    const attempt = state.attempts + 1;
    set({ status: 'loading', error: null, attempts: attempt });

    // `new Promise` so a synchronous throw lands in the rejection path
    // instead of escaping to the caller.
    new Promise<unknown>((resolve) => {
      const retried = lastFailure !== null && retryImport ? retryImport(lastFailure, attempt) : null;
      resolve(retried ?? load());
    })
      .then((mod) => {
        // Vite's preload helper resolves with nothing when a
        // vite:preloadError listener calls preventDefault() (the recovery
        // reload path); never treat that as a loaded component.
        if (!mod || typeof mod !== 'object' || !('default' in mod)) {
          throw new Error('Lazy import resolved without a default export');
        }
        lastFailure = null;
        set({ status: 'loaded', component: (mod as { default: T }).default, error: null });
      })
      .catch((err: unknown) => {
        console.warn(`[${label}] Failed to load component chunk`, err);
        lastFailure = err;
        if (wanted) {
          set({ status: 'failed', error: err });
        } else {
          // Nobody is waiting on this attempt anymore; the next request
          // starts a fresh one.
          set({ status: 'idle', error: null });
        }
      });
  }

  return {
    subscribe: store.subscribe,
    request() {
      if (!enabled) return;
      wanted = true;
      if (state.status === 'idle') start();
    },
    retry() {
      if (!enabled) return;
      if (state.status === 'failed') start();
    },
    release() {
      wanted = false;
      if (state.status === 'failed') set({ status: 'idle', error: null });
    }
  };
}

/**
 * Drive a loader from a boolean "open" store: request while open, release
 * while closed. Returns the unsubscribe function.
 */
export function bindLazyLoaderToOpenState<T>(
  loader: LazyLoader<T>,
  open: Readable<boolean>
): () => void {
  return open.subscribe((isOpen) => {
    if (isOpen) loader.request();
    else loader.release();
  });
}
