// Read-modify-write of the user's own kind:0 (ownKind0) and the writers
// built on it, against a fake NDK whose relays are scripted one by one:
// what each holds, and whether it answers (EOSE), stays silent, sends
// CLOSED/NOTICE, or never connects.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('./nostr', async () => {
  const { writable } = await import('svelte/store');
  return { ndk: writable(null) };
});
vi.mock('./relayListCache', () => ({ getOutboxRelays: vi.fn(async () => outbox.urls) }));
vi.mock('./profileCache', () => ({ profileCacheManager: { invalidateProfile: vi.fn() } }));
vi.mock('./nip98', () => ({ signNip98AuthHeader: vi.fn() }));

const outbox = vi.hoisted(() => ({ urls: [] as string[] }));
const published = vi.hoisted(() => ({ events: [] as any[], args: [] as any[][], acceptedBy: 3, throws: false }));
const USER = vi.hoisted(() => 'a'.repeat(64));
/** Who the global ndk.signer is signed in as. */
const globalSigner = vi.hoisted(() => ({ pubkey: 'a'.repeat(64) }));

vi.mock('@nostr-dev-kit/ndk', async () => {
  const { getPublicKey } = await import('nostr-tools');
  return {
    NDKEvent: class NDKEvent {
      kind?: number;
      content = '';
      tags: string[][] = [];
      created_at?: number;
      pubkey = '';
      constructor(public ndk?: unknown) {}
      async sign(signer?: { pubkey: string }) {
        this.pubkey = signer ? signer.pubkey : globalSigner.pubkey;
      }
      async publish(...args: any[]) {
        published.events.push(this);
        published.args.push(args);
        if (published.throws) throw new Error('Not enough relays received the event');
        return new Set(Array.from({ length: published.acceptedBy }, (_, i) => ({ url: `r${i}` })));
      }
    },
    NDKPrivateKeySigner: class NDKPrivateKeySigner {
      pubkey: string;
      constructor(privateKey: Uint8Array) {
        this.pubkey = getPublicKey(privateKey);
      }
    },
    NDKRelaySet: class NDKRelaySet {
      constructor(
        public relays: Set<any>,
        _ndk: unknown
      ) {}
    },
    NDKRelayStatus: { CONNECTED: 5 },
    NDKSubscriptionCacheUsage: { ONLY_RELAY: 'ONLY_RELAY' }
  };
});

import {
  applyKind0Changes,
  changedFormFields,
  loadLatestKind0,
  updateOwnKind0,
  updateOwnPicture,
  publishNewAccountKind0,
  NEW_ACCOUNT_KIND0_TIMEOUT_MS,
  Kind0LoadError,
  KIND0_LOAD_TIMEOUT_MS,
  KIND0_WRONG_SIGNER_MESSAGE,
  PROFILE_FIELD_ALIASES
} from './ownKind0';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { clearProfileCache, onProfileCached } from './profileResolver';
import { updateProfileWithNip05 } from './nip05Service';
import { syncLightningAddressToProfile } from './spark/profileSync';

const PURPLEPAG = 'wss://purplepag.es';
const POOL = 'wss://pool.test';
const PRIMAL = 'wss://relay.primal.net';
const WINE = 'wss://nostr.wine';

type Reply = 'eose' | 'silent' | 'closed' | 'notice';
interface RelayScript {
  connected?: boolean; // default true
  events?: any[];
  reply?: Reply; // default 'eose'
}

function kind0(content: unknown, created_at: number, tags: string[][] = []) {
  return {
    kind: 0,
    pubkey: USER,
    created_at,
    tags,
    content: typeof content === 'string' ? content : JSON.stringify(content)
  };
}

/** Fake NDK: `scripts` per relay URL; unscripted relays answer EOSE, empty. */
function makeNdk(scripts: Record<string, RelayScript>, poolUrls: string[] = [POOL]) {
  const relays = new Map<string, any>();
  const getRelay = (url: string) => {
    if (!relays.has(url)) {
      const script = scripts[url] ?? {};
      const handlers = new Map<string, Set<(...a: any[]) => void>>();
      relays.set(url, {
        url,
        status: script.connected === false ? 1 : 5,
        on: (ev: string, fn: any) => handlers.set(ev, (handlers.get(ev) ?? new Set()).add(fn)),
        off: (ev: string, fn: any) => handlers.get(ev)?.delete(fn),
        once: () => {},
        emit: (ev: string) => handlers.get(ev)?.forEach((fn) => fn())
      });
    }
    return relays.get(url);
  };
  for (const url of poolUrls) getRelay(url);
  const subscribe = vi.fn((_filter: any, _opts: any, relaySet: any) => {
    const [relay] = [...relaySet.relays];
    const script: RelayScript = scripts[relay.url] ?? {};
    const handlers = new Map<string, ((...a: any[]) => void)[]>();
    let stopped = false;
    const fire = (ev: string, ...a: any[]) => {
      if (!stopped) for (const fn of handlers.get(ev) ?? []) fn(...a);
    };
    return {
      on: (ev: string, fn: (...a: any[]) => void) =>
        handlers.set(ev, [...(handlers.get(ev) ?? []), fn]),
      start: () =>
        queueMicrotask(() => {
          for (const e of script.events ?? []) fire('event', e);
          const reply = script.reply ?? 'eose';
          if (reply === 'eose') fire('eose');
          else if (reply === 'closed') fire('closed');
          else if (reply === 'notice') {
            relay.emit('notice');
            fire('eose');
          }
        }),
      stop: () => {
        stopped = true;
      }
    };
  });
  return { pool: { relays, getRelay }, subscribe, signer: {} } as any;
}

/** Run a promise to completion under fake timers. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  const result = promise.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error })
  );
  await vi.advanceTimersByTimeAsync(KIND0_LOAD_TIMEOUT_MS + 5000);
  const r = await result;
  if (!r.ok) throw r.error;
  return r.value;
}

const RICH = {
  name: 'cook',
  display_name: 'The Cook',
  picture: 'https://img.test/old.png',
  banner: 'https://img.test/banner.png',
  website: 'https://cook.test',
  noffer: 'noffer1xyz',
  lud06: 'lnurl1abc',
  bot: false,
  custom_field: { nested: [1, 2] }
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
  published.events = [];
  published.args = [];
  published.acceptedBy = 3;
  published.throws = false;
  globalSigner.pubkey = USER;
  outbox.urls = [];
  clearProfileCache();
});
afterEach(() => {
  vi.useRealTimers();
});

const lastContent = () => JSON.parse(published.events[published.events.length - 1].content);

describe('picture upload', () => {
  it('changes picture only: banner, website, noffer and unknown fields survive', async () => {
    const tags = [['i', 'github:cook', 'proof']];
    const ndk = makeNdk({ [PURPLEPAG]: { events: [kind0(RICH, 1000, tags)] } });

    await settle(updateOwnPicture(ndk, USER, 'https://img.test/new.png'));

    expect(published.events).toHaveLength(1);
    expect(lastContent()).toEqual({ ...RICH, picture: 'https://img.test/new.png' });
    expect(published.events[0].tags).toEqual(tags);
    expect(published.events[0].kind).toBe(0);
  });

  it('signs a created_at after the version it replaces, even with a slow clock', async () => {
    const future = Math.floor(Date.now() / 1000) + 600;
    const ndk = makeNdk({ [PURPLEPAG]: { events: [kind0(RICH, future)] } });
    await settle(updateOwnPicture(ndk, USER, 'https://img.test/new.png'));
    expect(published.events[0].created_at).toBe(future + 1);
  });
});

describe('refusals publish nothing', () => {
  it('timeout: nobody answers', async () => {
    const ndk = makeNdk({
      [PURPLEPAG]: { reply: 'silent' },
      [POOL]: { reply: 'silent' }
    });
    await expect(settle(updateOwnPicture(ndk, USER, 'x'))).rejects.toMatchObject({
      code: 'timeout'
    });
    expect(published.events).toHaveLength(0);
  });

  it('timeout: a profile arrived, but purplepag and another relay never answered', async () => {
    // The silent relays might hold a newer version: refuse rather than
    // republish an older one.
    const ndk = makeNdk({
      [PURPLEPAG]: { reply: 'silent' },
      [POOL]: { events: [kind0(RICH, 1000)] },
      [PRIMAL]: { reply: 'silent' }
    });
    await expect(settle(updateOwnPicture(ndk, USER, 'x'))).rejects.toBeInstanceOf(Kind0LoadError);
    expect(published.events).toHaveLength(0);
  });

  it('CLOSED and NOTICE are not answers', async () => {
    for (const reply of ['closed', 'notice'] as const) {
      published.events = [];
      const ndk = makeNdk({
        [PURPLEPAG]: { reply },
        [POOL]: { events: [kind0(RICH, 1000)] },
        [PRIMAL]: { reply: 'silent' }
      });
      await expect(settle(updateOwnPicture(ndk, USER, 'x'))).rejects.toMatchObject({
        code: 'timeout'
      });
      expect(published.events).toHaveLength(0);
    }
  });

  it('malformed content (not JSON, or JSON that is not an object)', async () => {
    for (const content of ['{"name": "cook",', '["name"]', '"cook"', 'null']) {
      published.events = [];
      const ndk = makeNdk({ [PURPLEPAG]: { events: [kind0(content, 1000)] } });
      await expect(settle(updateOwnPicture(ndk, USER, 'x'))).rejects.toMatchObject({
        code: 'malformed'
      });
      expect(published.events).toHaveLength(0);
    }
  });

  it('a malformed NEWEST version is refused even if an older one parses', async () => {
    const ndk = makeNdk({
      [PURPLEPAG]: { events: [kind0('{broken', 2000)] },
      [POOL]: { events: [kind0(RICH, 1000)] }
    });
    await expect(settle(updateOwnPicture(ndk, USER, 'x'))).rejects.toMatchObject({
      code: 'malformed'
    });
    expect(published.events).toHaveLength(0);
  });

  it('no relay connects', async () => {
    const off = { connected: false };
    const ndk = makeNdk({ [PURPLEPAG]: off, [POOL]: off, [PRIMAL]: off, [WINE]: off });
    await expect(settle(updateOwnPicture(ndk, USER, 'x'))).rejects.toMatchObject({
      code: 'no-relays'
    });
    expect(published.events).toHaveLength(0);
  });

  it('the refusal message tells the user nothing changed and to retry', async () => {
    const ndk = makeNdk({ [PURPLEPAG]: { reply: 'silent' }, [POOL]: { reply: 'silent' } });
    const err = await settle(updateOwnPicture(ndk, USER, 'x')).catch((e) => e);
    expect(err.message).toMatch(/nothing was changed/);
    expect(err.message).toMatch(/try again/i);
  });
});

describe('brand-new account (no kind:0 anywhere)', () => {
  it('confirmed empty — every connected relay, purplepag included, sent EOSE with nothing — may start from {}', async () => {
    const ndk = makeNdk({});
    await settle(updateOwnPicture(ndk, USER, 'https://img.test/new.png'));
    expect(lastContent()).toEqual({ picture: 'https://img.test/new.png' });
    expect(published.events[0].tags).toEqual([]);
  });

  it('empty but purplepag unreachable: refused', async () => {
    const ndk = makeNdk({ [PURPLEPAG]: { connected: false } });
    await expect(settle(updateOwnPicture(ndk, USER, 'x'))).rejects.toMatchObject({
      code: 'timeout'
    });
    expect(published.events).toHaveLength(0);
  });

  it('empty but one connected relay stayed silent: refused', async () => {
    const ndk = makeNdk({ [PRIMAL]: { reply: 'silent' } });
    await expect(settle(updateOwnPicture(ndk, USER, 'x'))).rejects.toMatchObject({
      code: 'timeout'
    });
    expect(published.events).toHaveLength(0);
  });
});

describe('which version is loaded', () => {
  it('newest created_at wins across relays', async () => {
    const older = { ...RICH, website: 'https://old.test' };
    const newer = { ...RICH, website: 'https://new.test', added_later: 'yes' };
    const ndk = makeNdk({
      [POOL]: { events: [kind0(newer, 3000)] },
      [PURPLEPAG]: { events: [kind0(older, 1000)] },
      [PRIMAL]: { events: [kind0(older, 2000)] }
    });
    const loaded = await settle(loadLatestKind0(ndk, USER));
    expect(loaded).toMatchObject({ status: 'found', content: newer });

    await settle(updateOwnPicture(ndk, USER, 'p'));
    expect(lastContent()).toEqual({ ...newer, picture: 'p' });
  });

  it("asks the user's NIP-65 write relays too", async () => {
    outbox.urls = ['wss://outbox.test'];
    const ndk = makeNdk({
      [PURPLEPAG]: { events: [kind0(RICH, 1000)] },
      'wss://outbox.test': { events: [kind0({ ...RICH, name: 'newest' }, 2000)] }
    });
    const loaded = await settle(loadLatestKind0(ndk, USER));
    expect(loaded).toMatchObject({ status: 'found', content: { name: 'newest' } });
  });

  it('found without purplepag when every connected relay answered', async () => {
    const ndk = makeNdk({
      [PURPLEPAG]: { connected: false },
      [POOL]: { events: [kind0(RICH, 1000)] }
    });
    const loaded = await settle(loadLatestKind0(ndk, USER));
    expect(loaded).toMatchObject({ status: 'found', content: RICH });
  });

  it('found when purplepag answered, even if another relay stayed silent', async () => {
    const ndk = makeNdk({
      [PURPLEPAG]: { events: [kind0(RICH, 1000)] },
      [PRIMAL]: { reply: 'silent' }
    });
    const loaded = await settle(loadLatestKind0(ndk, USER));
    expect(loaded).toMatchObject({ status: 'found', content: RICH });
  });
});

describe('after publishing', () => {
  it('the new event goes into the resolver cache: mounted names hear it', async () => {
    const heard: any[] = [];
    const stop = onProfileCached((pk, profile) => heard.push({ pk, profile }));
    const ndk = makeNdk({ [PURPLEPAG]: { events: [kind0(RICH, 1000)] } });

    await settle(updateOwnKind0(ndk, USER, { display_name: 'Renamed' }));
    stop();

    expect(heard).toHaveLength(1);
    expect(heard[0].pk).toBe(USER);
    expect(heard[0].profile).toMatchObject({
      display_name: 'Renamed',
      created_at: published.events[0].created_at
    });
  });

  it('no relay accepted: an error, and the cache is not touched', async () => {
    published.acceptedBy = 0;
    const heard: any[] = [];
    const stop = onProfileCached((pk) => heard.push(pk));
    const ndk = makeNdk({ [PURPLEPAG]: { events: [kind0(RICH, 1000)] } });

    await expect(settle(updateOwnPicture(ndk, USER, 'p'))).rejects.toThrow(/No relay accepted/);
    stop();
    expect(heard).toHaveLength(0);
  });
});

describe('applyKind0Changes / changedFormFields', () => {
  it('sets and removes only the named keys', () => {
    const out = applyKind0Changes(RICH, { picture: 'p', website: '', lud06: undefined });
    const { website: _w, lud06: _l, ...rest } = RICH;
    expect(out).toEqual({ ...rest, picture: 'p' });
    expect('website' in out).toBe(false);
    expect('lud06' in out).toBe(false);
    expect(RICH.website).toBe('https://cook.test'); // input not mutated
  });

  it('a form applies only the fields the user changed (trimmed)', () => {
    const initial = { name: 'cook', about: 'old bio', picture: 'stale.png', website: 'w' };
    const current = { name: 'cook ', about: 'new bio', picture: 'stale.png', website: '' };
    expect(changedFormFields(initial, current)).toEqual({ about: 'new bio', website: '' });
  });

  it('an untouched field shown from a stale copy does not revert a newer value', async () => {
    // The form opened with picture "stale.png"; the latest kind:0 has a
    // newer picture saved from another client. Editing `about` keeps it.
    const ndk = makeNdk({
      [PURPLEPAG]: { events: [kind0({ ...RICH, picture: 'newer.png' }, 1000)] }
    });
    const initial = { about: '', picture: 'stale.png' };
    const changes = changedFormFields(initial, { about: 'hello', picture: 'stale.png' });
    await settle(updateOwnKind0(ndk, USER, changes));
    expect(lastContent()).toEqual({ ...RICH, picture: 'newer.png', about: 'hello' });
  });
});

describe('edit dialog: clearing a field', () => {
  // The dialog's own path: changedFormFields(initial, current) → updateOwnKind0.
  const FORM = { display_name: 'The Cook', name: 'cook', about: '', website: 'https://cook.test' };
  const save = (ndk: any, current: Record<string, string>) =>
    settle(
      updateOwnKind0(
        ndk,
        USER,
        changedFormFields(FORM, { ...FORM, ...current }),
        PROFILE_FIELD_ALIASES
      )
    );

  it('an emptied website is removed from the published event; everything else survives', async () => {
    const ndk = makeNdk({ [PURPLEPAG]: { events: [kind0(RICH, 1000)] } });
    await save(ndk, { website: '' });
    const { website: _w, ...rest } = RICH;
    expect(published.events).toHaveLength(1);
    expect(lastContent()).toEqual(rest);
  });

  it('whitespace-only counts as cleared', async () => {
    const ndk = makeNdk({ [PURPLEPAG]: { events: [kind0(RICH, 1000)] } });
    await save(ndk, { website: '   ' });
    expect('website' in lastContent()).toBe(false);
  });

  it('a cleared field also leaves the aliases the dialog read it from', async () => {
    // displayName/image/bio are what some clients write instead of (or
    // beside) display_name/picture/about; left behind, they keep showing.
    const both = { ...RICH, displayName: 'The Cook', image: RICH.picture, bio: 'b' };
    const ndk = makeNdk({ [PURPLEPAG]: { events: [kind0(both, 1000)] } });
    await save(ndk, { display_name: '' });
    expect(lastContent()).not.toHaveProperty('display_name');
    expect(lastContent()).not.toHaveProperty('displayName');
    expect(lastContent()).toMatchObject({ image: RICH.picture, bio: 'b', name: 'cook' });
  });

  it('a renamed field updates the aliases present, and adds none', async () => {
    const ndk = makeNdk({
      [PURPLEPAG]: { events: [kind0({ ...RICH, displayName: 'The Cook' }, 1000)] }
    });
    await save(ndk, { display_name: 'Chef' });
    expect(lastContent()).toMatchObject({ display_name: 'Chef', displayName: 'Chef' });
    expect(lastContent()).not.toHaveProperty('image');
    expect(lastContent()).not.toHaveProperty('bio');
  });
  it('an alias the profile does not have is never added', async () => {
    const ndk = makeNdk({ [PURPLEPAG]: { events: [kind0(RICH, 1000)] } });
    await save(ndk, { display_name: 'Chef', about: 'new bio' });
    expect(lastContent()).toEqual({ ...RICH, display_name: 'Chef', about: 'new bio' });
  });
});

describe('signing account', () => {
  it('a profile update is refused when the signer is no longer the loaded account', async () => {
    globalSigner.pubkey = 'b'.repeat(64);
    const ndk = makeNdk({ [PURPLEPAG]: { events: [kind0(RICH, 1000)] } });
    await expect(settle(updateOwnKind0(ndk, USER, { about: 'x' }))).rejects.toThrow(
      KIND0_WRONG_SIGNER_MESSAGE
    );
    expect(published.events).toHaveLength(0);
  });

  it('signup: the new profile is signed by the generated key, not the global signer', async () => {
    // A stored session restoring late swapped the global signer back to an
    // existing account between sign-in and publish.
    globalSigner.pubkey = USER;
    const key = generateSecretKey();
    const heard: string[] = [];
    const stop = onProfileCached((pk) => heard.push(pk));

    await publishNewAccountKind0(makeNdk({}), key, { name: 'newcook', about: 'hi' }, [POOL]);
    stop();

    expect(published.events).toHaveLength(1);
    expect(published.events[0].pubkey).toBe(getPublicKey(key));
    expect(published.events[0].kind).toBe(0);
    expect(published.events[0].tags).toEqual([]);
    expect(lastContent()).toEqual({ name: 'newcook', about: 'hi' });
    expect(heard).toEqual([getPublicKey(key)]);
  });

  it('signup: no relay accepting (timeout/refusal) never throws, and the profile is cached locally', async () => {
    published.throws = true;
    const key = generateSecretKey();
    const heard: string[] = [];
    const stop = onProfileCached((pk) => heard.push(pk));
    const result = await publishNewAccountKind0(makeNdk({}), key, { name: 'newcook' }, [POOL]);
    stop();
    expect(result.relayCount).toBe(0);
    expect(result.event.pubkey).toBe(getPublicKey(key)); // the signed event, kept for the retry
    expect(heard).toEqual([getPublicKey(key)]);
  });

  it('signup: publishes to the given relays with a bounded wait (no outbox lookup)', async () => {
    const key = generateSecretKey();
    await publishNewAccountKind0(makeNdk({}), key, { name: 'newcook' }, [POOL]);
    const [relaySet, timeoutMs] = published.args[published.args.length - 1];
    expect([...relaySet.relays].map((r: any) => r.url)).toEqual([POOL]);
    expect(timeoutMs).toBe(NEW_ACCOUNT_KIND0_TIMEOUT_MS);
  });
});

describe('nip05Service.updateProfileWithNip05', () => {
  it('changes nip05 only', async () => {
    const ndk = makeNdk({ [PURPLEPAG]: { events: [kind0(RICH, 1000)] } });
    expect(await settle(updateProfileWithNip05(ndk, USER, 'cook@zap.cooking'))).toBe(true);
    expect(lastContent()).toEqual({ ...RICH, nip05: 'cook@zap.cooking' });
  });

  it('refused load: returns false and publishes nothing', async () => {
    const ndk = makeNdk({ [PURPLEPAG]: { reply: 'silent' }, [POOL]: { reply: 'silent' } });
    expect(await settle(updateProfileWithNip05(ndk, USER, 'cook@zap.cooking'))).toBe(false);
    expect(published.events).toHaveLength(0);
  });
});

describe('spark syncLightningAddressToProfile', () => {
  it('changes lud16 only', async () => {
    const ndk = makeNdk({ [PURPLEPAG]: { events: [kind0(RICH, 1000)] } });
    expect(await settle(syncLightningAddressToProfile('me@breez.tips', USER, ndk))).toBe(true);
    expect(lastContent()).toEqual({ ...RICH, lud16: 'me@breez.tips' });
  });

  it('already set: publishes nothing', async () => {
    const ndk = makeNdk({
      [PURPLEPAG]: { events: [kind0({ ...RICH, lud16: 'me@breez.tips' }, 1000)] }
    });
    expect(await settle(syncLightningAddressToProfile('me@breez.tips', USER, ndk))).toBe(true);
    expect(published.events).toHaveLength(0);
  });

  it('refused load: throws the user-facing message and publishes nothing', async () => {
    const ndk = makeNdk({ [PURPLEPAG]: { events: [kind0('{bad', 1000)] } });
    await expect(settle(syncLightningAddressToProfile('me@breez.tips', USER, ndk))).rejects.toThrow(
      /nothing was changed/
    );
    expect(published.events).toHaveLength(0);
  });
});
