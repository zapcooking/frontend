/**
 * Tests for the relay half of the acceptance script
 * (scripts/schedule-test-post.ts): read the note back as its author,
 * delete it with a kind 5, confirm it is gone.
 *
 * The relay is a local stand-in for pantry, on a loopback port. It
 * models what the member-relay source and a production run showed:
 * reads of a kind 1 need NIP-42 auth and a filter of authors:[self],
 * and a kind 5 only deletes for the authenticated author. Nothing here
 * touches a real relay.
 *
 * `challenge` is when the stand-in sends its AUTH challenge:
 *   'lazy'       only when a request needs auth (deployed pantry)
 *   'on-connect' as the first frame (the variant the script first assumed)
 *   'never'      it demands auth but never challenges (a broken relay)
 *   'open'       no auth at all
 */
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { finalizeEvent, generateSecretKey, getPublicKey, nip19, verifyEvent, type Event } from 'nostr-tools';
import { readDeleteConfirm, RelaySession, parseSecretKey, CLEANUP_KEY_ENV } from './schedule-test-post';

interface StandIn {
  challenge: 'lazy' | 'on-connect' | 'never' | 'open';
  /** CLOSED is sent before the AUTH frame instead of after (frame order must not matter). */
  closedBeforeChallenge?: boolean;
  refuseAuth?: boolean;
  /** Accepts the kind 5 but keeps serving the note. */
  ignoreDelete?: boolean;
  /** Unauthenticated kind 5 is refused with "auth-required:" (and a challenge) rather than "error: unauthorized". */
  deleteAsksForAuth?: boolean;
}

const servers: WebSocketServer[] = [];
afterEach(() => {
  for (const wss of servers.splice(0)) {
    for (const client of wss.clients) client.terminate();
    wss.close();
  }
});

function standIn(mode: StandIn, notes: Event[]) {
  const store = new Map(notes.map((n) => [n.id, n]));
  const log: string[] = [];
  const wss = new WebSocketServer({ port: 0 });
  servers.push(wss);
  const url = () => `ws://localhost:${(wss.address() as { port: number }).port}`;

  wss.on('connection', (ws) => {
    let authed = '';
    let challenge = '';
    const send = (frame: unknown[]) => ws.send(JSON.stringify(frame));
    const sendChallenge = () => {
      challenge = `challenge-${Math.random().toString(36).slice(2)}`;
      send(['AUTH', challenge]);
    };
    if (mode.challenge === 'on-connect') sendChallenge();

    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m[0] === 'AUTH') {
        const ev = m[1] as Event;
        const good =
          !mode.refuseAuth &&
          verifyEvent(ev) &&
          ev.kind === 22242 &&
          challenge !== '' &&
          ev.tags.some((t) => t[0] === 'challenge' && t[1] === challenge) &&
          ev.tags.some((t) => t[0] === 'relay' && t[1] === url());
        if (good) authed = ev.pubkey;
        log.push(good ? 'auth-ok' : 'auth-refused');
        send(['OK', ev.id, good, good ? '' : 'restricted: auth refused']);
        return;
      }
      if (m[0] === 'REQ') {
        const [, sub, filter] = m;
        if (mode.challenge !== 'open' && !authed) {
          log.push('req-needs-auth');
          const closed = () => send(['CLOSED', sub, 'auth-required: please authenticate']);
          if (mode.closedBeforeChallenge) closed();
          if (mode.challenge === 'lazy') sendChallenge();
          if (!mode.closedBeforeChallenge) closed();
          return;
        }
        if (mode.challenge !== 'open' && !(filter.authors?.length === 1 && filter.authors[0] === authed)) {
          send(['CLOSED', sub, 'restricted: membership required']);
          return;
        }
        log.push('req-served');
        for (const id of filter.ids ?? []) {
          const note = store.get(id);
          if (note && (!filter.authors || filter.authors.includes(note.pubkey))) send(['EVENT', sub, note]);
        }
        send(['EOSE', sub]);
        return;
      }
      if (m[0] === 'EVENT') {
        const ev = m[1] as Event;
        const author = mode.challenge === 'open' ? ev.pubkey : authed;
        if (ev.kind !== 5 || !verifyEvent(ev)) return send(['OK', ev.id, false, 'invalid: not a deletion']);
        if (!author) {
          log.push('delete-needs-auth');
          if (mode.deleteAsksForAuth) {
            sendChallenge();
            return send(['OK', ev.id, false, 'auth-required: please authenticate']);
          }
          return send(['OK', ev.id, false, 'error: unauthorized: can only delete own events']);
        }
        if (ev.pubkey !== author) return send(['OK', ev.id, false, 'error: unauthorized: can only delete own events']);
        for (const tag of ev.tags) {
          if (tag[0] === 'e' && store.get(tag[1])?.pubkey === author && !mode.ignoreDelete) store.delete(tag[1]);
        }
        log.push('delete-accepted');
        send(['OK', ev.id, true, '']);
      }
    });
  });
  return { url, store, log };
}

const sk = generateSecretKey();
const otherSk = generateSecretKey();
const noteBy = (key: Uint8Array, content = 'scheduled test note') =>
  finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content }, key);

const fast = { stepTimeoutMs: 400, goneCheckIntervalMs: 5 };
function run(relay: ReturnType<typeof standIn>, note: Event, expected: Event | null = note, key = sk) {
  const steps: string[] = [];
  const done = readDeleteConfirm(relay.url(), key, note.id, expected, {
    ...fast,
    onStep: (stage, msg) => steps.push(`${stage}: ${msg}`)
  });
  return { steps, done };
}

describe('read, delete, confirm gone', () => {
  it('lazy challenge (deployed pantry): the REQ is sent first, auth follows the refusal, then it is resent', async () => {
    const note = noteBy(sk);
    const relay = standIn({ challenge: 'lazy' }, [note]);
    const { steps, done } = run(relay, note);
    await done;

    expect(relay.store.size).toBe(0);
    expect(relay.log).toEqual(['req-needs-auth', 'auth-ok', 'req-served', 'delete-accepted', 'req-served']);
    expect(steps).toHaveLength(3);
    expect(steps[0]).toContain('authenticated as the key');
    expect(steps[2]).toContain('no longer returns the note');
  });

  it('lazy challenge with CLOSED arriving before the AUTH frame', async () => {
    const note = noteBy(sk);
    const relay = standIn({ challenge: 'lazy', closedBeforeChallenge: true }, [note]);
    await run(relay, note).done;
    expect(relay.store.size).toBe(0);
    expect(relay.log).toEqual(['req-needs-auth', 'auth-ok', 'req-served', 'delete-accepted', 'req-served']);
  });

  it('challenge on connect: answered before the first REQ, so nothing is refused', async () => {
    const note = noteBy(sk);
    const relay = standIn({ challenge: 'on-connect' }, [note]);
    // Let the challenge land before the script's first request.
    const { done } = run(relay, note);
    await done;
    expect(relay.store.size).toBe(0);
    expect(relay.log.filter((l) => l === 'auth-ok')).toHaveLength(1);
    expect(relay.log.slice(-3)).toEqual(['req-served', 'delete-accepted', 'req-served']);
  });

  it('a relay that asks for no auth at all still works, and says so', async () => {
    const note = noteBy(sk);
    const relay = standIn({ challenge: 'open' }, [note]);
    const { steps, done } = run(relay, note);
    await done;
    expect(relay.store.size).toBe(0);
    expect(relay.log).toEqual(['req-served', 'delete-accepted', 'req-served']);
    expect(steps[0]).toContain('did not ask for auth');
  });

  it('cleanup form (no expected event): the kind comes from what the relay returns', async () => {
    const note = noteBy(sk);
    const relay = standIn({ challenge: 'lazy' }, [note]);
    const { steps, done } = run(relay, note, null);
    await done;
    expect(relay.store.size).toBe(0);
    expect(steps[0]).toContain('kind 1');
  });

  it('only the asked-for note is deleted', async () => {
    const note = noteBy(sk, 'delete me');
    const keep = noteBy(sk, 'keep me');
    const relay = standIn({ challenge: 'lazy' }, [note, keep]);
    await run(relay, note).done;
    expect([...relay.store.keys()]).toEqual([keep.id]);
  });
});

describe('failures are reported, never passed off as success', () => {
  it('the note is not there', async () => {
    const note = noteBy(sk);
    const relay = standIn({ challenge: 'lazy' }, []);
    await expect(run(relay, note).done).rejects.toThrow(/is not on ws:\/\/localhost:\d+ for pubkey/);
    expect(relay.log).not.toContain('delete-accepted');
  });

  it('the key is not the author: nothing is found and nothing is deleted', async () => {
    const note = noteBy(sk);
    const relay = standIn({ challenge: 'lazy' }, [note]);
    await expect(run(relay, note, null, otherSk).done).rejects.toThrow(/belongs to a different key/);
    expect(relay.store.size).toBe(1);
    expect(relay.log).not.toContain('delete-accepted');
  });

  it('the relay accepts the kind 5 but keeps serving the note', async () => {
    const note = noteBy(sk);
    const relay = standIn({ challenge: 'lazy', ignoreDelete: true }, [note]);
    await expect(run(relay, note).done).rejects.toThrow(/accepted the kind 5 but still serves event/);
    expect(relay.store.size).toBe(1);
  });

  it('the relay refuses our AUTH', async () => {
    const note = noteBy(sk);
    const relay = standIn({ challenge: 'lazy', refuseAuth: true }, [note]);
    await expect(run(relay, note).done).rejects.toThrow(/refused AUTH: restricted: auth refused/);
  });

  it('the relay demands auth but never sends a challenge', async () => {
    const note = noteBy(sk);
    const relay = standIn({ challenge: 'never' }, [note]);
    await expect(
      readDeleteConfirm(relay.url(), sk, note.id, note, { ...fast, onStep: () => {} })
    ).rejects.toThrow(/asked for auth \("auth-required: please authenticate"\) but sent no AUTH challenge/);
  }, 10_000);

  it('the relay returns a note with different content than was scheduled', async () => {
    const note = noteBy(sk);
    const relay = standIn({ challenge: 'lazy' }, [note]);
    const tampered = { ...note, content: 'something else' };
    await expect(run(relay, note, tampered).done).rejects.toThrow(/different event than the one scheduled/);
    expect(relay.store.size).toBe(1);
  });
});

describe('publishing before any read (the EVENT is what meets the auth wall)', () => {
  const deletionOf = (note: Event) =>
    finalizeEvent(
      { kind: 5, created_at: Math.floor(Date.now() / 1000), tags: [['e', note.id], ['k', '1']], content: '' },
      sk
    );

  it('OK false "auth-required:" with a challenge: authenticates and sends the event again', async () => {
    const note = noteBy(sk);
    const relay = standIn({ challenge: 'lazy', deleteAsksForAuth: true }, [note]);
    const session = new RelaySession(relay.url(), sk, 400);
    await session.open();
    await session.publish(deletionOf(note));
    session.close();
    expect(relay.log).toEqual(['delete-needs-auth', 'auth-ok', 'delete-accepted']);
    expect(relay.store.size).toBe(0);
    expect(session.authenticated).toBe(true);
  });

  it('refused with no challenge on offer: fails with the relay reason and says it was not authenticated', async () => {
    const note = noteBy(sk);
    const relay = standIn({ challenge: 'lazy' }, [note]);
    const session = new RelaySession(relay.url(), sk, 400);
    await session.open();
    await expect(session.publish(deletionOf(note))).rejects.toThrow(
      /refused the kind 5 event: error: unauthorized: can only delete own events \(not authenticated: the relay sent no AUTH challenge\)/
    );
    session.close();
    expect(relay.store.size).toBe(1);
  });
});

describe('cleanup key', () => {
  const hex = Buffer.from(sk).toString('hex');

  it('accepts an nsec or 64 hex characters, with surrounding whitespace', () => {
    expect(getPublicKey(parseSecretKey(nip19.nsecEncode(sk)))).toBe(getPublicKey(sk));
    expect(getPublicKey(parseSecretKey(` ${hex}\n`))).toBe(getPublicKey(sk));
    expect(getPublicKey(parseSecretKey(hex.toUpperCase()))).toBe(getPublicKey(sk));
  });

  it('refuses anything else without repeating what it was given', () => {
    for (const bad of [undefined, '', 'npub1notasecret', nip19.npubEncode(getPublicKey(sk)), hex.slice(1), 'hunter2']) {
      let message = '';
      try {
        parseSecretKey(bad);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message, String(bad)).toContain(CLEANUP_KEY_ENV);
      if (bad) expect(message).not.toContain(bad);
    }
  });
});
