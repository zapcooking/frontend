import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { get } from 'svelte/store';
import { FreshClient, FREE_WINDOW_SECONDS, type Filter, type RelayEvent } from './relay';
import { MemberLogin, type AuthTemplate, type SignedAuthEvent } from './memberLogin';

/**
 * Member login to the Fresh relay: lazy, members only, at most one prompt
 * per connection, a decline remembered for the session, and no loops.
 */

const NOW = 2_000_000_000;
const FLOOR = NOW - FREE_WINDOW_SECONDS;
const ME = 'a'.repeat(64);

function ev(id: string, created_at: number): RelayEvent {
  return { id, pubkey: ME, created_at, kind: 1, tags: [], content: id, sig: 's' };
}

/**
 * A relay with nostr-tools' auth semantics: the login promise is cached per
 * connection; a throwing signer leaves it pending forever; OK false rejects.
 * Past the floor it answers like feed.zap.cooking: members get history,
 * a logged-in non-member gets nothing (or `restricted:` in `closeReason`).
 */
class AuthFakeRelay {
  filters: Filter[] = [];
  connected = true;
  authCalls = 0;
  loggedIn = false;
  private authPromise: Promise<string> | null = null;
  constructor(
    private opts: {
      member?: boolean;
      okFalse?: boolean;
      noChallenge?: boolean;
      closeReason?: string;
      posts?: RelayEvent[];
    } = {}
  ) {}
  auth(sign: (t: AuthTemplate) => Promise<SignedAuthEvent>): Promise<string> {
    this.authCalls++;
    if (this.opts.noChallenge) return Promise.reject(new Error('no challenge'));
    if (this.authPromise) return this.authPromise;
    this.authPromise = new Promise(async (resolve, reject) => {
      try {
        const e = await sign({
          kind: 22242,
          created_at: NOW,
          tags: [
            ['relay', 'wss://feed.zap.cooking'],
            ['challenge', 'c']
          ],
          content: ''
        });
        expect(e.kind).toBe(22242);
        if (this.opts.okFalse) return reject(new Error('invalid: bad'));
        this.loggedIn = true;
        resolve('');
      } catch {
        // nostr-tools: console.warn and never settle
      }
    });
    return this.authPromise;
  }
  subscribe(
    filters: Filter[],
    p: { onevent?: (e: RelayEvent) => void; oneose?: () => void; onclose?: (r: string) => void }
  ) {
    const f = filters[0];
    this.filters.push(f);
    queueMicrotask(() => {
      const past = f.since === undefined && f.until !== undefined && f.until < FLOOR;
      if (past && this.loggedIn && this.opts.closeReason) return p.onclose?.(this.opts.closeReason);
      if (past && !this.loggedIn) return p.onclose?.('auth-required: members');
      const all = this.opts.posts ?? [ev('new', NOW - 60), ev('old', FLOOR - 86400 * 300)];
      const visible = all.filter(
        (e) =>
          (f.since === undefined || e.created_at >= f.since) &&
          (f.until === undefined || e.created_at <= f.until) &&
          (e.created_at >= FLOOR || (this.loggedIn && this.opts.member !== false))
      );
      for (const e of visible.slice(0, f.limit ?? 500)) p.onevent?.(e);
      p.oneose?.();
    });
    return { close: () => {} };
  }
  close() {
    this.connected = false;
  }
}

function setup(
  o: {
    pubkey?: string;
    isMember?: boolean;
    sign?: (t: AuthTemplate) => Promise<SignedAuthEvent>;
    relays?: AuthFakeRelay[];
    timeoutMs?: number;
  } = {}
) {
  let pubkey = o.pubkey ?? ME;
  const sign = vi.fn(
    o.sign ?? (async (t: AuthTemplate) => ({ ...t, id: 'i', pubkey, sig: 's' }) as SignedAuthEvent)
  );
  const login = new MemberLogin({
    pubkey: () => pubkey,
    isMember: () => o.isMember ?? true,
    sign,
    timeoutMs: o.timeoutMs ?? 50
  });
  const relays = o.relays ?? [new AuthFakeRelay(), new AuthFakeRelay(), new AuthFakeRelay()];
  let n = 0;
  const connect = vi.fn(async () => relays[n++] as any);
  const client = new FreshClient({ connect, now: () => NOW, login, timeoutMs: 1000 });
  return { login, client, sign, relays, connect, setPubkey: (p: string) => (pubkey = p) };
}

describe('lazy: only a member past the floor is asked', () => {
  it('reading the last 14 days never prompts', async () => {
    const { client, sign } = setup();
    const r = await client.page();
    expect(r.events.map((e) => e.id)).toEqual(['new']);
    expect(sign).not.toHaveBeenCalled();
  });

  it('signed out: no prompt, the floor ends the feed', async () => {
    const { client, sign, relays } = setup({ pubkey: '' });
    const r = await client.page(FLOOR - 1);
    expect(r).toMatchObject({ state: 'ok', end: 'floor', events: [] });
    expect(sign).not.toHaveBeenCalled();
    expect(relays[0].filters).toHaveLength(0);
  });

  it('a signed-in non-member: no prompt, no past-floor request', async () => {
    const { client, sign, relays } = setup({ isMember: false });
    const r = await client.page(FLOOR - 1);
    expect(r.end).toBe('floor');
    expect(sign).not.toHaveBeenCalled();
    expect(relays[0].filters).toHaveLength(0);
  });

  it('a member past the floor logs in once, then pages history without asking again', async () => {
    const posts = Array.from({ length: 5 }, (_, i) => ev(`h${i}`, FLOOR - 86400 * (i + 1)));
    const relay = new AuthFakeRelay({ posts });
    const { client, sign, login } = setup({ relays: [relay] });
    const p1 = await client.page(FLOOR - 1, 2);
    expect(p1.events.map((e) => e.id)).toEqual(['h0', 'h1']);
    expect(relay.filters[0].since).toBeUndefined();
    const p2 = await client.page(p1.nextUntil, 2);
    // `until` is inclusive: h1 comes back and is skipped as already shown.
    expect(p2.events.map((e) => e.id)).toEqual(['h2']);
    expect(p2.end).toBe('more');
    expect(sign).toHaveBeenCalledTimes(1);
    expect(get(login.state)).toBe('authed');
  });

  it('two depth requests at once share one prompt', async () => {
    const { client, sign } = setup();
    await Promise.all([client.page(FLOOR - 1), client.page(FLOOR - 100)]);
    expect(sign).toHaveBeenCalledTimes(1);
  });
});

describe('decline: remembered for the session, button only', () => {
  it('a declined prompt is not asked again automatically', async () => {
    const { client, sign, login, relays } = setup({
      sign: async () => {
        throw new Error('user rejected');
      }
    });
    const r = await client.page(FLOOR - 1);
    expect(r).toMatchObject({ state: 'ok', end: 'floor' });
    expect(get(login.state)).toBe('declined');
    expect(relays[0].connected).toBe(false); // nostr-tools' stuck login is dropped with it
    for (let i = 0; i < 3; i++) await client.page(FLOOR - 1);
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it('a signer that never answers (Alby on a rejected origin) counts as declined after the timeout', async () => {
    const { client, login, sign } = setup({ sign: () => new Promise(() => {}), timeoutMs: 20 });
    const r = await client.page(FLOOR - 1);
    expect(r.end).toBe('floor');
    expect(get(login.state)).toBe('declined');
    await client.page(FLOOR - 1);
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it('"Log in to the feed" asks again once, on a fresh connection', async () => {
    let refuse = true;
    const { client, sign, login, relays } = setup({
      sign: async (t) => {
        if (refuse) throw new Error('no');
        return { ...t, id: 'i', pubkey: ME, sig: 's' };
      }
    });
    await client.page(FLOOR - 1);
    refuse = false;
    const relay = await client.connection();
    expect(relay).toBe(relays[1]);
    expect(await login.access(relay, true)).toBe(true);
    expect(sign).toHaveBeenCalledTimes(2);
    const r = await client.page(FLOOR - 1);
    expect(r.events.map((e) => e.id)).toEqual(['old']);
    expect(sign).toHaveBeenCalledTimes(2);
  });

  it('a login the relay refuses (OK false) is treated like a decline, not retried', async () => {
    const relay = new AuthFakeRelay({ okFalse: true });
    const { client, sign, login } = setup({ relays: [relay, new AuthFakeRelay()] });
    await client.page(FLOOR - 1);
    await client.page(FLOOR - 1);
    expect(sign).toHaveBeenCalledTimes(1);
    expect(get(login.state)).toBe('declined');
  });

  it('no challenge from the relay: no prompt, no loop', async () => {
    const relay = new AuthFakeRelay({ noChallenge: true });
    const { client, sign, login } = setup({ relays: [relay, new AuthFakeRelay()] });
    expect((await client.page(FLOOR - 1)).end).toBe('floor');
    await client.page(FLOOR - 1);
    expect(sign).not.toHaveBeenCalled();
    expect(relay.authCalls).toBe(1);
    expect(get(login.state)).toBe('declined');
  });
});

describe('not a member after all: stop, never retry', () => {
  it('an empty first page of history after login means not a member', async () => {
    const relay = new AuthFakeRelay({ member: false });
    const { client, login, sign } = setup({ relays: [relay] });
    const r = await client.page(FLOOR - 1);
    expect(r.state).toBe('restricted');
    expect(get(login.state)).toBe('not-member');
    const before = relay.filters.length;
    expect((await client.page(FLOOR - 1)).end).toBe('floor');
    expect(relay.filters.length).toBe(before);
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it('a restricted: close after login means not a member', async () => {
    const relay = new AuthFakeRelay({ closeReason: 'restricted: members only' });
    const { client, login, sign } = setup({ relays: [relay] });
    expect((await client.page(FLOOR - 1)).state).toBe('restricted');
    expect(get(login.state)).toBe('not-member');
    await client.page(FLOOR - 1);
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it('the end of real history is not mistaken for "not a member"', async () => {
    const posts = [ev('h0', FLOOR - 86400)];
    const relay = new AuthFakeRelay({ posts });
    const { client, login } = setup({ relays: [relay] });
    const p1 = await client.page(FLOOR - 1);
    const p2 = await client.page(p1.nextUntil! - 1);
    expect(p2).toMatchObject({ state: 'ok', end: 'exhausted' });
    expect(get(login.state)).toBe('authed');
  });
});

describe('connections and accounts', () => {
  it('a new connection needs a new login, asked only when depth is needed again', async () => {
    const { client, sign, relays } = setup();
    await client.page(FLOOR - 1);
    relays[0].close();
    await client.page();
    expect(sign).toHaveBeenCalledTimes(1);
    await client.page(FLOOR - 1);
    expect(sign).toHaveBeenCalledTimes(2);
  });

  it('switching accounts forgets the login and the decline', async () => {
    const { client, login, setPubkey } = setup({
      sign: async () => {
        throw new Error('no');
      }
    });
    await client.page(FLOOR - 1);
    expect(get(login.state)).toBe('declined');
    setPubkey('b'.repeat(64));
    expect(login.authed(await client.connection())).toBe(false);
    expect(get(login.state)).toBe('idle');
  });

  it('an account switch while the signer is open does not log the new account in', async () => {
    let release!: () => void;
    const { client, login, setPubkey } = setup({
      sign: (t) =>
        new Promise((res) => {
          release = () => res({ ...t, id: 'i', pubkey: ME, sig: 's' });
        }),
      timeoutMs: 1000
    });
    const p = client.page(FLOOR - 1);
    await new Promise((r) => setTimeout(r, 5));
    setPubkey('b'.repeat(64));
    release();
    expect((await p).end).toBe('floor');
    expect(login.authed(await client.connection())).toBe(false);
  });
});

describe('nothing stored or sent elsewhere', () => {
  const src = readFileSync(new URL('./memberLogin.ts', import.meta.url), 'utf8');
  it('imports only svelte/store and the relay types', () => {
    const imports = [...src.matchAll(/from\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['./relay', 'svelte/store']);
  });
  it('touches no storage or network API', () => {
    for (const api of [
      'localStorage',
      'sessionStorage',
      'indexedDB',
      'fetch(',
      'document.cookie',
      'sendBeacon'
    ])
      expect(src).not.toContain(api);
  });
});
