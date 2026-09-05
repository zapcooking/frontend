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

export interface LazyLoaderOptions {
  /** When false (e.g. during SSR) every action is a no-op. Defaults to true. */
  enabled?: boolean;
  /** Tag used in the console warning logged when an attempt fails. */
  label?: string;
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
  const { enabled = true, label = 'lazy-loader' } = options;

  let state: LazyLoadState<T> = { status: 'idle', component: null, error: null, attempts: 0 };
  const store = writable<LazyLoadState<T>>(state);
  const set = (patch: Partial<LazyLoadState<T>>) => {
    state = { ...state, ...patch };
    store.set(state);
  };

  // Whether the caller currently wants the component. Decides whether a
  // failure is surfaced (`failed`) or quietly dropped (`idle`).
  let wanted = false;

  function start(): void {
    if (state.status === 'loading' || state.status === 'loaded') return;
    set({ status: 'loading', error: null, attempts: state.attempts + 1 });

    // `new Promise` so a synchronous throw from `load` lands in the
    // rejection path instead of escaping to the caller.
    new Promise<{ default: T }>((resolve) => resolve(load())).then(
      (mod) => {
        set({ status: 'loaded', component: mod.default, error: null });
      },
      (err: unknown) => {
        console.warn(`[${label}] Failed to load component chunk`, err);
        if (wanted) {
          set({ status: 'failed', error: err });
        } else {
          // Nobody is waiting on this attempt anymore; the next request
          // starts a fresh one.
          set({ status: 'idle', error: null });
        }
      }
    );
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
