/**
 * Unit tests for the scheduled-posts web client (scheduleClient.ts).
 *
 * fetch is a scripted fake that records every request; the NIP-98
 * signer, relay lookup and clock are injected. Signing runs through a
 * real NDKEvent with real signers, including ones that misbehave the
 * way a re-dating extension or remote signer would.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import NDK, { NDKEvent, NDKPrivateKeySigner, type NDKSigner, type NostrEvent as NDKRawEvent } from '@nostr-dev-kit/ndk';
import { finalizeEvent, generateSecretKey, getPublicKey, nip19, verifyEvent, type Event } from 'nostr-tools';
import {
  signForSchedule,
  scheduleEvent,
  listScheduled,
  cancelScheduled,
  pickScheduleRelays,
  scheduleErrorCopy,
  SCHEDULE_STATUSES,
  type ScheduleClientDeps,
  type ScheduleErrorCode
} from './scheduleClient';

const ORIGIN = 'https://zap.cooking';
const NOW = 1_800_000_000;
const sk = generateSecretKey();
const PUBKEY = getPublicKey(sk);

/** A signed event as plain JSON (without nostr-tools' Symbol(verified) marker), as it travels. */
function signed(overrides: Partial<Event> = {}): Event {
  return JSON.parse(
    JSON.stringify(
      finalizeEvent({ kind: 1, created_at: NOW + 3600, tags: [], content: 'later', ...overrides }, sk)
    )
  );
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
  rawBody: string | undefined;
}

type Reply = { status: number; body?: unknown } | Error | 'not-json';

/** deps with a fetch that answers from `replies` in order and logs calls. */
function harness(replies: Reply[], extra: Partial<ScheduleClientDeps> = {}) {
  const calls: Call[] = [];
  const authCalls: { method: string; url: string; bodyString?: string }[] = [];
  let n = 0;
  const deps: ScheduleClientDeps = {
    fetch: (async (input: any, init: any = {}) => {
      calls.push({
        url: String(input),
        method: init.method,
        headers: init.headers ?? {},
        body: init.body ? JSON.parse(init.body) : undefined,
        rawBody: init.body
      });
      const reply = replies[n++];
      if (reply === undefined) throw new Error('harness: no reply scripted');
      if (reply instanceof Error) throw reply;
      if (reply === 'not-json') return new Response('<html>bad gateway</html>', { status: 502 });
      return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status });
    }) as typeof fetch,
    origin: () => ORIGIN,
    signAuthHeader: async (opts) => {
      authCalls.push(opts);
      return `Nostr header-${authCalls.length}`;
    },
    getWriteRelays: async () => [],
    prepareSigner: async () => {},
    now: () => NOW,
    ...extra
  };
  return { deps, calls, authCalls };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

// ── pickScheduleRelays ──────────────────────────────────────────────

describe('pickScheduleRelays', () => {
  it('keeps the first four usable relays, in order, normalized', () => {
    expect(
      pickScheduleRelays([
        'wss://A.example.com/',
        'wss://b.example.com:443',
        'wss://c.example.com/inbox/',
        'wss://d.example.com',
        'wss://e.example.com'
      ])
    ).toEqual(['wss://a.example.com', 'wss://b.example.com', 'wss://c.example.com/inbox', 'wss://d.example.com']);
  });

  it('drops what the server would reject, so one bad relay cannot sink the request', () => {
    expect(
      pickScheduleRelays([
        'ws://insecure.example.com',
        'wss://localhost',
        'wss://192.168.1.4',
        'wss://[::1]',
        'wss://nas.lan',
        'wss://abc.onion',
        'wss://user:pw@a.example.com',
        `wss://a.example.com/${'p'.repeat(180)}`,
        42,
        null,
        '',
        'wss://ok.example.com'
      ])
    ).toEqual(['wss://ok.example.com']);
  });

  it('does not spend places on the scheduler’s own relays, purplepag.es, or duplicates', () => {
    expect(
      pickScheduleRelays([
        'wss://nos.lol',
        'wss://relay.primal.net/',
        'wss://purplepag.es',
        'wss://Nos.lol/',
        'wss://a.example.com',
        'wss://A.example.com/',
        'wss://b.example.com'
      ])
    ).toEqual(['wss://a.example.com', 'wss://b.example.com']);
  });

  it('an empty or unusable list is []', () => {
    expect(pickScheduleRelays([])).toEqual([]);
    expect(pickScheduleRelays(['wss://nos.lol', 'nonsense'])).toEqual([]);
  });
});

// ── signForSchedule ─────────────────────────────────────────────────

/** A signer that signs a re-dated copy and returns that signature, like a signer that stamps "now". */
class RedatingSigner extends NDKPrivateKeySigner {
  async sign(event: NDKRawEvent): Promise<string> {
    return finalizeEvent(
      { kind: event.kind!, created_at: NOW, tags: event.tags, content: event.content },
      sk
    ).sig;
  }
}

/** A signer that refuses, like a dismissed extension prompt. */
class RefusingSigner extends NDKPrivateKeySigner {
  async sign(): Promise<string> {
    throw new Error('User rejected');
  }
}

function draft(signer: NDKSigner | undefined, fields: Partial<{ kind: number; content: string; tags: string[][] }> = {}) {
  const ndk = new NDK({ signer });
  const event = new NDKEvent(ndk);
  event.kind = fields.kind ?? 1;
  event.content = fields.content ?? 'see you tomorrow';
  event.tags = fields.tags ?? [['t', 'foodstr']];
  return event;
}

const signDeps = (extra: Partial<ScheduleClientDeps> = {}) => harness([], extra).deps;

describe('signForSchedule', () => {
  const publishAt = NOW + 3600;

  it('signs with created_at = the publish time, and the result verifies', async () => {
    const result = await signForSchedule(draft(new NDKPrivateKeySigner(sk)), publishAt, signDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.created_at).toBe(publishAt);
    expect(result.event.pubkey).toBe(PUBKEY);
    expect(result.event.content).toBe('see you tomorrow');
    expect(result.event.tags).toContainEqual(['t', 'foodstr']);
    expect(verifyEvent({ ...result.event })).toBe(true);
    // A plain object the API can take as-is.
    expect(Object.keys(result.event).sort()).toEqual(['content', 'created_at', 'id', 'kind', 'pubkey', 'sig', 'tags']);
  });

  it('signs with the publish time even when the event already had a created_at', async () => {
    const event = draft(new NDKPrivateKeySigner(sk));
    event.created_at = NOW - 500;
    const result = await signForSchedule(event, publishAt, signDeps());
    expect(result.ok && result.event.created_at).toBe(publishAt);
    expect(event.created_at).toBe(NOW - 500);
  });

  /** Everything a later "publish now" would send or sign over. */
  const snapshot = (e: NDKEvent) =>
    JSON.parse(
      JSON.stringify({
        created_at: e.created_at ?? null,
        id: e.id ?? null,
        sig: e.sig ?? null,
        pubkey: e.pubkey ?? null,
        kind: e.kind,
        content: e.content,
        tags: e.tags
      })
    );

  // A `for` loop, not it.each: the each helpers don't typecheck under this repo's svelte-check.
  for (const [outcome, makeSigner, extra] of [
    ['success', () => new NDKPrivateKeySigner(sk), {}],
    ['sign_failed (signer refuses)', () => new RefusingSigner(sk), {}],
    ['signer_changed_event', () => new RedatingSigner(sk), {}],
    [
      'sign_failed (waking the signer throws)',
      () => new NDKPrivateKeySigner(sk),
      {
        prepareSigner: async () => {
          throw new Error('bunker unreachable');
        }
      }
    ]
  ] as [string, () => NDKSigner, Partial<ScheduleClientDeps>][]) {
    it(`the input event is unchanged after ${outcome}`, async () => {
      const event = draft(makeSigner());
      const tagsRef = event.tags;
      const firstTagRef = event.tags[0];
      const before = snapshot(event);
      expect(before.created_at).toBeNull(); // an ordinary unsigned draft

      const result = await signForSchedule(event, publishAt, signDeps(extra));
      expect(result.ok).toBe(outcome === 'success');

      expect(snapshot(event)).toEqual(before);
      expect(event.created_at).toBeUndefined();
      expect(event.sig).toBeUndefined();
      // Not even the tag arrays are shared with what was signed.
      expect(event.tags).toBe(tagsRef);
      expect(event.tags[0]).toBe(firstTagRef);
      expect(event.tags).toEqual([['t', 'foodstr']]);
    });
  }

  it('after a rejected schedule attempt, publishing the same event now signs the current time, not the future one', async () => {
    const event = draft(new RedatingSigner(sk));
    expect(await signForSchedule(event, publishAt, signDeps())).toEqual({ ok: false, code: 'signer_changed_event' });

    // "Publish now" with an honest signer: NDK stamps the time itself
    // because created_at is still unset.
    event.ndk!.signer = new NDKPrivateKeySigner(sk);
    const before = Math.floor(Date.now() / 1000);
    await event.sign();
    expect(event.created_at).toBeGreaterThanOrEqual(before);
    expect(event.created_at).toBeLessThanOrEqual(before + 5);
    expect(event.created_at).not.toBe(publishAt);
    expect(verifyEvent({ ...(event.rawEvent() as Event) })).toBe(true);
  });

  it('tags NDK adds while signing (mentions, hashtags) land on the copy only', async () => {
    const content = `thanks nostr:${nip19.npubEncode(PUBKEY)} #dinner`;
    const event = draft(new NDKPrivateKeySigner(sk), { content, tags: [['t', 'foodstr']] });
    const result = await signForSchedule(event, publishAt, signDeps());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.tags.length).toBeGreaterThan(1); // NDK derived at least one tag
    expect(event.tags).toEqual([['t', 'foodstr']]);
    expect(event.content).toBe(content);
  });

  it('an input that was already signed keeps its own id and signature', async () => {
    const event = draft(new NDKPrivateKeySigner(sk));
    await event.sign();
    const before = snapshot(event);
    const result = await signForSchedule(event, publishAt, signDeps());
    expect(result.ok).toBe(true);
    expect(snapshot(event)).toEqual(before);
    if (result.ok) expect(result.event.id).not.toBe(before.id);
  });

  it('signing the same draft for a new time gives a different event', async () => {
    const event = draft(new NDKPrivateKeySigner(sk));
    const first = await signForSchedule(event, publishAt, signDeps());
    const second = await signForSchedule(event, publishAt + 600, signDeps());
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.event.created_at).toBe(publishAt + 600);
    expect(second.event.id).not.toBe(first.event.id);
    expect(second.event.sig).not.toBe(first.event.sig);
    expect(verifyEvent({ ...second.event })).toBe(true);
  });

  it('wakes a remote signer before signing', async () => {
    const order: string[] = [];
    const signer = new NDKPrivateKeySigner(sk);
    const realSign = signer.sign.bind(signer);
    signer.sign = async (e) => (order.push('sign'), realSign(e));
    await signForSchedule(
      draft(signer),
      publishAt,
      signDeps({ prepareSigner: async () => void order.push('prepare') })
    );
    expect(order).toEqual(['prepare', 'sign']);
  });

  it('signer_changed_event when the signer signs a different time', async () => {
    const result = await signForSchedule(draft(new RedatingSigner(sk)), publishAt, signDeps());
    expect(result).toEqual({ ok: false, code: 'signer_changed_event' });
  });

  it('sign_failed when the signer refuses', async () => {
    const result = await signForSchedule(draft(new RefusingSigner(sk)), publishAt, signDeps());
    expect(result).toEqual({ ok: false, code: 'sign_failed' });
  });

  it('sign_failed when waking the signer throws', async () => {
    const result = await signForSchedule(
      draft(new NDKPrivateKeySigner(sk)),
      publishAt,
      signDeps({
        prepareSigner: async () => {
          throw new Error('bunker unreachable');
        }
      })
    );
    expect(result).toEqual({ ok: false, code: 'sign_failed' });
  });

  it('not_signed_in without a signer', async () => {
    expect(await signForSchedule(draft(undefined), publishAt, signDeps())).toEqual({
      ok: false,
      code: 'not_signed_in'
    });
  });

  it('bad_publish_time for a time the server would refuse, before the signer is ever asked', async () => {
    const signer = new NDKPrivateKeySigner(sk);
    const sign = vi.spyOn(signer, 'sign');
    for (const t of [NOW - 1, NOW, NOW + 120, NOW + 90 * 86400, NOW + 3600.5, Number.NaN]) {
      expect(await signForSchedule(draft(signer), t, signDeps()), String(t)).toEqual({
        ok: false,
        code: 'bad_publish_time'
      });
    }
    expect(sign).not.toHaveBeenCalled();
    // The edges that are allowed.
    expect((await signForSchedule(draft(signer), NOW + 121, signDeps())).ok).toBe(true);
    expect((await signForSchedule(draft(signer), NOW + 90 * 86400 - 1, signDeps())).ok).toBe(true);
  });
});

// ── scheduleEvent ───────────────────────────────────────────────────

describe('scheduleEvent', () => {
  const created = (event: Event, relays: string[] = [], relay_mode = 'all') => ({
    status: 201,
    body: { id: event.id, publish_at: event.created_at, relay_mode, relays, status: 'pending' }
  });

  it('POSTs the event unchanged with NIP-98 over the exact body, and returns the stored row', async () => {
    const event = signed();
    const { deps, calls, authCalls } = harness([created(event, ['wss://a.example.com'])]);
    const result = await scheduleEvent(event, { relayMode: 'all', relays: ['wss://A.example.com/'] }, deps);

    expect(result).toEqual({
      ok: true,
      id: event.id,
      publishAt: event.created_at,
      relayMode: 'all',
      relays: ['wss://a.example.com'],
      status: 'pending',
      alreadyScheduled: false
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${ORIGIN}/api/schedule`);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].body).toEqual({ event, relay_mode: 'all', relays: ['wss://a.example.com'] });
    expect(calls[0].headers.Authorization).toBe('Nostr header-1');
    // The auth header is signed over the very string that is sent.
    expect(authCalls).toEqual([{ method: 'POST', url: `${ORIGIN}/api/schedule`, bodyString: calls[0].rawBody }]);
  });

  it('fills relays from the author’s NIP-65 write relays when none are given', async () => {
    const event = signed();
    const asked: string[] = [];
    const { deps, calls } = harness([created(event)], {
      getWriteRelays: async (pubkey) => {
        asked.push(pubkey);
        return ['wss://nos.lol', 'wss://mine.example.com/', 'wss://purplepag.es', 'ws://bad.example.com'];
      }
    });
    await scheduleEvent(event, { relayMode: 'all' }, deps);
    expect(asked).toEqual([PUBKEY]);
    expect(calls[0].body.relays).toEqual(['wss://mine.example.com']);
  });

  it('unknown write relays (or a failed lookup) just means no relays field', async () => {
    const event = signed();
    for (const getWriteRelays of [
      async () => [],
      async () => {
        throw new Error('cache down');
      }
    ]) {
      const { deps, calls } = harness([created(event)], { getWriteRelays });
      const result = await scheduleEvent(event, { relayMode: 'all' }, deps);
      expect(result.ok).toBe(true);
      expect(calls[0].body).toEqual({ event, relay_mode: 'all' });
    }
  });

  it('relays: [] sends none and does not look any up', async () => {
    const event = signed();
    const getWriteRelays = vi.fn(async () => ['wss://mine.example.com']);
    const { deps, calls } = harness([created(event)], { getWriteRelays });
    await scheduleEvent(event, { relayMode: 'all', relays: [] }, deps);
    expect(getWriteRelays).not.toHaveBeenCalled();
    expect(calls[0].body).toEqual({ event, relay_mode: 'all' });
  });

  it("pantry mode never sends relays and never looks them up", async () => {
    const event = signed();
    const getWriteRelays = vi.fn(async () => ['wss://mine.example.com']);
    const { deps, calls } = harness([created(event, [], 'pantry')], { getWriteRelays });
    const result = await scheduleEvent(event, { relayMode: 'pantry', relays: ['wss://a.example.com'] }, deps);
    expect(getWriteRelays).not.toHaveBeenCalled();
    expect(calls[0].body).toEqual({ event, relay_mode: 'pantry' });
    expect(result.ok && result.relayMode).toBe('pantry');
  });

  it('bad_relays: retries once without relays so the post still goes out', async () => {
    const event = signed();
    const { deps, calls } = harness([{ status: 400, body: { error: 'bad_relays' } }, created(event)]);
    const result = await scheduleEvent(event, { relayMode: 'all', relays: ['wss://a.example.com'] }, deps);
    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.body.relays)).toEqual([['wss://a.example.com'], undefined]);
  });

  it('bad_relays with nothing sent is reported, not retried forever', async () => {
    const { deps, calls } = harness([{ status: 400, body: { error: 'bad_relays' } }]);
    const result = await scheduleEvent(signed(), { relayMode: 'all', relays: [] }, deps);
    expect(result).toEqual({ ok: false, code: 'bad_relays' });
    expect(calls).toHaveLength(1);
  });

  // A `for` loop, not it.each: the each helpers don't typecheck under this repo's svelte-check.
  for (const status of ['pending', 'publishing', 'sent'] as const) {
    it(`409 already_scheduled (${status}) is success: an earlier attempt landed`, async () => {
      const event = signed();
      const { deps } = harness([{ status: 409, body: { error: 'already_scheduled', status } }]);
      const result = await scheduleEvent(event, { relayMode: 'all', relays: ['wss://a.example.com'] }, deps);
      expect(result).toEqual({
        ok: true,
        id: event.id,
        publishAt: event.created_at,
        relayMode: 'all',
        relays: ['wss://a.example.com'],
        status,
        alreadyScheduled: true
      });
    });
  }

  for (const status of ['cancelled', 'failed'] as const) {
    it(`409 already_scheduled (${status}) is a failure that carries the status`, async () => {
      const { deps } = harness([{ status: 409, body: { error: 'already_scheduled', status } }]);
      expect(await scheduleEvent(signed(), { relayMode: 'all', relays: [] }, deps)).toEqual({
        ok: false,
        code: 'already_scheduled',
        status
      });
    });
  }

  it('409 already_scheduled without a usable status is a failure, not assumed success', async () => {
    for (const body of [{ error: 'already_scheduled' }, { error: 'already_scheduled', status: 'weird' }]) {
      const { deps } = harness([{ status: 409, body }]);
      expect(await scheduleEvent(signed(), { relayMode: 'all', relays: [] }, deps)).toEqual({
        ok: false,
        code: 'already_scheduled'
      });
    }
  });

  const SERVER_ERRORS: [number, ScheduleErrorCode][] = [
    [400, 'bad_request'],
    [400, 'bad_relay_mode'],
    [400, 'bad_signature'],
    [400, 'pubkey_mismatch'],
    [400, 'bad_kind'],
    [400, 'kind_not_allowed_for_relay_mode'],
    [400, 'bad_publish_time'],
    [400, 'too_large'],
    [400, 'poll_closes_before_publish'],
    [400, 'quota_exceeded'],
    [429, 'rate_limited'],
    [500, 'not_configured'],
    [500, 'internal']
  ];
  for (const [status, code] of SERVER_ERRORS) {
    it(`${status} ${code} → { ok: false, code: '${code}' }`, async () => {
      const { deps, calls } = harness([{ status, body: { error: code } }]);
      expect(await scheduleEvent(signed(), { relayMode: 'all', relays: [] }, deps)).toEqual({ ok: false, code });
      expect(calls).toHaveLength(1); // none of these is retried
    });
  }

  it('401: retried once with a freshly signed header, then auth_failed', async () => {
    const { deps, calls, authCalls } = harness([
      { status: 401, body: { error: 'auth_failed', detail: 'event' } },
      { status: 401, body: { error: 'auth_failed', detail: 'event' } }
    ]);
    expect(await scheduleEvent(signed(), { relayMode: 'all', relays: [] }, deps)).toEqual({
      ok: false,
      code: 'auth_failed'
    });
    expect(calls.map((c) => c.headers.Authorization)).toEqual(['Nostr header-1', 'Nostr header-2']);
    expect(authCalls).toHaveLength(2);
  });

  it('401 then 201: the retry succeeds', async () => {
    const event = signed();
    const { deps } = harness([{ status: 401, body: { error: 'auth_failed', detail: 'event' } }, created(event)]);
    expect((await scheduleEvent(event, { relayMode: 'all', relays: [] }, deps)).ok).toBe(true);
  });

  it('a code that belongs to another endpoint, a new code, or no JSON at all is `unknown`', async () => {
    for (const reply of [
      { status: 404, body: { error: 'not_found' } },
      { status: 400, body: { error: 'brand_new_code' } },
      { status: 400, body: { error: 42 } },
      { status: 500, body: [] },
      'not-json' as const
    ]) {
      const { deps } = harness([reply]);
      expect(await scheduleEvent(signed(), { relayMode: 'all', relays: [] }, deps)).toEqual({
        ok: false,
        code: 'unknown'
      });
    }
  });

  it('network: fetch throwing is a typed failure, and nothing is thrown', async () => {
    const { deps } = harness([new TypeError('Failed to fetch')]);
    expect(await scheduleEvent(signed(), { relayMode: 'all', relays: [] }, deps)).toEqual({
      ok: false,
      code: 'network'
    });
  });

  it('not_signed_in when the NIP-98 header cannot be signed; no request is made', async () => {
    const { deps, calls } = harness([], {
      signAuthHeader: async () => {
        throw new Error('NIP-98 signing requires an NDK signer');
      }
    });
    expect(await scheduleEvent(signed(), { relayMode: 'all', relays: [] }, deps)).toEqual({
      ok: false,
      code: 'not_signed_in'
    });
    expect(calls).toHaveLength(0);
  });

  it('no server text ever reaches the result', async () => {
    const { deps } = harness([{ status: 500, body: { error: 'internal', message: 'D1_ERROR: no such column' } }]);
    const result = await scheduleEvent(signed(), { relayMode: 'all', relays: [] }, deps);
    expect(JSON.stringify(result)).not.toContain('D1_ERROR');
  });
});

// ── listScheduled ───────────────────────────────────────────────────

describe('listScheduled', () => {
  const row = (event: Event, overrides: Record<string, unknown> = {}) => ({
    id: event.id,
    publish_at: event.created_at,
    relay_mode: 'all',
    relays: ['wss://a.example.com'],
    status: 'pending',
    attempts: 0,
    last_error: null,
    sent_at: null,
    event,
    ...overrides
  });

  it('GETs with NIP-98 over the bare URL and maps rows to camelCase items', async () => {
    const a = signed({ content: 'a' });
    const b = signed({ content: 'b', created_at: NOW + 60 });
    const { deps, calls, authCalls } = harness([
      {
        status: 200,
        body: {
          items: [
            row(a),
            row(b, { status: 'failed', attempts: 10, last_error: 'blocked: spam', relay_mode: 'pantry', relays: [] }),
            row(signed({ content: 'c' }), { status: 'sent', sent_at: NOW + 5 })
          ]
        }
      }
    ]);
    const result = await listScheduled({}, deps);

    expect(calls[0].url).toBe(`${ORIGIN}/api/schedule`);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].rawBody).toBeUndefined();
    expect(authCalls).toEqual([{ method: 'GET', url: `${ORIGIN}/api/schedule`, bodyString: undefined }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0]).toEqual({
      id: a.id,
      publishAt: a.created_at,
      relayMode: 'all',
      relays: ['wss://a.example.com'],
      status: 'pending',
      attempts: 0,
      lastError: null,
      sentAt: null,
      event: a
    });
    expect(result.items[1]).toMatchObject({ status: 'failed', attempts: 10, lastError: 'blocked: spam', relayMode: 'pantry', relays: [] });
    expect(result.items[2]).toMatchObject({ status: 'sent', sentAt: NOW + 5 });
  });

  for (const status of SCHEDULE_STATUSES) {
    it(`status: '${status}' is sent as ?status=${status}, while the auth header still signs the bare URL`, async () => {
      const { deps, calls, authCalls } = harness([{ status: 200, body: { items: [] } }]);
      expect(await listScheduled({ status }, deps)).toEqual({ ok: true, items: [] });
      expect(calls[0].url).toBe(`${ORIGIN}/api/schedule?status=${status}`);
      expect(authCalls[0].url).toBe(`${ORIGIN}/api/schedule`);
    });
  }

  it('skips rows it cannot read instead of failing the whole list', async () => {
    const good = signed();
    const { deps } = harness([
      {
        status: 200,
        body: {
          items: [
            null,
            'nope',
            row(good, { status: 'archived' }),
            row(good, { publish_at: 'soon' }),
            row(good, { event: null }),
            row(good, { event: { id: good.id } }),
            row(good)
          ]
        }
      }
    ]);
    const result = await listScheduled({}, deps);
    expect(result.ok && result.items.map((i) => i.id)).toEqual([good.id]);
  });

  const LIST_ERRORS: [number, ScheduleErrorCode][] = [
    [400, 'bad_status'],
    [500, 'not_configured'],
    [500, 'internal']
  ];
  for (const [status, code] of LIST_ERRORS) {
    it(`${status} ${code}`, async () => {
      const { deps } = harness([{ status, body: { error: code } }]);
      expect(await listScheduled({}, deps)).toEqual({ ok: false, code });
    });
  }

  it('auth_failed after one retry; network; not_signed_in; unknown', async () => {
    const unauthorized = { status: 401, body: { error: 'auth_failed', detail: 'header' } };
    expect(await listScheduled({}, harness([unauthorized, unauthorized]).deps)).toEqual({ ok: false, code: 'auth_failed' });
    expect(await listScheduled({}, harness([new Error('offline')]).deps)).toEqual({ ok: false, code: 'network' });
    expect(
      await listScheduled(
        {},
        harness([], {
          signAuthHeader: async () => {
            throw new Error('no signer');
          }
        }).deps
      )
    ).toEqual({ ok: false, code: 'not_signed_in' });
    // 200 without an items array, and a code from another endpoint.
    expect(await listScheduled({}, harness([{ status: 200, body: {} }]).deps)).toEqual({ ok: false, code: 'unknown' });
    expect(await listScheduled({}, harness([{ status: 400, body: { error: 'bad_kind' } }]).deps)).toEqual({ ok: false, code: 'unknown' });
  });
});

// ── cancelScheduled ─────────────────────────────────────────────────

describe('cancelScheduled', () => {
  const ID = 'ab'.repeat(32);

  it('DELETEs /api/schedule/<id> with NIP-98 over that URL and no body', async () => {
    const { deps, calls, authCalls } = harness([{ status: 200, body: { id: ID, status: 'cancelled' } }]);
    expect(await cancelScheduled(ID, deps)).toEqual({ ok: true, id: ID, alreadyCancelled: false });
    expect(calls[0].url).toBe(`${ORIGIN}/api/schedule/${ID}`);
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].rawBody).toBeUndefined();
    expect(authCalls).toEqual([{ method: 'DELETE', url: `${ORIGIN}/api/schedule/${ID}`, bodyString: undefined }]);
  });

  for (const status of ['publishing', 'sent', 'failed'] as const) {
    it(`409 not_cancellable (${status}) carries the status so the UI can be honest`, async () => {
      const { deps } = harness([{ status: 409, body: { error: 'not_cancellable', status } }]);
      expect(await cancelScheduled(ID, deps)).toEqual({ ok: false, code: 'not_cancellable', status });
    });
  }

  it('409 not_cancellable (cancelled) counts as done', async () => {
    const { deps } = harness([{ status: 409, body: { error: 'not_cancellable', status: 'cancelled' } }]);
    expect(await cancelScheduled(ID, deps)).toEqual({ ok: true, id: ID, alreadyCancelled: true });
  });

  it('409 not_cancellable with an unknown status is still not_cancellable', async () => {
    const { deps } = harness([{ status: 409, body: { error: 'not_cancellable', status: 'unknown' } }]);
    expect(await cancelScheduled(ID, deps)).toEqual({ ok: false, code: 'not_cancellable' });
  });

  it('404 not_found', async () => {
    const { deps } = harness([{ status: 404, body: { error: 'not_found' } }]);
    expect(await cancelScheduled(ID, deps)).toEqual({ ok: false, code: 'not_found' });
  });

  it('an id that is not an event id never becomes a request', async () => {
    for (const bad of ['', 'abc', `${ID}/../../x`, ID.toUpperCase(), `${ID}?x=1`]) {
      const { deps, calls } = harness([]);
      expect(await cancelScheduled(bad, deps), bad).toEqual({ ok: false, code: 'not_found' });
      expect(calls).toHaveLength(0);
    }
  });

  it('a 200 that does not say cancelled is not taken as success', async () => {
    const { deps } = harness([{ status: 200, body: {} }]);
    expect(await cancelScheduled(ID, deps)).toEqual({ ok: false, code: 'unknown' });
  });

  it('auth_failed after one retry; internal; network', async () => {
    const unauthorized = { status: 401, body: { error: 'auth_failed', detail: 'binding' } };
    expect(await cancelScheduled(ID, harness([unauthorized, unauthorized]).deps)).toEqual({ ok: false, code: 'auth_failed' });
    expect(await cancelScheduled(ID, harness([{ status: 500, body: { error: 'internal' } }]).deps)).toEqual({ ok: false, code: 'internal' });
    expect(await cancelScheduled(ID, harness([new Error('offline')]).deps)).toEqual({ ok: false, code: 'network' });
  });
});

// ── copy ────────────────────────────────────────────────────────────

describe('scheduleErrorCopy', () => {
  const ALL: ScheduleErrorCode[] = [
    'auth_failed', 'bad_request', 'bad_relay_mode', 'bad_relays', 'bad_signature', 'pubkey_mismatch',
    'bad_kind', 'kind_not_allowed_for_relay_mode', 'bad_publish_time', 'too_large',
    'poll_closes_before_publish', 'already_scheduled', 'quota_exceeded', 'rate_limited', 'bad_status',
    'not_found', 'not_cancellable', 'not_configured', 'internal', 'not_signed_in', 'sign_failed',
    'signer_changed_event', 'network', 'unknown'
  ];

  it('has plain copy for every code: a sentence, with no code names or underscores', () => {
    for (const code of ALL) {
      const copy = scheduleErrorCopy({ code });
      expect(copy.length, code).toBeGreaterThan(15);
      expect(copy, code).toMatch(/[.]$/);
      expect(copy, code).not.toMatch(/_|undefined|\bnull\b/);
    }
  });

  it('every code in the contract has copy here (the doc and the client agree on the list)', async () => {
    const { readFileSync } = await import('node:fs');
    const doc = readFileSync('docs/schedule-contract.md', 'utf8');
    const errors = doc.slice(doc.indexOf('## Errors'), doc.indexOf('### Retrying a create'));
    const inDoc = [...errors.matchAll(/^\| \d{3} \| `([a-z_]+)` \|/gm)].map((m) => m[1]);
    expect(inDoc.length).toBeGreaterThanOrEqual(19);
    for (const code of inDoc) expect(ALL, code).toContain(code);
    // …and nothing server-side is listed here that the contract does not have.
    const clientOnly = ['not_signed_in', 'sign_failed', 'signer_changed_event', 'network', 'unknown'];
    expect(ALL.filter((c) => !clientOnly.includes(c)).sort()).toEqual([...new Set(inDoc)].sort());
  });

  it('not_cancellable says what actually happened, by status', () => {
    expect(scheduleErrorCopy({ code: 'not_cancellable', status: 'publishing' })).toContain('being published right now');
    expect(scheduleErrorCopy({ code: 'not_cancellable', status: 'sent' })).toContain('already been published');
    expect(scheduleErrorCopy({ code: 'not_cancellable', status: 'failed' })).toContain('already failed');
    expect(scheduleErrorCopy({ code: 'not_cancellable' })).toContain("can't be cancelled");
  });

  it('the signer copy tells the person what to do next', () => {
    expect(scheduleErrorCopy({ code: 'signer_changed_event' })).toContain("can't be scheduled");
  });
});
