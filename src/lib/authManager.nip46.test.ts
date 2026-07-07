import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { nip19 } from 'nostr-tools';

/**
 * NIP-46 bunker paste-login tests.
 *
 * Seam: `@nostr-dev-kit/ndk` is mocked so `NDKNip46Signer` exposes a
 * controllable `rpc` whose `sendRequest` we drive per-scenario. The real
 * `sendNip46Rpc` / `fetchNip46UserPubkey` helpers run unmocked against that
 * fake channel — the whole point is to exercise authManager's handshake
 * logic, not NDK's transport. `$app/environment` is mocked to `browser:true`
 * (the method early-returns otherwise). `localStorage` / `window` are stubbed
 * on globalThis because this repo has no jsdom/happy-dom test env.
 */

vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('@nostr-dev-kit/ndk', () => {
  const signers: any[] = [];
  const calls: any[] = [];
  let impl: (ctx: any) => void = () => {};

  class NDKPrivateKeySigner {
    privateKey: string;
    constructor(pk: string) {
      this.privateKey = pk;
    }
    static generate() {
      return new NDKPrivateKeySigner('00'.repeat(32));
    }
    async user() {
      return { pubkey: 'localpubkey' };
    }
  }

  class NDKNip46Signer {
    ndk: any;
    token?: string;
    remotePubkey: string;
    remoteUser: { pubkey: string };
    localSigner: any;
    authUrlHandlers: Array<(url: string) => void> = [];
    startListening: () => Promise<void>;
    rpc: any;
    constructor(ndk: any, token: string, localSigner: any) {
      this.ndk = ndk;
      const hasSecret = token.includes('#');
      this.remotePubkey = hasSecret ? token.split('#')[0] : token;
      this.token = hasSecret ? token.split('#')[1] : undefined;
      this.remoteUser = { pubkey: this.remotePubkey };
      this.localSigner = localSigner;
      this.startListening = vi.fn(async () => {});
      const self = this;
      this.rpc = {
        relaySet: undefined,
        on(ev: string, cb: (url: string) => void) {
          if (ev === 'authUrl') self.authUrlHandlers.push(cb);
        },
        sendRequest(remotePubkey: string, method: string, params: string[], kind: number, cb: any) {
          calls.push({ remotePubkey, method, params, kind });
          impl({ signer: self, remotePubkey, method, params, kind, cb });
        }
      };
      signers.push(self);
    }
    async user() {
      return this.remoteUser;
    }
  }

  class NDKRelaySet {
    urls: string[];
    ndk: any;
    constructor(urls: string[], ndk: any) {
      this.urls = urls;
      this.ndk = ndk;
    }
    static fromRelayUrls(urls: string[], ndk: any) {
      return new NDKRelaySet(urls, ndk);
    }
  }

  class NDKNip07Signer {}
  const NDKSubscriptionCacheUsage = { ONLY_RELAY: 'ONLY_RELAY', CACHE_FIRST: 'CACHE_FIRST' };

  return {
    NDKNip46Signer,
    NDKRelaySet,
    NDKPrivateKeySigner,
    NDKNip07Signer,
    NDKSubscriptionCacheUsage,
    __ndkTest: {
      calls,
      signers,
      setImpl: (f: (ctx: any) => void) => {
        impl = f;
      },
      reset: () => {
        impl = () => {};
        calls.length = 0;
        signers.length = 0;
      },
      lastSigner: () => signers[signers.length - 1]
    }
  };
});

// Imported after the mocks so authManager binds to the fakes.
import { AuthManager } from './authManager';
import * as NDK from '@nostr-dev-kit/ndk';

const ndkTest = (NDK as any).__ndkTest as {
  calls: any[];
  signers: any[];
  setImpl: (f: (ctx: any) => void) => void;
  reset: () => void;
  lastSigner: () => any;
};

const SIGNER = 'b2'.repeat(32);
const OTHER_SIGNER = 'c3'.repeat(32);
const USER_PUBKEY = 'a1'.repeat(32);
const SECRET = 'secret123';
const KNOWN_KEY = 'cd'.repeat(32);
const PENDING_KEY = 'nostrcooking_nip46_bunker_pending';
const RELAY = 'wss://relay.example.com';
const URI_WITH_SECRET = `bunker://${SIGNER}?relay=${RELAY}&secret=${SECRET}`;
const URI_NO_SECRET = `bunker://${SIGNER}?relay=${RELAY}`;

function makeNdk() {
  return {
    signer: null as any,
    activeUser: null as any,
    addExplicitRelay: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    getUser: ({ pubkey }: { pubkey: string }) => ({ pubkey })
  };
}

let store: Map<string, string>;
let authManager: AuthManager;
let ndk: ReturnType<typeof makeNdk>;

beforeEach(() => {
  store = new Map();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear()
  };
  (globalThis as any).window = { open: vi.fn(() => null) };
  ndkTest.reset();
  ndk = makeNdk();
  authManager = new AuthManager(ndk);
});

afterEach(() => {
  vi.useRealTimers();
});

// Respond ack to connect and a valid pubkey to get_public_key.
function happyImpl(pubkey = USER_PUBKEY) {
  return ({ method, cb }: any) => {
    if (method === 'connect') cb({ result: 'ack' });
    else if (method === 'get_public_key') cb({ result: pubkey });
  };
}

describe('parseNIP46ConnectionString', () => {
  it('parses bunker:// with a secret', () => {
    const r = authManager.parseNIP46ConnectionString(URI_WITH_SECRET);
    expect(r).toEqual({ signerPubkey: SIGNER, relays: [RELAY], secret: SECRET });
  });

  it('parses bunker:// without a secret', () => {
    const r = authManager.parseNIP46ConnectionString(URI_NO_SECRET);
    expect(r).toEqual({ signerPubkey: SIGNER, relays: [RELAY], secret: undefined });
  });

  it('parses multiple relay params', () => {
    const r = authManager.parseNIP46ConnectionString(
      `bunker://${SIGNER}?relay=wss://a.example&relay=wss://b.example`
    );
    expect(r.relays).toEqual(['wss://a.example', 'wss://b.example']);
  });

  it('decodes an npub in the bunker hostname', () => {
    const npub = nip19.npubEncode(SIGNER);
    const r = authManager.parseNIP46ConnectionString(`bunker://${npub}?relay=${RELAY}`);
    expect(r.signerPubkey).toBe(SIGNER);
  });

  it('parses a bare npub with relay hints', () => {
    const npub = nip19.npubEncode(SIGNER);
    const r = authManager.parseNIP46ConnectionString(`${npub} ${RELAY} wss://second.example`);
    expect(r.signerPubkey).toBe(SIGNER);
    expect(r.relays).toEqual([RELAY, 'wss://second.example']);
  });

  it('rejects nostrconnect:// URIs', () => {
    expect(() => authManager.parseNIP46ConnectionString('nostrconnect://abc?relay=wss://x')).toThrow(
      /nostrconnect/i
    );
  });

  it('rejects a bunker URI with no relay', () => {
    // The inner "No relay specified" message lacks the substring "Invalid",
    // so the parser's catch re-throws it as the generic format error. This
    // asserts the actual (pre-existing) surfaced message, not the inner one.
    expect(() => authManager.parseNIP46ConnectionString(`bunker://${SIGNER}`)).toThrow(
      /Invalid bunker connection string/i
    );
  });

  it('rejects malformed input', () => {
    expect(() => authManager.parseNIP46ConnectionString('not-a-connection-string')).toThrow();
  });
});

describe('connect handshake', () => {
  it('resolves on result: ack', async () => {
    ndkTest.setImpl(happyImpl());
    await authManager.authenticateWithNIP46(URI_WITH_SECRET);
    expect(authManager.getState().isAuthenticated).toBe(true);
    expect(authManager.getState().publicKey).toBe(USER_PUBKEY);
  });

  it('resolves when the signer echoes the secret', async () => {
    ndkTest.setImpl(({ method, cb }: any) => {
      if (method === 'connect') cb({ result: SECRET });
      else if (method === 'get_public_key') cb({ result: USER_PUBKEY });
    });
    await authManager.authenticateWithNIP46(URI_WITH_SECRET);
    expect(authManager.getState().isAuthenticated).toBe(true);
  });

  it('rejects an echoed value when no secret was sent (false-positive guard)', async () => {
    ndkTest.setImpl(({ method, cb }: any) => {
      // Without a secret, only 'ack' is success; an echo must not pass.
      if (method === 'connect') cb({ result: 'some-unexpected-value' });
      else if (method === 'get_public_key') cb({ result: USER_PUBKEY });
    });
    await expect(authManager.authenticateWithNIP46(URI_NO_SECRET)).rejects.toThrow(/single-use/i);
    expect(ndkTest.calls.some((c) => c.method === 'get_public_key')).toBe(false);
    expect(authManager.getState().isAuthenticated).toBe(false);
  });

  it('rejects with single-use guidance on a signer error', async () => {
    ndkTest.setImpl(({ method, cb }: any) => {
      if (method === 'connect') cb({ error: 'Not authorized' });
    });
    await expect(authManager.authenticateWithNIP46(URI_WITH_SECRET)).rejects.toThrow(
      /single-use.*Not authorized/is
    );
    expect(ndkTest.calls.some((c) => c.method === 'get_public_key')).toBe(false);
    // The abandoned signer must not linger on NDK once auth failed.
    expect(ndk.signer).toBeNull();
  });

  it('rejects with timeout guidance when no response arrives', async () => {
    vi.useFakeTimers();
    ndkTest.setImpl(() => {
      /* never responds */
    });
    const p = authManager.authenticateWithNIP46(URI_WITH_SECRET);
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(60000);
    await expect(p).rejects.toThrow(/didn't respond/i);
    expect(ndkTest.calls.some((c) => c.method === 'get_public_key')).toBe(false);
  });

  it('does not send get_public_key before connect succeeds (call order)', async () => {
    ndkTest.setImpl(happyImpl());
    await authManager.authenticateWithNIP46(URI_WITH_SECRET);
    const methods = ndkTest.calls.map((c) => c.method);
    expect(methods.indexOf('connect')).toBeLessThan(methods.indexOf('get_public_key'));
  });

  it('sends perms and the secret in connect param position 2', async () => {
    ndkTest.setImpl(happyImpl());
    await authManager.authenticateWithNIP46(URI_WITH_SECRET);
    const connectCall = ndkTest.calls.find((c) => c.method === 'connect');
    expect(connectCall.params[0]).toBe(SIGNER);
    expect(connectCall.params[1]).toBe(SECRET);
    expect(connectCall.params[2]).toContain('get_public_key');
    expect(connectCall.params[2]).toContain('nip44_encrypt');
  });

  it('sends an empty-string secret in position 2 when the URI has none', async () => {
    ndkTest.setImpl(happyImpl());
    await authManager.authenticateWithNIP46(URI_NO_SECRET);
    const connectCall = ndkTest.calls.find((c) => c.method === 'connect');
    expect(connectCall.params[1]).toBe('');
  });
});

describe('authUrl handling', () => {
  it('opens a window with the challenge URL when popups are allowed', async () => {
    (window as any).open = vi.fn(() => ({}) as any);
    ndkTest.setImpl(({ signer, method, cb }: any) => {
      if (method === 'connect') {
        signer.authUrlHandlers.forEach((h: any) => h('https://approve.example/allow'));
        cb({ result: 'ack' });
      } else if (method === 'get_public_key') {
        cb({ result: USER_PUBKEY });
      }
    });
    await authManager.authenticateWithNIP46(URI_WITH_SECRET);
    const openMock = (window as any).open as { mock: { calls: any[][] } };
    expect(openMock.mock.calls[0][0]).toBe('https://approve.example/allow');
    expect(openMock.mock.calls[0][1]).toBe('_blank');
    // Cleared on success.
    expect(authManager.getState().authChallengeUrl).toBeUndefined();
  });

  it('gives approval-pending guidance on timeout even when the popup opened', async () => {
    // Human-in-the-loop timing: the tab opened successfully but the user is
    // still approving when the 60s timer elapses. authUrlSeen is set at the
    // top of the handler (not gated on popup blocking), so this must still
    // surface "approval pending", not "check that your signer app is open".
    vi.useFakeTimers();
    (window as any).open = vi.fn(() => ({}) as any);
    ndkTest.setImpl(({ signer, method }: any) => {
      if (method === 'connect') {
        signer.authUrlHandlers.forEach((h: any) => h('https://approve.example/opened'));
        // No ack — user still approving in the opened tab.
      }
    });
    const p = authManager.authenticateWithNIP46(URI_WITH_SECRET);
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(60000);
    await expect(p).rejects.toThrow(/approval pending/i);
    // Popup opened, so the URL is not surfaced in state.
    expect(authManager.getState().authChallengeUrl).toBeUndefined();
  });

  it('ignores an auth challenge with a non-http(s) scheme (untrusted signer input)', async () => {
    vi.useFakeTimers();
    (window as any).open = vi.fn(() => null);
    ndkTest.setImpl(({ signer, method }: any) => {
      if (method === 'connect') {
        signer.authUrlHandlers.forEach((h: any) => h('javascript:alert(document.cookie)'));
        // No ack — falls through to timeout.
      }
    });
    const p = authManager.authenticateWithNIP46(URI_WITH_SECRET);
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(60000);
    // Never opened, never surfaced, and authUrlSeen stayed false so the
    // timeout is the plain "didn't respond" message, not "approval pending".
    expect(window.open).not.toHaveBeenCalled();
    expect(authManager.getState().authChallengeUrl).toBeUndefined();
    await expect(p).rejects.toThrow(/didn't respond/i);
  });

  it('surfaces the URL in state and gives approval-pending guidance when popup is blocked', async () => {
    vi.useFakeTimers();
    (window as any).open = vi.fn(() => null);
    ndkTest.setImpl(({ signer, method }: any) => {
      if (method === 'connect') {
        signer.authUrlHandlers.forEach((h: any) => h('https://approve.example/blocked'));
        // No ack — user must approve; original timer will elapse.
      }
    });
    const p = authManager.authenticateWithNIP46(URI_WITH_SECRET);
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(60000);
    await expect(p).rejects.toThrow(/approval pending/i);
    expect(authManager.getState().authChallengeUrl).toBe('https://approve.example/blocked');
  });
});

describe('ephemeral client key persistence', () => {
  it('reuses a stored key for the same signer within the window', async () => {
    store.set(
      PENDING_KEY,
      JSON.stringify({ signerPubkey: SIGNER, localPrivateKey: KNOWN_KEY, createdAt: Date.now() })
    );
    ndkTest.setImpl(({ method, cb }: any) => {
      if (method === 'connect') cb({ error: 'nope' }); // fail so pending is kept
    });
    await expect(authManager.authenticateWithNIP46(URI_WITH_SECRET)).rejects.toThrow();
    expect(ndkTest.lastSigner().localSigner.privateKey).toBe(KNOWN_KEY);
    // Not overwritten on reuse.
    expect(JSON.parse(store.get(PENDING_KEY)!).localPrivateKey).toBe(KNOWN_KEY);
  });

  it('generates a fresh key when the stored signer differs', async () => {
    store.set(
      PENDING_KEY,
      JSON.stringify({
        signerPubkey: OTHER_SIGNER,
        localPrivateKey: KNOWN_KEY,
        createdAt: Date.now()
      })
    );
    ndkTest.setImpl(({ method, cb }: any) => {
      if (method === 'connect') cb({ error: 'nope' });
    });
    await expect(authManager.authenticateWithNIP46(URI_WITH_SECRET)).rejects.toThrow();
    const used = ndkTest.lastSigner().localSigner.privateKey;
    expect(used).not.toBe(KNOWN_KEY);
    expect(/^[0-9a-f]{64}$/.test(used)).toBe(true);
    // Overwritten with the current signer + fresh key.
    const pending = JSON.parse(store.get(PENDING_KEY)!);
    expect(pending.signerPubkey).toBe(SIGNER);
    expect(pending.localPrivateKey).toBe(used);
  });

  it('generates a fresh key when the stored key is expired', async () => {
    store.set(
      PENDING_KEY,
      JSON.stringify({
        signerPubkey: SIGNER,
        localPrivateKey: KNOWN_KEY,
        createdAt: Date.now() - 16 * 60 * 1000
      })
    );
    ndkTest.setImpl(({ method, cb }: any) => {
      if (method === 'connect') cb({ error: 'nope' });
    });
    await expect(authManager.authenticateWithNIP46(URI_WITH_SECRET)).rejects.toThrow();
    expect(ndkTest.lastSigner().localSigner.privateKey).not.toBe(KNOWN_KEY);
  });

  it('clears the pending entry on successful auth', async () => {
    store.set(
      PENDING_KEY,
      JSON.stringify({ signerPubkey: SIGNER, localPrivateKey: KNOWN_KEY, createdAt: Date.now() })
    );
    ndkTest.setImpl(happyImpl());
    await authManager.authenticateWithNIP46(URI_WITH_SECRET);
    expect(store.get(PENDING_KEY)).toBeUndefined();
  });

  it('keeps the pending entry on connect failure (retry path)', async () => {
    ndkTest.setImpl(({ method, cb }: any) => {
      if (method === 'connect') cb({ error: 'nope' });
    });
    await expect(authManager.authenticateWithNIP46(URI_WITH_SECRET)).rejects.toThrow();
    expect(store.get(PENDING_KEY)).toBeDefined();
    const pending = JSON.parse(store.get(PENDING_KEY)!);
    expect(pending.signerPubkey).toBe(SIGNER);
  });
});
