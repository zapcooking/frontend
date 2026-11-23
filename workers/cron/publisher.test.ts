/**
 * Unit tests for the raw-WebSocket publisher (workers/cron/publisher.ts).
 *
 * Each test scripts an exact inbound frame sequence against a fake
 * socket. The mandatory case is AUTH-then-OK — the sequence that
 * killed nostr-tools in the Workers runtime (its frame queue yields
 * via MessageChannel, undefined in workerd, so frame #2 was never
 * processed). The publisher must survive ANY frame noise and settle
 * only on the OK matching the published event's id.
 */
import { describe, it, expect } from 'vitest';
import { publishToRelay, publishEventRaw, type WebSocketLike } from './publisher';

const EVENT = { id: 'e'.repeat(64), kind: 1, content: 'scheduled', sig: 's'.repeat(128) };
const OTHER_ID = 'f'.repeat(64);
const AUTH_REASON = 'auth-required: please authenticate with NIP-42';

/**
 * Scripted fake socket. `script` frames are delivered (async, one
 * task apart — distinct WebSocket messages) after the publisher sends
 * its EVENT, mirroring real relay behavior.
 */
class FakeWS implements WebSocketLike {
  sent: string[] = [];
  closed: { code?: number; reason?: string } | null = null;
  private listeners = new Map<string, ((ev: any) => void)[]>();

  constructor(
    public url: string,
    private script: {
      framesOnSend?: unknown[];
      neverOpen?: boolean;
      errorOnOpen?: boolean;
      /** Delay before the first scripted frame (a slow relay). */
      replyDelayMs?: number;
    } = {}
  ) {
    if (!script.neverOpen) {
      setTimeout(() => {
        if (script.errorOnOpen) this.emit('error', { message: 'boom' });
        else this.emit('open', {});
      }, 0);
    }
  }

  addEventListener(type: string, fn: (ev: any) => void) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }

  emit(type: string, ev: any) {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }

  send(data: string) {
    this.sent.push(data);
    let delay = this.script.replyDelayMs ?? 0;
    for (const frame of this.script.framesOnSend ?? []) {
      setTimeout(() => this.emit('message', { data: typeof frame === 'string' ? frame : JSON.stringify(frame) }), ++delay);
    }
  }

  close(code?: number, reason?: string) {
    this.closed = { code, reason };
  }
}

function factoryFor(sockets: Record<string, FakeWS>) {
  return (url: string) => {
    if (!sockets[url]) throw new Error(`no fake socket scripted for ${url}`);
    return sockets[url];
  };
}

const okTrue = ['OK', EVENT.id, true, ''];
const okFalseAuth = ['OK', EVENT.id, false, AUTH_REASON];
const authFrame = ['AUTH', '25b1ca23eebb683f'];

describe('publishToRelay frame handling', () => {
  async function run(frames: unknown[], timeoutMs = 500) {
    const ws = new FakeWS('wss://r', { framesOnSend: frames });
    const result = publishToRelay('wss://r', EVENT, timeoutMs, () => ws);
    return { ws, result };
  }

  it('AUTH-then-OK: survives the exact sequence that broke nostr-tools in workerd', async () => {
    const { ws, result } = await run([authFrame, okTrue]);
    await expect(result).resolves.toBe('');
    expect(ws.sent).toEqual([`["EVENT",${JSON.stringify(EVENT)}]`]);
    expect(ws.closed?.code).toBe(1000);
  });

  it('OK as the first frame still resolves (the framing-luck case)', async () => {
    const { result } = await run([okTrue]);
    await expect(result).resolves.toBe('');
  });

  it('OK false rejects with the relay reason verbatim', async () => {
    const { ws, result } = await run([authFrame, okFalseAuth]);
    await expect(result).rejects.toThrow(AUTH_REASON);
    expect(ws.closed?.code).toBe(1000); // clean close on rejection path too
  });

  it('ignores unrelated frames interleaved before the matching OK', async () => {
    const { result } = await run([
      authFrame,
      ['EVENT', 'sub1', { id: OTHER_ID, kind: 1, content: 'noise' }],
      ['EOSE', 'sub1'],
      ['NOTICE', 'rate limit soon'],
      'this is not json {',
      ['OK', OTHER_ID, false, 'someone else got rejected'],
      42,
      okTrue
    ]);
    await expect(result).resolves.toBe('');
  });

  it('no OK at all → per-relay timeout with a descriptive error, socket closed', async () => {
    const ws = new FakeWS('wss://r', { framesOnSend: [authFrame] }); // AUTH only, OK never comes
    const result = publishToRelay('wss://r', EVENT, 60, () => ws);
    await expect(result).rejects.toThrow(/publish timed out awaiting OK/);
    expect(ws.closed).not.toBeNull();
  });

  it('connection that never opens times out rather than hanging', async () => {
    const ws = new FakeWS('wss://r', { neverOpen: true });
    const result = publishToRelay('wss://r', EVENT, 60, () => ws);
    await expect(result).rejects.toThrow(/publish timed out/);
  });

  it('connection error rejects promptly', async () => {
    const ws = new FakeWS('wss://r', { errorOnOpen: true });
    const result = publishToRelay('wss://r', EVENT, 500, () => ws);
    await expect(result).rejects.toThrow(/connection error/);
  });
});

describe('publishEventRaw across a relay set', () => {
  it('multi-relay partial success: 1 OK true + 1 OK false + 1 timeout = sent (returns 1)', async () => {
    const sockets = {
      'wss://a': new FakeWS('wss://a', { framesOnSend: [authFrame, okTrue] }),
      'wss://b': new FakeWS('wss://b', { framesOnSend: [okFalseAuth] }),
      'wss://c': new FakeWS('wss://c', { framesOnSend: [] }) // opens, never OKs
    };
    const okCount = await publishEventRaw(EVENT, ['wss://a', 'wss://b', 'wss://c'], {
      timeoutMs: 80,
      wsFactory: factoryFor(sockets)
    });
    expect(okCount).toBe(1);
    // Every socket closed regardless of outcome.
    expect(Object.values(sockets).every((s) => s.closed !== null)).toBe(true);
  });

  it('all relays fail → throws the FIRST relay’s verbatim reason (what sweep stores as last_error)', async () => {
    const sockets = {
      'wss://a': new FakeWS('wss://a', { framesOnSend: [authFrame, okFalseAuth] }),
      'wss://b': new FakeWS('wss://b', { framesOnSend: [] })
    };
    await expect(
      publishEventRaw(EVENT, ['wss://a', 'wss://b'], { timeoutMs: 80, wsFactory: factoryFor(sockets) })
    ).rejects.toThrow(AUTH_REASON);
  });

  it('all relays accept → count equals relay set size', async () => {
    const sockets = {
      'wss://a': new FakeWS('wss://a', { framesOnSend: [okTrue] }),
      'wss://b': new FakeWS('wss://b', { framesOnSend: [authFrame, okTrue] })
    };
    const okCount = await publishEventRaw(EVENT, ['wss://a', 'wss://b'], {
      timeoutMs: 200,
      wsFactory: factoryFor(sockets)
    });
    expect(okCount).toBe(2);
  });
});

describe('publishEventRaw early settle (opt-in)', () => {
  const okFalse = ['OK', EVENT.id, false, AUTH_REASON];
  const hang = (url: string) => new FakeWS(url, { framesOnSend: [] }); // opens, never OKs
  const allClosed = (sockets: Record<string, FakeWS>) =>
    Object.values(sockets).every((s) => s.closed !== null);

  async function timed<T>(fn: () => Promise<T>) {
    const start = Date.now();
    const settle = await fn().then(
      (value) => ({ value, error: undefined as Error | undefined }),
      (error: Error) => ({ value: undefined as T | undefined, error })
    );
    return { ...settle, elapsed: Date.now() - start };
  }

  it('defaults unchanged: with no options a silent relay is waited on for the full per-relay timeout', async () => {
    const sockets = {
      'wss://a': new FakeWS('wss://a', { framesOnSend: [okTrue] }),
      'wss://c': hang('wss://c')
    };
    const { value, elapsed } = await timed(() =>
      publishEventRaw(EVENT, ['wss://a', 'wss://c'], { timeoutMs: 150, wsFactory: factoryFor(sockets) })
    );
    expect(value).toBe(1);
    expect(elapsed).toBeGreaterThanOrEqual(140);
    expect(allClosed(sockets)).toBe(true);
  });

  it('grace: settles shortly after the first OK true instead of waiting out a silent relay', async () => {
    const sockets = {
      'wss://a': new FakeWS('wss://a', { framesOnSend: [okTrue] }),
      'wss://c': hang('wss://c')
    };
    const { value, elapsed } = await timed(() =>
      publishEventRaw(EVENT, ['wss://a', 'wss://c'], {
        timeoutMs: 2000,
        graceAfterFirstOkMs: 40,
        wsFactory: factoryFor(sockets)
      })
    );
    expect(value).toBe(1);
    expect(elapsed).toBeGreaterThanOrEqual(35);
    expect(elapsed).toBeLessThan(600);
    // The abandoned relay's socket is closed, not leaked.
    expect(sockets['wss://c'].closed).not.toBeNull();
    expect(allClosed(sockets)).toBe(true);
  });

  it('grace: a relay that answers inside the grace period is counted', async () => {
    const sockets = {
      'wss://a': new FakeWS('wss://a', { framesOnSend: [okTrue] }),
      'wss://b': new FakeWS('wss://b', { framesOnSend: [okTrue], replyDelayMs: 30 }),
      'wss://c': hang('wss://c')
    };
    const okCount = await publishEventRaw(EVENT, ['wss://a', 'wss://b', 'wss://c'], {
      timeoutMs: 2000,
      graceAfterFirstOkMs: 150,
      wsFactory: factoryFor(sockets)
    });
    expect(okCount).toBe(2);
  });

  it('grace: a relay that would answer after the grace period is abandoned and not counted', async () => {
    const sockets = {
      'wss://a': new FakeWS('wss://a', { framesOnSend: [okTrue] }),
      'wss://b': new FakeWS('wss://b', { framesOnSend: [okTrue], replyDelayMs: 300 })
    };
    const okCount = await publishEventRaw(EVENT, ['wss://a', 'wss://b'], {
      timeoutMs: 2000,
      graceAfterFirstOkMs: 30,
      wsFactory: factoryFor(sockets)
    });
    expect(okCount).toBe(1);
    expect(sockets['wss://b'].closed).not.toBeNull();
  });

  it('grace: when every relay settles first, it returns at once without waiting out the grace period', async () => {
    const sockets = {
      'wss://a': new FakeWS('wss://a', { framesOnSend: [okTrue] }),
      'wss://b': new FakeWS('wss://b', { framesOnSend: [okFalse] })
    };
    const { value, elapsed } = await timed(() =>
      publishEventRaw(EVENT, ['wss://a', 'wss://b'], {
        timeoutMs: 2000,
        graceAfterFirstOkMs: 1500,
        hardCapMs: 1800,
        wsFactory: factoryFor(sockets)
      })
    );
    expect(value).toBe(1);
    expect(elapsed).toBeLessThan(600);
  });

  it('grace: an OK false does not start the grace period', async () => {
    const sockets = {
      'wss://a': new FakeWS('wss://a', { framesOnSend: [okFalse] }),
      'wss://b': new FakeWS('wss://b', { framesOnSend: [okTrue], replyDelayMs: 120 })
    };
    const okCount = await publishEventRaw(EVENT, ['wss://a', 'wss://b'], {
      timeoutMs: 2000,
      graceAfterFirstOkMs: 20,
      wsFactory: factoryFor(sockets)
    });
    expect(okCount).toBe(1); // waited for b; a's rejection did not cut it short
  });

  it('hard cap: stops when nothing has answered, closes every socket, and throws', async () => {
    const sockets = { 'wss://a': hang('wss://a'), 'wss://b': new FakeWS('wss://b', { neverOpen: true }) };
    const { error, elapsed } = await timed(() =>
      publishEventRaw(EVENT, ['wss://a', 'wss://b'], {
        timeoutMs: 2000,
        graceAfterFirstOkMs: 20,
        hardCapMs: 50,
        wsFactory: factoryFor(sockets)
      })
    );
    expect(error?.message).toMatch(/no relay answered before the publish was abandoned \(2 pending\)/);
    expect(elapsed).toBeGreaterThanOrEqual(45);
    expect(elapsed).toBeLessThan(600);
    expect(allClosed(sockets)).toBe(true);
  });

  it('hard cap: the verbatim OK-false reason still surfaces, even behind a silent relay listed first', async () => {
    const sockets = {
      'wss://silent': hang('wss://silent'),
      'wss://b': new FakeWS('wss://b', { framesOnSend: [authFrame, okFalse] })
    };
    const { error } = await timed(() =>
      publishEventRaw(EVENT, ['wss://silent', 'wss://b'], {
        timeoutMs: 2000,
        hardCapMs: 60,
        wsFactory: factoryFor(sockets)
      })
    );
    expect(error?.message).toBe(AUTH_REASON);
    expect(allClosed(sockets)).toBe(true);
  });

  it('hard cap wins when it comes before the grace period ends', async () => {
    const sockets = {
      'wss://a': new FakeWS('wss://a', { framesOnSend: [okTrue] }),
      'wss://c': hang('wss://c')
    };
    const { value, elapsed } = await timed(() =>
      publishEventRaw(EVENT, ['wss://a', 'wss://c'], {
        timeoutMs: 2000,
        graceAfterFirstOkMs: 1500,
        hardCapMs: 50,
        wsFactory: factoryFor(sockets)
      })
    );
    expect(value).toBe(1);
    expect(elapsed).toBeLessThan(600);
    expect(allClosed(sockets)).toBe(true);
  });

  it('per-relay timeout still applies under a longer cap (all time out → first relay’s timeout reason)', async () => {
    const sockets = { 'wss://a': hang('wss://a'), 'wss://b': hang('wss://b') };
    await expect(
      publishEventRaw(EVENT, ['wss://a', 'wss://b'], {
        timeoutMs: 40,
        hardCapMs: 1500,
        wsFactory: factoryFor(sockets)
      })
    ).rejects.toThrow(/publish timed out awaiting OK \(wss:\/\/a\)/);
  });

  it('nonsense option values are ignored rather than settling instantly or never', async () => {
    const sockets = {
      'wss://a': new FakeWS('wss://a', { framesOnSend: [okTrue] }),
      'wss://b': new FakeWS('wss://b', { framesOnSend: [okTrue], replyDelayMs: 40 })
    };
    const okCount = await publishEventRaw(EVENT, ['wss://a', 'wss://b'], {
      timeoutMs: 500,
      graceAfterFirstOkMs: Number.NaN,
      hardCapMs: -1,
      wsFactory: factoryFor(sockets)
    });
    expect(okCount).toBe(2);
  });
});

describe('publishToRelay abort signal', () => {
  it('abort closes the socket and rejects; an already-aborted signal never opens one', async () => {
    const controller = new AbortController();
    const ws = new FakeWS('wss://r', { framesOnSend: [] });
    const pending = publishToRelay('wss://r', EVENT, 2000, () => ws, controller.signal);
    await new Promise((r) => setTimeout(r, 5));
    controller.abort();
    await expect(pending).rejects.toThrow(/abandoned before OK \(wss:\/\/r\)/);
    expect(ws.closed).not.toBeNull();

    let constructed = 0;
    await expect(
      publishToRelay('wss://r2', EVENT, 2000, () => (constructed++, ws), controller.signal)
    ).rejects.toThrow(/abandoned before OK/);
    expect(constructed).toBe(0);
  });
});
