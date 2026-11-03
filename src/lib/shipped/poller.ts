/**
 * Live updates for /pow: poll /api/pow/head while the tab is visible, and
 * when the data version moves, fetch /api/pow?v=<version> and hand it to
 * the page only if the body really is that version.
 *
 * - Every intervalMs while visible; paused while hidden; one poll right
 *   away when the tab becomes visible again.
 * - Versions come from response BODIES (head.etag, payload.dataVersion),
 *   never headers: the edge may weaken an ETag to W/"…".
 * - A ?v= fetch whose body isn't version v is discarded unrendered, and
 *   the next head poll tries again. KV reads can lag a write by up to a
 *   minute in other locations, so this does happen.
 * - If-None-Match carries the version on screen, so an unchanged head is a
 *   bodiless 304.
 *
 * Dependencies are injected so the behaviour is unit-testable.
 */

import type { PowHeadPayload, PowPayload } from './types';

export interface PollerDoc {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', fn: () => void): void;
  removeEventListener(type: 'visibilitychange', fn: () => void): void;
}

export interface HeadPollerOptions {
  /** The data version currently rendered (payload.dataVersion). */
  version: string | null;
  onSummary: (summary: PowPayload) => void;
  fetchImpl?: typeof fetch;
  doc?: PollerDoc;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  intervalMs?: number;
  headUrl?: string;
  summaryUrl?: string;
}

export const POLL_INTERVAL_MS = 30_000;

const bare = (etag: string) => etag.replace(/^W\//, '').replace(/"/g, '');

export function createHeadPoller(opts: HeadPollerOptions) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const doc = opts.doc ?? document;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const intervalMs = opts.intervalMs ?? POLL_INTERVAL_MS;
  const headUrl = opts.headUrl ?? '/api/pow/head';
  const summaryUrl = opts.summaryUrl ?? '/api/pow';

  let version = opts.version;
  let timer: unknown = null;
  let inFlight = false;
  let stopped = true;

  const visible = () => doc.visibilityState === 'visible';

  function schedule() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (!stopped && visible()) timer = setTimer(poll, intervalMs);
  }

  async function poll(): Promise<void> {
    timer = null;
    if (stopped || !visible() || inFlight) return schedule();
    inFlight = true;
    try {
      const headRes = await fetchImpl(headUrl, {
        headers: version ? { 'If-None-Match': `"${version}"` } : {},
        cache: 'no-cache'
      });
      if (headRes.status !== 200) return; // 304 (nothing new), 503 (no data yet), …
      const head = (await headRes.json()) as PowHeadPayload;
      const next = bare(head.etag);
      if (!next || next === version) return;

      const res = await fetchImpl(`${summaryUrl}?v=${encodeURIComponent(next)}`);
      if (res.status !== 200) return;
      const summary = (await res.json()) as PowPayload;
      // Never render a version other than the one asked for; retry next poll.
      if (summary.dataVersion !== next) return;
      version = next;
      opts.onSummary(summary);
    } catch {
      // Offline or a bad response: try again next interval.
    } finally {
      inFlight = false;
      schedule();
    }
  }

  function onVisibility() {
    if (visible()) void poll();
    else schedule(); // clears the timer while hidden
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      doc.addEventListener('visibilitychange', onVisibility);
      schedule();
    },
    stop() {
      stopped = true;
      doc.removeEventListener('visibilitychange', onVisibility);
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    /** For tests and the page: poll now (no-op while hidden). */
    poll,
    get version() {
      return version;
    }
  };
}
