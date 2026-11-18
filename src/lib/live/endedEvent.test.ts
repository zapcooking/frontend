/**
 * Tests for the pre-signed "ended" announcement: the shared rules, the
 * store (real SQLite, migration 0011, real signatures) and the publish
 * step (scripted relay sockets; nothing here opens a connection).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { createLiveDatabase } from '../../test/liveDatabase';
import { liveAnnouncementTemplate } from './liveNote';
import {
  ENDED_EVENT_MAX_BYTES,
  endedEventProblem,
  endedTwinTemplate,
  isPublicRelayUrl,
  pickHostRelays,
  type SignedEvent
} from './endedEvent';
import {
  ENDED_PUBLISH_MAX_TRIES,
  dropEndedEvent,
  endedFixedRelays,
  parseRelaysOverride,
  publishHeldEnded,
  publishPendingEnded,
  readEndedEvent,
  storeEndedEvent
} from './endedEvent.server';
import { runLiveSweep } from './sweep.server';
import type { WebSocketLike } from '$lib/rawPublish';

const NOW = 1_800_000_000;
const ID = 'ab'.repeat(16);
const hostSk = generateSecretKey();
const HOST = getPublicKey(hostSk);
const otherSk = generateSecretKey();
const WATCH = `https://zap.cooking/live/s/${ID}`;

function liveTemplate(at: number, id = ID) {
  return liveAnnouncementTemplate(
    {
      sessionId: id,
      name: 'Sunday roast',
      hostPubkey: HOST,
      joinUrl: `https://zap.cooking/api/live/${id}/join`,
      watchUrl: WATCH,
      pinnedId: 'c'.repeat(64),
      startedAt: NOW - 600,
      status: 'live',
      relays: ['wss://nos.lol']
    },
    at * 1000
  );
}
const twinOf = (at: number, sk = hostSk, id = ID) =>
  // Through JSON: finalizeEvent leaves a "verified" symbol on its result.
  JSON.parse(
    JSON.stringify(finalizeEvent(endedTwinTemplate(liveTemplate(at, id)) as never, sk))
  ) as SignedEvent;

let db: ReturnType<typeof createLiveDatabase>;
let logged: string[];

function row(id = ID, status: 'live' | 'ended' = 'live', host = HOST) {
  db.raw
    .prepare(
      `INSERT INTO live_sessions (id, host_pubkey, title, host_token_hash, status, created_at, started_at, ended_at)
       VALUES (?, ?, 't', 'hash', ?, ?, ?, ?)`
    )
    .run(id, host, status, NOW - 700, NOW - 600, status === 'ended' ? NOW : null);
  return { id, host_pubkey: host, created_at: NOW - 700 };
}
const rowOf = (id = ID) => db.raw.prepare('SELECT * FROM live_sessions WHERE id = ?').get(id);
const endRow = (id = ID) =>
  db.raw.prepare("UPDATE live_sessions SET status = 'ended', ended_at = ? WHERE id = ?").run(NOW, id);

/** Relay sockets that answer each EVENT as scripted, per URL. Records what each was sent. */
function relays(script: Record<string, [boolean, string] | 'silent' | 'error'>) {
  const sent: Record<string, any[]> = {};
  const wsFactory = (url: string): WebSocketLike => {
    const listeners: Record<string, ((ev: any) => void)[]> = {};
    const fire = (type: string, ev: any = {}) => (listeners[type] ?? []).forEach((l) => l(ev));
    queueMicrotask(() => (script[url] === 'error' ? fire('error') : fire('open')));
    return {
      addEventListener: (type, listener) => void (listeners[type] ??= []).push(listener),
      send(data: string) {
        const event = JSON.parse(data)[1];
        (sent[url] ??= []).push(event);
        const answer = script[url] ?? [true, ''];
        if (Array.isArray(answer)) {
          queueMicrotask(() =>
            fire('message', { data: JSON.stringify(['OK', event.id, answer[0], answer[1]]) })
          );
        }
      },
      close() {}
    };
  };
  return { sent, wsFactory };
}

beforeEach(() => {
  db = createLiveDatabase();
  logged = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => void logged.push(String(line)));
});
afterEach(() => vi.restoreAllMocks());

describe('endedTwinTemplate', () => {
  it('is the live announcement one second later, status ended, with ends', () => {
    const live = liveTemplate(NOW);
    const twin = endedTwinTemplate(live);
    expect(twin.kind).toBe(30311);
    expect(twin.created_at).toBe(NOW + 1);
    expect(twin.content).toBe(live.content);
    expect(twin.tags.filter((t) => t[0] === 'status')).toEqual([['status', 'ended']]);
    expect(twin.tags.filter((t) => t[0] === 'ends')).toEqual([['ends', String(NOW + 1)]]);
    const rest = (tags: string[][]) => tags.filter((t) => t[0] !== 'status' && t[0] !== 'ends');
    expect(rest(twin.tags)).toEqual(rest(live.tags));
    // The live template is left as it was.
    expect(live.tags.find((t) => t[0] === 'status')).toEqual(['status', 'live']);
  });
});

describe('isPublicRelayUrl', () => {
  it('takes wss URLs on public hostnames', () => {
    for (const url of ['wss://nos.lol', 'wss://relay.example.com/', 'wss://r.example.org:4443/x']) {
      expect(isPublicRelayUrl(url), url).toBe(true);
    }
  });
  it('refuses everything else', () => {
    for (const url of [
      'ws://nos.lol',
      'https://nos.lol',
      'wss://localhost',
      'wss://localhost:7777',
      'wss://relay.localhost',
      'wss://127.0.0.1',
      'wss://2130706433',
      'wss://0x7f.0.0.1',
      'wss://10.0.0.5:7777',
      'wss://192.168.1.4',
      'wss://[::1]',
      'wss://[fd00::1]:443',
      'wss://printer.local',
      'wss://db.internal',
      'wss://nas.lan',
      'wss://router.home.arpa',
      'wss://intranet',
      'wss://abc.onion',
      'wss://user:pass@nos.lol',
      'wss://nos.lol/ path',
      `wss://${'a'.repeat(200)}.com`,
      '',
      null,
      42
    ]) {
      expect(isPublicRelayUrl(url), String(url)).toBe(false);
    }
  });
  it('keeps at most 8 host relays, without duplicates or the fixed ones', () => {
    const many = Array.from({ length: 12 }, (_, i) => `wss://r${i}.example.com`);
    const picked = pickHostRelays(
      ['wss://nos.lol/', 'wss://127.0.0.1', many[0], many[0] + '/', ...many],
      ['wss://nos.lol']
    );
    expect(picked).toEqual(many.slice(0, 8));
    expect(pickHostRelays('wss://nos.lol')).toEqual([]);
  });
});

describe('endedEventProblem', () => {
  const session = { id: ID, hostPubkey: HOST, createdAt: NOW - 700 };
  const problem = (event: unknown) => endedEventProblem(event, session, NOW);
  it('accepts the twin', () => expect(problem(twinOf(NOW))).toBeNull());
  it('names what is wrong', () => {
    const twin = twinOf(NOW);
    expect(problem({ ...twin, sig: 'zz' })).toBe('shape');
    expect(problem({ ...twin, tags: [['d', 5]] })).toBe('shape');
    expect(problem({ ...twin, kind: 1 })).toBe('kind');
    expect(problem(twinOf(NOW, otherSk))).toBe('pubkey');
    expect(problem(twinOf(NOW, hostSk, 'cd'.repeat(16)))).toBe('d');
    expect(problem({ ...twin, tags: [...twin.tags, ['d', ID]] })).toBe('d');
    expect(problem(finalizeEvent(liveTemplate(NOW) as never, hostSk))).toBe('status');
    expect(problem({ ...twin, tags: [...twin.tags, ['status', 'live']] })).toBe('status');
    expect(problem(twinOf(NOW - 800))).toBe('too_old');
    expect(problem(twinOf(NOW + 120))).toBe('future');
    expect(problem({ ...twin, content: 'x'.repeat(ENDED_EVENT_MAX_BYTES) })).toBe('too_large');
  });
});

describe('storeEndedEvent', () => {
  it('holds a valid twin with the usable host relays, and only a newer one replaces it', async () => {
    const session = row();
    const first = twinOf(NOW - 100);
    expect(
      await storeEndedEvent(
        db,
        session,
        { ...first, extra: 'dropped' },
        ['wss://relay.example.com', 'wss://10.0.0.1', 'wss://nos.lol'],
        { now: NOW }
      )
    ).toEqual({ ok: true, id: first.id });
    expect(JSON.parse(rowOf().ended_event)).toEqual(first);
    expect(JSON.parse(rowOf().ended_event_relays)).toEqual(['wss://relay.example.com']);

    expect(await storeEndedEvent(db, session, first, [], { now: NOW })).toEqual({
      ok: false,
      reason: 'not_newer'
    });
    expect(await storeEndedEvent(db, session, twinOf(NOW - 200), [], { now: NOW })).toEqual({
      ok: false,
      reason: 'not_newer'
    });
    const later = twinOf(NOW - 10);
    expect((await storeEndedEvent(db, session, later, [], { now: NOW })).ok).toBe(true);
    expect(JSON.parse(rowOf().ended_event).id).toBe(later.id);
    expect(JSON.parse(rowOf().ended_event_relays)).toEqual([]);
  });

  it('refuses a bad signature, another key, and a session that has ended', async () => {
    const session = row();
    const twin = twinOf(NOW);
    const forged = { ...twin, sig: twin.sig.replace(/^../, twin.sig.startsWith('00') ? '11' : '00') };
    expect(await storeEndedEvent(db, session, forged, [], { now: NOW })).toEqual({
      ok: false,
      reason: 'invalid',
      problem: 'signature'
    });
    // Signed content changed after signing: the id no longer matches.
    expect(
      await storeEndedEvent(db, session, { ...twin, content: 'changed' }, [], { now: NOW })
    ).toEqual({ ok: false, reason: 'invalid', problem: 'signature' });
    expect(await storeEndedEvent(db, session, twinOf(NOW, otherSk), [], { now: NOW })).toEqual({
      ok: false,
      reason: 'invalid',
      problem: 'pubkey'
    });
    expect(rowOf().ended_event).toBeNull();

    endRow();
    expect(await storeEndedEvent(db, session, twin, [], { now: NOW })).toEqual({
      ok: false,
      reason: 'ended'
    });
    expect(rowOf().ended_event).toBeNull();
  });

  it('is readable by anyone only after the session ended, and can be dropped only before', async () => {
    const session = row();
    const twin = twinOf(NOW);
    await storeEndedEvent(db, session, twin, [], { now: NOW });
    expect(await readEndedEvent(db, ID)).toBeNull();
    endRow();
    expect(await readEndedEvent(db, ID)).toEqual(twin);
    expect(await dropEndedEvent(db, ID)).toBe(false);
    expect(await readEndedEvent(db, ID)).toEqual(twin);

    const open = row('cd'.repeat(16), 'live', 'f'.repeat(64));
    db.raw.prepare("UPDATE live_sessions SET ended_event = '{}' WHERE id = ?").run(open.id);
    expect(await dropEndedEvent(db, open.id)).toBe(true);
    expect(rowOf(open.id).ended_event).toBeNull();
  });
});

describe('publishHeldEnded', () => {
  async function held(hostRelays: string[] = []) {
    const session = row();
    const twin = twinOf(NOW - 5);
    await storeEndedEvent(db, session, twin, hostRelays, { now: NOW });
    return twin;
  }

  it('does nothing while the session is open or when nothing is held', async () => {
    const twin = await held();
    const net = relays({});
    expect(await publishHeldEnded(db, ID, net)).toEqual({ state: 'none' });
    expect(net.sent).toEqual({});
    row('cd'.repeat(16), 'ended', 'f'.repeat(64));
    expect(await publishHeldEnded(db, 'cd'.repeat(16), net)).toEqual({ state: 'none' });
    expect(twin.id).toHaveLength(64);
  });

  it('sends the held event, unchanged, to the fixed relays and the host relays, once', async () => {
    const twin = await held(['wss://relay.example.com']);
    endRow();
    const net = relays({ 'wss://relay.damus.io': [false, 'blocked: no'], 'wss://nostr.wine': 'silent' });
    const outcome = await publishHeldEnded(db, ID, { ...net, timeoutMs: 20 });
    const all = [...endedFixedRelays(), 'wss://relay.example.com'];
    expect(Object.keys(net.sent).sort()).toEqual([...all].sort());
    for (const url of all) expect(net.sent[url]).toEqual([twin]);
    expect(outcome).toEqual({
      state: 'published',
      accepted: all.length - 2,
      newer: 0,
      failed: 2
    });
    expect(rowOf().ended_publish_state).toBe('published');
    expect(logged.some((l) => l.includes(`[LiveEnded] session=${ID}`) && l.includes('state=published'))).toBe(true);

    const again = relays({});
    expect(await publishHeldEnded(db, ID, again)).toEqual({ state: 'none' });
    expect(again.sent).toEqual({});
  });

  it('counts "have a newer one" as settled: the host page got there first', async () => {
    await held();
    endRow();
    const script = Object.fromEntries(
      endedFixedRelays().map((url) => [url, [false, 'replaced: have newer event'] as [boolean, string]])
    );
    const outcome = await publishHeldEnded(db, ID, relays(script));
    expect(outcome.state).toBe('published');
    expect(rowOf().ended_publish_state).toBe('published');
  });

  it('retries when no relay takes it, and gives up after the last try', async () => {
    await held();
    endRow();
    const down = Object.fromEntries(endedFixedRelays().map((url) => [url, 'error' as const]));
    for (let attempt = 1; attempt < ENDED_PUBLISH_MAX_TRIES; attempt++) {
      expect((await publishHeldEnded(db, ID, relays(down))).state).toBe('retry');
      expect(rowOf().ended_publish_tries).toBe(attempt);
      expect(rowOf().ended_publish_state).toBeNull();
    }
    expect((await publishHeldEnded(db, ID, relays(down))).state).toBe('gave_up');
    expect(rowOf().ended_publish_state).toBe('gave_up');
    expect(await publishHeldEnded(db, ID, relays({}))).toEqual({ state: 'none' });
  });

  it('a later try succeeds after an earlier failure', async () => {
    await held();
    endRow();
    const down = Object.fromEntries(endedFixedRelays().map((url) => [url, 'error' as const]));
    expect((await publishHeldEnded(db, ID, relays(down))).state).toBe('retry');
    expect((await publishHeldEnded(db, ID, relays({}))).state).toBe('published');
  });

  it('with an override, publishes there and nowhere else', async () => {
    const twin = await held(['wss://relay.example.com']);
    endRow();
    const net = relays({});
    await publishHeldEnded(db, ID, { ...net, relaysOverride: ['ws://127.0.0.1:7777'] });
    expect(net.sent).toEqual({ 'ws://127.0.0.1:7777': [twin] });
    expect(parseRelaysOverride(' ws://127.0.0.1:7777 , wss://x.example.com,nope ')).toEqual([
      'ws://127.0.0.1:7777',
      'wss://x.example.com'
    ]);
    expect(parseRelaysOverride(undefined)).toBeNull();
    expect(parseRelaysOverride('nope')).toBeNull();
  });

  it('never re-checks host relays into private ones at publish time', async () => {
    await held();
    db.raw
      .prepare('UPDATE live_sessions SET ended_event_relays = ? WHERE id = ?')
      .run(JSON.stringify(['wss://10.0.0.1', 'wss://localhost', 'wss://ok.example.com']), ID);
    endRow();
    const net = relays({});
    await publishHeldEnded(db, ID, net);
    expect(Object.keys(net.sent).sort()).toEqual([...endedFixedRelays(), 'wss://ok.example.com'].sort());
  });
});

describe('the sweep publishes for sessions it ends', () => {
  it('a session past the time limit: ended, then its held event goes out in the same run', async () => {
    const session = row();
    db.raw.prepare('UPDATE live_sessions SET started_at = ? WHERE id = ?').run(NOW - 91 * 60, ID);
    const twin = twinOf(NOW - 30 * 60);
    await storeEndedEvent(db, { ...session, created_at: NOW - 92 * 60 }, twin, [], { now: NOW });
    const net = relays({});
    const summary = await runLiveSweep(db, null, { now: NOW, ended: net });
    expect(summary.ended.timeout).toBe(1);
    expect(summary.endedEvents).toEqual({ published: 1, retry: 0, gaveUp: 0 });
    expect(net.sent['wss://relay.primal.net']).toEqual([twin]);
    expect(rowOf().end_reason).toBe('timeout');
    expect(rowOf().ended_publish_state).toBe('published');
  });

  it('takes two per run, fewest tries first, and skips the step when not asked', async () => {
    const ids = ['1', '2', '3'].map((c) => c.repeat(32));
    for (const [i, id] of ids.entries()) {
      row(id, 'ended');
      db.raw
        .prepare('UPDATE live_sessions SET ended_event = ?, ended_publish_tries = ?, ended_at = ? WHERE id = ?')
        .run(JSON.stringify(twinOf(NOW - 5, hostSk, id)), i === 0 ? 2 : 0, NOW - i, id);
    }
    const skipped = await runLiveSweep(db, null, { now: NOW });
    expect(skipped.endedEvents).toEqual({ published: 0, retry: 0, gaveUp: 0 });

    const first = await publishPendingEnded(db, relays({}));
    expect(first).toEqual({ published: 2, retry: 0, gaveUp: 0 });
    expect(ids.map((id) => rowOf(id).ended_publish_state)).toEqual([null, 'published', 'published']);
    expect(await publishPendingEnded(db, relays({}))).toEqual({ published: 1, retry: 0, gaveUp: 0 });
    expect(await publishPendingEnded(db, relays({}))).toEqual({ published: 0, retry: 0, gaveUp: 0 });
  });

  it('carries on when the publish step throws (migration missing)', async () => {
    const broken = {
      ...db,
      prepare(sql: string) {
        if (sql.includes('ended_publish_state')) throw new Error('no such column');
        return db.prepare(sql);
      }
    };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const summary = await runLiveSweep(broken as never, null, { now: NOW, ended: relays({}) });
    expect(summary.endedEvents).toEqual({ published: 0, retry: 0, gaveUp: 0 });
    expect(summary.outOfTime).toBe(false);
  });
});
