import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prefetchFirstPage, takeFirstPage, resetFirstPageForTests } from './firstPage';
import type { FreshClient, PageResult, RelayEvent } from './relay';

const ev = (id: string): RelayEvent => ({
  id,
  pubkey: 'p',
  created_at: 1,
  kind: 1,
  tags: [],
  content: '',
  sig: 's'
});

/** A client whose first page streams `ids` one by one, then resolves. */
function fakeClient() {
  let push!: (e: RelayEvent) => void;
  let resolve!: (r: PageResult) => void;
  const client = {
    reset: vi.fn(),
    page: vi.fn((_u?: number, _l?: number, onEvent?: (e: RelayEvent) => void) => {
      push = (e) => onEvent?.(e);
      return new Promise<PageResult>((r) => (resolve = r));
    })
  } as unknown as FreshClient & { reset: ReturnType<typeof vi.fn>; page: ReturnType<typeof vi.fn> };
  return { client, push: (id: string) => push(ev(id)), resolve: (r: PageResult) => resolve(r) };
}

beforeEach(() => resetFirstPageForTests());

describe('first page prefetch', () => {
  it('the feed takes over the prefetched page: earlier events replayed, later ones streamed', async () => {
    const f = fakeClient();
    prefetchFirstPage(f.client);
    expect(f.client.reset).toHaveBeenCalledTimes(1);
    f.push('a');
    f.push('b');
    const seen: string[] = [];
    const { result, prefetched } = takeFirstPage(f.client, (e) => seen.push(e.id));
    expect(prefetched).toBe(true);
    expect(seen).toEqual(['a', 'b']);
    f.push('c');
    expect(seen).toEqual(['a', 'b', 'c']);
    f.resolve({ state: 'ok', events: [ev('a'), ev('b'), ev('c')], end: 'more' });
    expect((await result).events).toHaveLength(3);
    expect(f.client.page).toHaveBeenCalledTimes(1); // one request, not two
  });

  it('is used once: the next first page (a refresh) requests normally, after a reset', async () => {
    const f = fakeClient();
    prefetchFirstPage(f.client);
    takeFirstPage(f.client, () => {});
    const second = takeFirstPage(f.client, () => {});
    expect(second.prefetched).toBe(false);
    expect(f.client.page).toHaveBeenCalledTimes(2);
    expect(f.client.reset).toHaveBeenCalledTimes(2);
  });

  it('without a prefetch, a normal first page (reset, then request with streaming)', () => {
    const f = fakeClient();
    const got: string[] = [];
    const { prefetched } = takeFirstPage(f.client, (e) => got.push(e.id));
    expect(prefetched).toBe(false);
    expect(f.client.reset).toHaveBeenCalledTimes(1);
    f.push('x');
    expect(got).toEqual(['x']);
  });

  it('a second prefetch call does not start a second request', () => {
    const f = fakeClient();
    prefetchFirstPage(f.client);
    prefetchFirstPage(f.client);
    expect(f.client.page).toHaveBeenCalledTimes(1);
  });
});
