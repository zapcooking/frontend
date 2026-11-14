/** Tests for the Go live host page's logic: API outcomes, reconnect policy, device helpers. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  classifyPublishReply,
  createLiveSession,
  endLiveSession,
  endLiveSessionSigned,
  publishOffer,
  readLiveStatus
} from './hostApi';
import {
  BACKOFF_MS,
  HOST_MAX_ATTEMPTS,
  QUICK_RETRY_MS,
  RECOVERY_GRACE_MS,
  ReconnectPolicy,
  backoffDelayMs,
  type StopReason
} from './reconnect';
import {
  cameraAttempts,
  classifyMediaError,
  clearStoredSession,
  detectPlatform,
  hasConfirmedAge,
  isConstraintFailure,
  liveDurationLine,
  loadStoredSession,
  mediaHelp,
  readRecipeHandoff,
  rememberAgeConfirmed,
  setMicrophoneEnabled,
  storeSession
} from './hostDevice';
import { LIVE_MAX_PUBLISH_ATTEMPTS } from '../config';

const ID = 'a'.repeat(32);
const TOKEN = 'b'.repeat(64);
const PUBKEY = 'c'.repeat(64);
const sign = vi.fn(async () => 'Nostr signed');
const reply = (status: number, body: unknown, sdp = false) =>
  new Response(sdp ? (body as string) : JSON.stringify(body), { status });

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k)
  };
}

describe('createLiveSession', () => {
  beforeEach(() => sign.mockClear());

  it('signs the exact body it sends and returns the session', async () => {
    const fetchFn = vi.fn(async () => reply(201, { id: ID, status: 'created', host_token: TOKEN }));
    const out = await createLiveSession(
      { title: 'Paella', recipeA: `30023:${PUBKEY}:paella` },
      sign,
      fetchFn as any
    );
    expect(out).toEqual({ ok: true, session: { id: ID, token: TOKEN } });
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      title: 'Paella',
      recipe_a: `30023:${PUBKEY}:paella`
    });
    const signed = (
      sign.mock.calls[0] as unknown as [{ method: string; url: string; bodyString?: string }]
    )[0];
    expect(signed.method).toBe('POST');
    expect(signed.bodyString).toBe(init.body);
    expect(signed.url.endsWith('/api/live')).toBe(true);
    expect((init.headers as Record<string, string>).Authorization).toBe('Nostr signed');
  });

  it('leaves recipe_a out when there is no recipe', async () => {
    const fetchFn = vi.fn(async () => reply(201, { id: ID, host_token: TOKEN }));
    await createLiveSession({ title: 'Just cooking', recipeA: null }, sign, fetchFn as any);
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ title: 'Just cooking' });
  });

  it('maps every refusal to its own reason', async () => {
    const cases: [number, unknown, string][] = [
      [403, { error: 'not_allowed' }, 'not_allowed'],
      [403, { error: 'membership_required' }, 'membership_required'],
      [503, { error: 'membership_unavailable' }, 'membership_unavailable'],
      [503, { error: 'live_off' }, 'live_off'],
      [429, { error: 'rate_limited' }, 'rate_limited'],
      [401, { error: 'auth_failed', detail: 'event' }, 'auth_failed'],
      [400, { error: 'bad_title' }, 'bad_request'],
      [413, { error: 'too_large' }, 'bad_request'],
      [500, { error: 'internal' }, 'unavailable'],
      [502, 'not json', 'unavailable']
    ];
    for (const [status, body, reason] of cases) {
      const out = await createLiveSession({ title: 't', recipeA: null }, sign, (async () =>
        reply(status, body)) as any);
      expect(out).toMatchObject({ ok: false, reason });
    }
  });

  it('never reports a membership outage as "not a member"', async () => {
    const out = await createLiveSession({ title: 't', recipeA: null }, sign, (async () =>
      reply(503, { error: 'membership_unavailable' })) as any);
    expect(out).toEqual({ ok: false, reason: 'membership_unavailable' });
  });

  it('reports an open session with its id', async () => {
    const out = await createLiveSession({ title: 't', recipeA: null }, sign, (async () =>
      reply(409, { error: 'already_active', id: ID })) as any);
    expect(out).toEqual({ ok: false, reason: 'already_active', id: ID });
  });

  it('reports a refused signature and a network failure without throwing', async () => {
    const refused = await createLiveSession({ title: 't', recipeA: null }, async () => {
      throw new Error('user rejected');
    });
    expect(refused).toEqual({ ok: false, reason: 'sign_failed' });
    const offline = await createLiveSession({ title: 't', recipeA: null }, sign, (async () => {
      throw new TypeError('Failed to fetch');
    }) as any);
    expect(offline).toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('publishOffer', () => {
  const session = { id: ID, token: TOKEN };

  it('sends the offer with the host token in the header and returns the answer', async () => {
    const fetchFn = vi.fn(async () => reply(201, 'v=0\r\nanswer', true));
    const out = await publishOffer(session, 'v=0\r\noffer', fetchFn as any);
    expect(out).toEqual({ ok: true, answerSdp: 'v=0\r\nanswer' });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/live/${ID}/publish`);
    expect(url).not.toContain(TOKEN);
    expect(init.headers).toEqual({
      'Content-Type': 'application/sdp',
      Authorization: `Bearer ${TOKEN}`
    });
    expect(init.body).toBe('v=0\r\noffer');
  });

  it('classifies each refusal', () => {
    expect(classifyPublishReply(409, 'publish_in_progress')).toBe('retry');
    expect(classifyPublishReply(503, 'stream_unavailable')).toBe('retry');
    expect(classifyPublishReply(500, undefined)).toBe('retry');
    expect(classifyPublishReply(409, 'ended')).toBe('ended');
    expect(classifyPublishReply(404, 'not_found')).toBe('ended');
    expect(classifyPublishReply(503, 'live_off')).toBe('off');
    expect(classifyPublishReply(429, 'publish_limit')).toBe('limit');
    expect(classifyPublishReply(401, 'auth_failed')).toBe('auth');
    expect(classifyPublishReply(403, 'not_allowed')).toBe('auth');
    expect(classifyPublishReply(422, 'offer_rejected')).toBe('rejected');
    expect(classifyPublishReply(400, 'bad_offer')).toBe('rejected');
  });

  it('treats a network error and a non-SDP 201 as "try again"', async () => {
    expect(
      await publishOffer(session, 'v=0', (async () => {
        throw new TypeError('offline');
      }) as any)
    ).toEqual({ ok: false, failure: 'retry' });
    expect(
      await publishOffer(session, 'v=0', (async () => reply(201, '<html>', true)) as any)
    ).toEqual({ ok: false, failure: 'retry' });
  });
});

describe('end and status', () => {
  it('ends with the token in the header, never in the URL', async () => {
    const fetchFn = vi.fn(async () => reply(200, { id: ID, status: 'ended' }));
    expect(await endLiveSession({ id: ID, token: TOKEN }, fetchFn as any)).toBe(true);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/live/${ID}/end`);
    expect(init.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    expect(
      await endLiveSession({ id: ID, token: TOKEN }, (async () => {
        throw new Error('x');
      }) as any)
    ).toBe(false);
  });

  it('ends a session it holds no token for by signature', async () => {
    const fetchFn = vi.fn(async () => reply(200, { status: 'ended' }));
    expect(await endLiveSessionSigned(ID, sign, fetchFn as any)).toBe(true);
    const signedEnd = (
      sign.mock.calls.at(-1) as unknown as [{ method: string; url: string; bodyString?: string }]
    )[0];
    expect(signedEnd.method).toBe('POST');
    expect(signedEnd.url.endsWith(`/api/live/${ID}/end`)).toBe(true);
    expect(signedEnd.bodyString).toBeUndefined();
    expect(
      await endLiveSessionSigned(ID, async () => {
        throw new Error('refused');
      })
    ).toBe(false);
  });

  it('reads the status, and says null when it cannot', async () => {
    expect(await readLiveStatus(ID, (async () => reply(200, { status: 'live' })) as any)).toBe(
      'live'
    );
    expect(await readLiveStatus(ID, (async () => reply(200, { status: 'ended' })) as any)).toBe(
      'ended'
    );
    expect(await readLiveStatus(ID, (async () => reply(404, { error: 'not_found' })) as any)).toBe(
      'gone'
    );
    expect(await readLiveStatus(ID, (async () => reply(500, {})) as any)).toBeNull();
    expect(
      await readLiveStatus(ID, (async () => reply(200, { status: 'weird' })) as any)
    ).toBeNull();
    expect(
      await readLiveStatus(ID, (async () => {
        throw new TypeError('offline');
      }) as any)
    ).toBeNull();
  });
});

describe('ReconnectPolicy', () => {
  let republish: ReturnType<typeof vi.fn>;
  let stops: StopReason[];
  let policy: ReconnectPolicy;
  const make = (maxAttempts?: number) =>
    new ReconnectPolicy({
      republish,
      stop: (reason) => stops.push(reason),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      maxAttempts
    });

  beforeEach(() => {
    vi.useFakeTimers();
    republish = vi.fn();
    stops = [];
    policy = make();
    // The first Go live.
    policy.publishStarted();
    policy.publishSucceeded();
    policy.connected();
  });
  afterEach(() => vi.useRealTimers());

  it('gives a disconnected connection five seconds to recover before republishing', () => {
    policy.disconnected();
    expect(policy.waiting).toBe(true);
    vi.advanceTimersByTime(RECOVERY_GRACE_MS - 1);
    expect(republish).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(republish).toHaveBeenCalledTimes(1);
  });

  it('does not republish when the connection recovers by itself', () => {
    policy.disconnected();
    vi.advanceTimersByTime(3000);
    policy.connected();
    vi.advanceTimersByTime(60_000);
    expect(republish).not.toHaveBeenCalled();
    expect(policy.waiting).toBe(false);
  });

  it('republishes quickly when the connection has failed', () => {
    policy.failed();
    vi.advanceTimersByTime(QUICK_RETRY_MS);
    expect(republish).toHaveBeenCalledTimes(1);
  });

  it('a failure during the grace period brings the republish forward', () => {
    policy.disconnected();
    vi.advanceTimersByTime(1000);
    policy.failed();
    vi.advanceTimersByTime(QUICK_RETRY_MS);
    expect(republish).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(RECOVERY_GRACE_MS);
    expect(republish).toHaveBeenCalledTimes(1);
  });

  it('backs off between failed attempts: 1, 2, 4, 8, then 15 seconds', () => {
    expect(BACKOFF_MS).toEqual([1000, 2000, 4000, 8000, 15000]);
    expect([0, 1, 2, 3, 4, 5, 50].map(backoffDelayMs)).toEqual([
      1000, 2000, 4000, 8000, 15000, 15000, 15000
    ]);

    policy.failed();
    vi.advanceTimersByTime(QUICK_RETRY_MS);
    for (const wait of [1000, 2000, 4000, 8000, 15000, 15000]) {
      const before = republish.mock.calls.length;
      policy.publishStarted();
      policy.publishFailed('retry');
      vi.advanceTimersByTime(wait - 1);
      expect(republish).toHaveBeenCalledTimes(before);
      vi.advanceTimersByTime(1);
      expect(republish).toHaveBeenCalledTimes(before + 1);
    }
  });

  it('a successful connection resets the backoff', () => {
    policy.failed();
    vi.advanceTimersByTime(QUICK_RETRY_MS);
    for (let i = 0; i < 3; i++) {
      policy.publishStarted();
      policy.publishFailed('retry');
      vi.advanceTimersByTime(20_000);
    }
    policy.publishStarted();
    policy.publishSucceeded();
    policy.connected();
    republish.mockClear();

    policy.failed();
    vi.advanceTimersByTime(QUICK_RETRY_MS);
    policy.publishStarted();
    policy.publishFailed('retry');
    vi.advanceTimersByTime(1000);
    expect(republish).toHaveBeenCalledTimes(2);
  });

  it('coming back online skips the rest of a wait', () => {
    policy.failed();
    vi.advanceTimersByTime(QUICK_RETRY_MS);
    for (let i = 0; i < 5; i++) {
      policy.publishStarted();
      policy.publishFailed('retry');
      if (i < 4) vi.advanceTimersByTime(20_000);
    }
    republish.mockClear();
    // Now waiting 15 s. The network returns after 2 s.
    vi.advanceTimersByTime(2000);
    policy.online();
    vi.advanceTimersByTime(QUICK_RETRY_MS);
    expect(republish).toHaveBeenCalledTimes(1);
  });

  it('ignores "online" when nothing is waiting', () => {
    policy.online();
    vi.advanceTimersByTime(60_000);
    expect(republish).not.toHaveBeenCalled();
  });

  it('does not schedule a second republish while one is in flight', () => {
    policy.failed();
    vi.advanceTimersByTime(QUICK_RETRY_MS);
    policy.publishStarted();
    policy.disconnected();
    policy.failed();
    vi.advanceTimersByTime(60_000);
    expect(republish).toHaveBeenCalledTimes(1);
  });

  it('retries a rejected offer too, since the next offer is a fresh one', () => {
    policy.failed();
    vi.advanceTimersByTime(QUICK_RETRY_MS);
    policy.publishStarted();
    policy.publishFailed('rejected');
    vi.advanceTimersByTime(1000);
    expect(republish).toHaveBeenCalledTimes(2);
    expect(stops).toEqual([]);
  });

  it('stops for good when the server says ended, off, limit or auth', () => {
    for (const reason of ['ended', 'off', 'limit', 'auth'] as const) {
      republish = vi.fn();
      stops = [];
      policy = make();
      policy.publishStarted();
      policy.publishFailed(reason);
      expect(stops).toEqual([reason]);
      policy.failed();
      policy.disconnected();
      policy.online();
      vi.advanceTimersByTime(120_000);
      expect(republish).not.toHaveBeenCalled();
      expect(policy.waiting).toBe(false);
    }
  });

  it("stops itself below the server's attempt cap", () => {
    expect(HOST_MAX_ATTEMPTS).toBeLessThan(LIVE_MAX_PUBLISH_ATTEMPTS);
    expect(HOST_MAX_ATTEMPTS).toBeGreaterThan(10);

    policy = make(4);
    policy.publishStarted(); // attempt 1
    policy.publishFailed('retry');
    for (let attempt = 2; attempt <= 4; attempt++) {
      vi.advanceTimersByTime(20_000);
      expect(republish).toHaveBeenCalledTimes(attempt - 1);
      policy.publishStarted();
      policy.publishFailed('retry');
    }
    expect(policy.attemptsUsed).toBe(4);
    vi.advanceTimersByTime(20_000);
    // No fifth attempt: it stops, and says why.
    expect(republish).toHaveBeenCalledTimes(3);
    expect(stops).toEqual(['limit']);
  });

  it('carries attempts over from before a reload', () => {
    policy = make(5);
    policy.seedAttempts(4);
    policy.publishStarted();
    expect(policy.attemptsUsed).toBe(5);
    policy.publishFailed('retry');
    vi.advanceTimersByTime(20_000);
    expect(stops).toEqual(['limit']);
  });

  it('does nothing after shutdown', () => {
    policy.disconnected();
    policy.shutdown();
    vi.advanceTimersByTime(60_000);
    policy.failed();
    policy.publishFailed('retry');
    vi.advanceTimersByTime(60_000);
    expect(republish).not.toHaveBeenCalled();
    expect(stops).toEqual([]);
  });
});

describe('device helpers', () => {
  it('detects the platform, iPad included', () => {
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) Safari')).toBe(
      'ios'
    );
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/140')).toBe('android');
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', 5)).toBe('ios');
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', 0)).toBe(
      'other'
    );
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0) Chrome/140')).toBe('other');
  });

  it('classifies camera errors', () => {
    const named = (name: string) => Object.assign(new Error(name), { name });
    expect(classifyMediaError(named('NotAllowedError'))).toBe('blocked');
    expect(classifyMediaError(named('SecurityError'))).toBe('blocked');
    expect(classifyMediaError(named('NotFoundError'))).toBe('not_found');
    expect(classifyMediaError(named('NotReadableError'))).toBe('in_use');
    expect(classifyMediaError(named('TypeError'))).toBe('unsupported');
    expect(classifyMediaError(named('SomethingNew'))).toBe('other');
    expect(classifyMediaError(null)).toBe('other');
  });

  it('mutes and unmutes the microphone without touching the camera', () => {
    const audio = [{ enabled: true }, { enabled: true }];
    const video = [{ enabled: true }];
    const stream = { getAudioTracks: () => audio, getVideoTracks: () => video };
    expect(setMicrophoneEnabled(stream, false)).toBe(2);
    expect(audio.map((t) => t.enabled)).toEqual([false, false]);
    expect(video[0].enabled).toBe(true);
    // Already muted: nothing to change.
    expect(setMicrophoneEnabled(stream, false)).toBe(0);
    expect(setMicrophoneEnabled(stream, true)).toBe(2);
    expect(audio.map((t) => t.enabled)).toEqual([true, true]);
    expect(setMicrophoneEnabled(null, false)).toBe(0);
  });

  it('requires the camera asked for first, and only then merely prefers it', () => {
    for (const which of ['environment', 'user'] as const) {
      const [first, second] = cameraAttempts(which);
      expect(first.facingMode).toEqual({ exact: which });
      expect(second.facingMode).toBe(which);
      // The same size on every attempt, so a flip keeps the picture's size.
      for (const attempt of [first, second]) {
        expect(attempt.width).toEqual({ ideal: 1280 });
        expect(attempt.height).toEqual({ ideal: 720 });
      }
    }
    expect(cameraAttempts('environment').length).toBe(2);
  });

  it('only loosens the request when the camera asked for does not exist', () => {
    const named = (name: string) => Object.assign(new Error(name), { name });
    expect(isConstraintFailure(named('OverconstrainedError'))).toBe(true);
    expect(isConstraintFailure(named('NotFoundError'))).toBe(true);
    // A refusal must surface as a refusal, not be retried as a looser request.
    expect(isConstraintFailure(named('NotAllowedError'))).toBe(false);
    expect(isConstraintFailure(named('NotReadableError'))).toBe(false);
    expect(isConstraintFailure(null)).toBe(false);
  });

  it('says what to change when access is blocked, differently for iPhone and Android', () => {
    const ios = mediaHelp('blocked', 'ios');
    const android = mediaHelp('blocked', 'android');
    expect(ios.title).toBe('Camera or microphone access is blocked');
    expect(ios.steps.join(' ')).toMatch(/Settings app/);
    expect(ios.steps.join(' ')).toMatch(/Safari/);
    expect(ios.steps.join(' ')).toMatch(/Chrome/);
    expect(android.steps.join(' ')).toMatch(/address bar/);
    expect(android.steps.join(' ')).toMatch(/Android Settings/);
    expect(ios.steps).not.toEqual(android.steps);
    for (const help of [ios, android, mediaHelp('blocked', 'other')]) {
      expect(help.steps.length).toBeGreaterThanOrEqual(3);
      expect(help.steps.at(-1)).toMatch(/reload/i);
    }
  });

  it('points an in-app browser at the real browser', () => {
    expect(mediaHelp('unsupported', 'ios').steps[0]).toMatch(/Safari/);
    expect(mediaHelp('unsupported', 'android').steps[0]).toMatch(/Chrome/);
  });

  it('gives every problem a title and at least one step', () => {
    for (const problem of ['blocked', 'not_found', 'in_use', 'unsupported', 'other'] as const) {
      for (const platform of ['ios', 'android', 'other'] as const) {
        const help = mediaHelp(problem, platform);
        expect(help.title.length).toBeGreaterThan(10);
        expect(help.steps.length).toBeGreaterThan(0);
      }
    }
  });

  it('remembers the 18+ confirmation per account, on this device', () => {
    const storage = memoryStorage();
    expect(hasConfirmedAge(PUBKEY, storage)).toBe(false);
    expect(rememberAgeConfirmed(PUBKEY, storage)).toBe(true);
    expect(hasConfirmedAge(PUBKEY, storage)).toBe(true);
    expect(hasConfirmedAge('d'.repeat(64), storage)).toBe(false);
    expect(hasConfirmedAge('', storage)).toBe(false);
    expect(hasConfirmedAge(PUBKEY, undefined)).toBe(false);
  });

  it('asks again, and does not throw, when storage is unavailable', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      }
    };
    expect(hasConfirmedAge(PUBKEY, broken)).toBe(false);
    expect(rememberAgeConfirmed(PUBKEY, broken)).toBe(false);
    expect(loadStoredSession(broken, PUBKEY)).toBeNull();
    expect(() =>
      storeSession(broken, { id: ID, token: TOKEN, pubkey: PUBKEY, title: 't', attempts: 1 })
    ).not.toThrow();
    expect(() => clearStoredSession(broken)).not.toThrow();
  });

  it('keeps the session across a reload, for the same account only', () => {
    const storage = memoryStorage();
    storeSession(storage, { id: ID, token: TOKEN, pubkey: PUBKEY, title: 'Paella', attempts: 3 });
    expect(loadStoredSession(storage, PUBKEY)).toEqual({
      id: ID,
      token: TOKEN,
      pubkey: PUBKEY,
      title: 'Paella',
      attempts: 3
    });
    expect(loadStoredSession(storage, 'd'.repeat(64))).toBeNull();
    clearStoredSession(storage);
    expect(loadStoredSession(storage, PUBKEY)).toBeNull();
  });

  it('rejects a stored session that is malformed', () => {
    const storage = memoryStorage();
    for (const raw of [
      'not json',
      '{}',
      JSON.stringify({ id: 'short', token: TOKEN, pubkey: PUBKEY }),
      JSON.stringify({ id: ID, token: 'short', pubkey: PUBKEY })
    ]) {
      storage.data.set('zc_live_host_session', raw);
      expect(loadStoredSession(storage, PUBKEY)).toBeNull();
    }
  });

  it('reads the recipe handed over from a recipe page, and nothing malformed', () => {
    const ok = readRecipeHandoff(
      new URLSearchParams({ a: `30023:${PUBKEY}:sunday-loaf`, title: '  Sunday loaf ' })
    );
    expect(ok).toEqual({ recipeA: `30023:${PUBKEY}:sunday-loaf`, title: 'Sunday loaf' });
    expect(readRecipeHandoff(new URLSearchParams({ a: `35000:${PUBKEY}:premium` }))).toEqual({
      recipeA: `35000:${PUBKEY}:premium`,
      title: 'Live from Zap Cooking'
    });
    expect(
      readRecipeHandoff(new URLSearchParams({ a: `1:${PUBKEY}:note`, title: 'x' }))
    ).toBeNull();
    expect(readRecipeHandoff(new URLSearchParams({ a: '30023:nothex:slug' }))).toBeNull();
    expect(readRecipeHandoff(new URLSearchParams({ title: 'No recipe' }))).toBeNull();
    expect(
      readRecipeHandoff(new URLSearchParams({ a: `30023:${PUBKEY}:x`, title: 'y'.repeat(300) }))!
        .title.length
    ).toBe(120);
  });
});

describe('liveDurationLine', () => {
  it('says how long the host was live', () => {
    expect(liveDurationLine(12)).toBe('You were live for less than a minute');
    expect(liveDurationLine(60)).toBe('You were live for 1 minute');
    expect(liveDurationLine(12 * 60 + 40)).toBe('You were live for 12 minutes');
    expect(liveDurationLine(3600)).toBe('You were live for 1 hour');
    expect(liveDurationLine(3600 + 5 * 60)).toBe('You were live for 1 hour 5 minutes');
    expect(liveDurationLine(2 * 3600 + 60)).toBe('You were live for 2 hours 1 minute');
  });
  it('says nothing when there is nothing sensible to say', () => {
    expect(liveDurationLine(null)).toBeNull();
    expect(liveDurationLine(-5)).toBeNull();
    expect(liveDurationLine(Number.NaN)).toBeNull();
  });
});
