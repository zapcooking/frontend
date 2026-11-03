import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchProfilesForOg } from './profileBatchOg.server';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

type Frame = unknown[];
/** A relay script returns the frames to answer a REQ with (subId filled in). */
type Script = (filter: { authors: string[] }) => Frame[] | 'silent';

function stubWebSocket(scripts: Record<string, Script | 'error'>) {
  const opened: string[] = [];
  class FakeWS {
    onopen: (() => void) | null = null;
    onmessage: ((m: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;
    constructor(public url: string) {
      opened.push(url);
      queueMicrotask(() => (scripts[url] === 'error' ? this.onerror?.() : this.onopen?.()));
    }
    send(raw: string) {
      const [, subId, filter] = JSON.parse(raw);
      const script = scripts[this.url];
      if (typeof script !== 'function') return;
      const frames = script(filter);
      if (frames === 'silent') return;
      for (const f of frames) {
        const withSub = f.map((x) => (x === '__SUB__' ? subId : x));
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(withSub) }));
      }
    }
    close() {}
  }
  vi.stubGlobal('WebSocket', FakeWS);
  return opened;
}

const evt = (pubkey: string, name: string, created_at = 1): Frame => [
  'EVENT',
  '__SUB__',
  { pubkey, created_at, content: JSON.stringify({ display_name: name, picture: `https://x/${name}.png` }) }
];
const EOSE: Frame = ['EOSE', '__SUB__'];

afterEach(() => vi.unstubAllGlobals());

describe('fetchProfilesForOg', () => {
  it('merges profiles spread across relays, one socket per relay', async () => {
    const opened = stubWebSocket({
      'wss://r1': () => [evt(A, 'Alice'), EOSE],
      'wss://r2': () => [evt(B, 'Bob'), EOSE]
    });
    const out = await fetchProfilesForOg([A, B, A], 1000, ['wss://r1', 'wss://r2']);
    expect(out[A]).toEqual({ name: 'Alice', picture: 'https://x/Alice.png' });
    expect(out[B]?.name).toBe('Bob');
    expect(opened).toEqual(['wss://r1', 'wss://r2']); // deduped pubkeys, no per-pubkey sockets
  });

  it('keeps the newest kind:0 when relays disagree', async () => {
    stubWebSocket({
      'wss://r1': () => [evt(A, 'Old', 1), EOSE],
      'wss://r2': () => [evt(A, 'New', 9), EOSE]
    });
    const out = await fetchProfilesForOg([A], 1000, ['wss://r1', 'wss://r2']);
    expect(out[A]?.name).toBe('New');
  });

  it('returns what it has when one relay errors and another never answers', async () => {
    stubWebSocket({
      'wss://r1': () => [evt(A, 'Alice'), EOSE],
      'wss://r2': 'error',
      'wss://r3': () => 'silent'
    });
    const out = await fetchProfilesForOg([A, B], 50, ['wss://r1', 'wss://r2', 'wss://r3']);
    expect(out[A]?.name).toBe('Alice');
    expect(out[B]).toBeUndefined();
  });

  it('ignores events for pubkeys that were not requested and malformed profile JSON', async () => {
    stubWebSocket({
      'wss://r1': () => [
        evt('c'.repeat(64), 'Stranger'),
        ['EVENT', '__SUB__', { pubkey: A, created_at: 1, content: '{not json' }],
        EOSE
      ]
    });
    expect(await fetchProfilesForOg([A], 1000, ['wss://r1'])).toEqual({});
  });

  it('resolves empty without opening sockets when there is nothing to look up', async () => {
    const opened = stubWebSocket({});
    expect(await fetchProfilesForOg([], 1000)).toEqual({});
    expect(opened).toEqual([]);
  });
});
