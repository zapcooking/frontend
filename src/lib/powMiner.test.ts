/**
 * Worker orchestration in powMiner: the cached worker has to survive normal
 * use and be dropped when it dies, or the mine after a failure waits on a
 * reply that is never coming.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { FakeWorker } = vi.hoisted(() => {
  class FakeWorker {
    static instances: FakeWorker[] = [];
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    terminated = false;
    posted: Array<Record<string, unknown>> = [];
    constructor() {
      FakeWorker.instances.push(this);
    }
    postMessage(msg: Record<string, unknown>) {
      this.posted.push(msg);
    }
    terminate() {
      this.terminated = true;
    }
  }
  return { FakeWorker };
});

vi.mock('./pow.worker?worker', () => ({ default: FakeWorker }));

const EVENT = { pubkey: 'a'.repeat(64), created_at: 0, kind: 1, tags: [], content: 'hi' };

/** Let minePow get past its dynamic import and construct the worker. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('minePow worker recovery', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.resetModules();
    (globalThis as { Worker?: unknown }).Worker = FakeWorker;
  });

  it('reuses one worker across mines', async () => {
    const { minePow } = await import('./powMiner');
    minePow(EVENT, 8);
    await settle();
    minePow(EVENT, 8);
    await settle();
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].posted).toHaveLength(2);
  });

  it('builds a fresh worker after the cached one errors', async () => {
    const { minePow } = await import('./powMiner');

    const first = minePow(EVENT, 8);
    await settle();
    const dead = FakeWorker.instances[0];
    dead.onerror?.();
    await expect(first).rejects.toThrow('Mining failed');
    expect(dead.terminated).toBe(true);

    // The regression: with the errored worker still cached, this call skipped
    // construction, posted into it, and hung forever.
    const second = minePow(EVENT, 8);
    await settle();
    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[1].posted).toHaveLength(1);

    // And the fresh worker still answers.
    const { id } = FakeWorker.instances[1].posted[0] as { id: number };
    FakeWorker.instances[1].onmessage?.({
      data: { id, ok: true, event: EVENT, attempts: 1, difficulty: 8 }
    });
    await expect(second).resolves.toMatchObject({ difficulty: 8 });
  });

  it('rejects every in-flight mine when the worker errors', async () => {
    const { minePow } = await import('./powMiner');
    const a = minePow(EVENT, 8);
    await settle();
    const b = minePow(EVENT, 8);
    await settle();
    FakeWorker.instances[0].onerror?.();
    await expect(a).rejects.toThrow('Mining failed');
    await expect(b).rejects.toThrow('Mining failed');
  });
});
