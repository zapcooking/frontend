import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REACTION,
  FAILED_SIGN_GAP_MS,
  LIKE_KIND,
  LikePacer,
  PUBLISH_MIN_GAP_MS,
  ReactionIntake,
  SIGN_ABANDON_MS,
  SLOW_SIGN_GAP_MS,
  SLOW_SIGN_MS,
  blockedBy,
  goLiveAddress,
  hasTargets,
  pointsAt,
  reactionFilters,
  reactionOf,
  reactionTags,
  reactionTargets,
  targetsKey,
  type ReactionEventLike,
  type ReactionTargets
} from './liveReactions';

const HOST = 'b'.repeat(64);
const NOTE = 'a'.repeat(64);
const VIEWER = 'c'.repeat(64);
const SESSION = 'sess_01HZX';
const ADDRESS = `30311:${HOST}:${SESSION}`;

const goLive = (noteId: string | null) => ({
  key: `zc:${SESSION}`,
  host: HOST,
  sessionId: SESSION,
  noteId
});

let n = 0;
function like(over: Partial<ReactionEventLike> = {}): ReactionEventLike {
  n += 1;
  return {
    id: n.toString(16).padStart(64, '0'),
    pubkey: VIEWER,
    kind: LIKE_KIND,
    content: 'fire',
    tags: [
      ['e', NOTE],
      ['a', ADDRESS]
    ],
    ...over
  };
}

describe('reaction targets', () => {
  it('a Go live session with a note has both the note and the address', () => {
    expect(reactionTargets(goLive(NOTE))).toEqual({ e: NOTE, a: ADDRESS });
  });

  it('a Go live session with the note off still has the address', () => {
    const targets = reactionTargets(goLive(null));
    expect(targets).toEqual({ e: null, a: ADDRESS });
    expect(hasTargets(targets)).toBe(true);
  });

  it('a NIP-53 stream uses its own address', () => {
    const key = `30311:${HOST}:show`;
    expect(reactionTargets({ key, host: 'd'.repeat(64) })).toEqual({ e: null, a: key });
  });

  it('the same session reached by its announcement gets the same address', () => {
    // Opened from the live directory: the key is the announcement address.
    expect(reactionTargets({ key: ADDRESS, host: HOST }).a).toBe(reactionTargets(goLive(null)).a);
  });

  it('nothing to hang a reaction on gives no targets', () => {
    expect(hasTargets(reactionTargets(null))).toBe(false);
    expect(hasTargets(reactionTargets({ key: 'url:https://x.test/a.m3u8', host: '' }))).toBe(false);
    expect(reactionTargets({ ...goLive('not-an-id') }).e).toBeNull();
  });

  it('builds the address only from a real pubkey and a session id', () => {
    expect(goLiveAddress(HOST, SESSION)).toBe(ADDRESS);
    expect(goLiveAddress(HOST.toUpperCase(), SESSION)).toBe(ADDRESS);
    expect(goLiveAddress('npub1abc', SESSION)).toBeNull();
    expect(goLiveAddress(HOST, '')).toBeNull();
    expect(goLiveAddress(null, SESSION)).toBeNull();
  });

  it('the key changes when the note arrives', () => {
    expect(targetsKey(reactionTargets(goLive(null)))).not.toBe(
      targetsKey(reactionTargets(goLive(NOTE)))
    );
  });
});

describe('reaction tags and filters', () => {
  it('a like carries both tags when the stream has a note', () => {
    expect(reactionTags({ e: NOTE, a: ADDRESS })).toEqual([
      ['e', NOTE],
      ['a', ADDRESS]
    ]);
  });

  it('a like on a stream with the note off carries the address', () => {
    expect(reactionTags({ e: null, a: ADDRESS })).toEqual([['a', ADDRESS]]);
    expect(reactionTags({ e: null, a: null })).toEqual([]);
  });

  it('subscribes to both targets, one filter each', () => {
    expect(reactionFilters({ e: NOTE, a: ADDRESS })).toEqual([
      { kinds: [LIKE_KIND], '#e': [NOTE] },
      { kinds: [LIKE_KIND], '#a': [ADDRESS] }
    ]);
    expect(reactionFilters({ e: null, a: ADDRESS })).toEqual([
      { kinds: [LIKE_KIND], '#a': [ADDRESS] }
    ]);
    expect(reactionFilters({ e: null, a: null })).toEqual([]);
  });

  it('matches an event tagged with either target', () => {
    const targets: ReactionTargets = { e: NOTE, a: ADDRESS };
    expect(pointsAt([['e', NOTE]], targets)).toBe(true);
    expect(pointsAt([['a', ADDRESS]], targets)).toBe(true);
    expect(pointsAt([['e', 'f'.repeat(64)]], targets)).toBe(false);
    expect(pointsAt([['a', `30311:${HOST}:other`]], targets)).toBe(false);
    expect(pointsAt([['e', NOTE]], { e: null, a: ADDRESS })).toBe(false);
  });
});

describe('reaction ids', () => {
  it('known ids pass, anything else is the default heart', () => {
    expect(reactionOf('fire')).toBe('fire');
    expect(reactionOf(' shaka ')).toBe('shaka');
    expect(reactionOf('🍆')).toBe(DEFAULT_REACTION);
    expect(reactionOf('<img src=x>')).toBe(DEFAULT_REACTION);
    expect(reactionOf('constructor')).toBe(DEFAULT_REACTION);
    expect(reactionOf('')).toBe(DEFAULT_REACTION);
    expect(reactionOf(null)).toBe(DEFAULT_REACTION);
  });
});

describe('ReactionIntake', () => {
  const targets: ReactionTargets = { e: NOTE, a: ADDRESS };

  it('emits the reaction an event names', () => {
    const intake = new ReactionIntake({ targets });
    expect(intake.accept(like({ content: 'hundred' }))).toBe('hundred');
    expect(intake.accept(like({ content: 'whatever' }))).toBe(DEFAULT_REACTION);
  });

  it('counts an event once, however many times it arrives', () => {
    const intake = new ReactionIntake({ targets });
    const event = like();
    expect(intake.accept(event)).toBe('fire');
    // Again from the #a filter, and again from another relay.
    expect(intake.accept(event)).toBeNull();
    expect(intake.accept({ ...event })).toBeNull();
  });

  it('accepts old-style likes with one tag', () => {
    const intake = new ReactionIntake({ targets });
    expect(intake.accept(like({ tags: [['e', NOTE]] }))).toBe('fire');
    expect(intake.accept(like({ tags: [['a', ADDRESS]] }))).toBe('fire');
  });

  it('with the note off, only the address counts', () => {
    const intake = new ReactionIntake({ targets: { e: null, a: ADDRESS } });
    expect(intake.accept(like({ tags: [['a', ADDRESS]] }))).toBe('fire');
    expect(intake.accept(like({ tags: [['e', NOTE]] }))).toBeNull();
  });

  it('drops events for another stream, of another kind, or malformed', () => {
    const intake = new ReactionIntake({ targets });
    expect(intake.accept(like({ tags: [['a', `30311:${HOST}:other`]] }))).toBeNull();
    expect(intake.accept(like({ tags: [] }))).toBeNull();
    expect(intake.accept(like({ kind: 7 }))).toBeNull();
    expect(intake.accept(like({ id: '' }))).toBeNull();
    expect(intake.accept(like({ pubkey: 'nope' }))).toBeNull();
  });

  it("drops the viewer's own likes, read at arrival time", () => {
    let me = '';
    const intake = new ReactionIntake({ targets, self: () => me });
    expect(intake.accept(like())).toBe('fire');
    me = VIEWER; // signed in later
    expect(intake.accept(like())).toBeNull();
  });

  it('the host page (no self) shows the host account\'s own likes from another device', () => {
    const intake = new ReactionIntake({ targets });
    expect(intake.accept(like({ pubkey: HOST }))).toBe('fire');
  });

  it('drops muted, host-hidden and hidden-everywhere pubkeys', () => {
    const muted = 'd'.repeat(64);
    const hostHidden = 'e'.repeat(64);
    const adminHidden = 'f'.repeat(64);
    const intake = new ReactionIntake({
      targets,
      isBlocked: blockedBy([muted], new Set([hostHidden]), [adminHidden])
    });
    expect(intake.accept(like({ pubkey: muted }))).toBeNull();
    expect(intake.accept(like({ pubkey: hostHidden }))).toBeNull();
    expect(intake.accept(like({ pubkey: adminHidden }))).toBeNull();
    expect(intake.accept(like({ pubkey: VIEWER }))).toBe('fire');
  });

  it('applies a hide made after the feed opened', () => {
    const hidden = new Set<string>();
    const intake = new ReactionIntake({ targets, isBlocked: (pk) => hidden.has(pk) });
    expect(intake.accept(like())).toBe('fire');
    hidden.add(VIEWER);
    expect(intake.accept(like())).toBeNull();
    hidden.delete(VIEWER);
    expect(intake.accept(like())).toBe('fire');
  });

  it('a blocked event stays counted, so a relay echo cannot show it later', () => {
    const hidden = new Set<string>([VIEWER]);
    const intake = new ReactionIntake({ targets, isBlocked: (pk) => hidden.has(pk) });
    const event = like();
    expect(intake.accept(event)).toBeNull();
    hidden.clear();
    expect(intake.accept(event)).toBeNull();
  });

  it('forgets the oldest ids past its limit', () => {
    const intake = new ReactionIntake({ targets, remember: 2 });
    const first = like();
    intake.accept(first);
    intake.accept(like());
    intake.accept(like());
    expect(intake.accept(first)).toBe('fire');
  });

  it('blockedBy ignores missing lists', () => {
    const blocked = blockedBy(null, undefined, [VIEWER]);
    expect(blocked(VIEWER)).toBe(true);
    expect(blocked(HOST)).toBe(false);
  });
});

describe('LikePacer', () => {
  /** A 5 s hold: the button asks every 90 ms. Returns how many requests went out. */
  function hold(pacer: LikePacer, from: number, answer: (t: number) => number | null, ms = 5000) {
    const pending: { token: number; at: number }[] = [];
    let requests = 0;
    for (let t = from; t <= from + ms; t += 90) {
      for (const p of [...pending]) {
        if (p.at <= t) {
          pacer.finish(p.token, p.at, true);
          pending.splice(pending.indexOf(p), 1);
        }
      }
      if (pacer.canStart(t)) {
        const token = pacer.start(t);
        requests += 1;
        const at = answer(t);
        if (at !== null) pending.push({ token, at });
      }
    }
    return requests;
  }

  it('a fast signer gets one request per gap', () => {
    const requests = hold(new LikePacer(), 0, (t) => t + 5);
    expect(requests).toBeGreaterThanOrEqual(Math.floor(5000 / (PUBLISH_MIN_GAP_MS + 90)));
    expect(requests).toBeLessThanOrEqual(Math.ceil(5000 / PUBLISH_MIN_GAP_MS) + 1);
  });

  it('no two requests of a hold fall in the same second (they would be one event)', () => {
    const pacer = new LikePacer();
    const seconds: number[] = [];
    for (let t = 250; t <= 10_250; t += 90) {
      if (!pacer.canStart(t)) continue;
      pacer.finish(pacer.start(t), t + 5, true);
      seconds.push(Math.floor((t + 5) / 1000));
    }
    expect(seconds.length).toBeGreaterThan(5);
    expect(new Set(seconds).size).toBe(seconds.length);
  });

  it('a signer that waits for a person gets one request for the whole hold', () => {
    // Approve is tapped 8 s later: nothing else was asked meanwhile.
    expect(hold(new LikePacer(), 0, (t) => t + 8000)).toBe(1);
  });

  it('never has two requests out at once', () => {
    const pacer = new LikePacer();
    const token = pacer.start(0);
    expect(pacer.canStart(PUBLISH_MIN_GAP_MS + 1)).toBe(false);
    pacer.finish(token, PUBLISH_MIN_GAP_MS + 200, true);
    expect(pacer.canStart(PUBLISH_MIN_GAP_MS + 201)).toBe(true);
  });

  it('a slow answer spaces the next request out', () => {
    const pacer = new LikePacer();
    const token = pacer.start(0);
    const answered = SLOW_SIGN_MS + 500;
    pacer.finish(token, answered, true);
    expect(pacer.canStart(answered + SLOW_SIGN_GAP_MS - 1)).toBe(false);
    expect(pacer.canStart(answered + SLOW_SIGN_GAP_MS)).toBe(true);
  });

  it('a slow bunker settles to about one request per answer plus the slow gap', () => {
    // Each signature takes 2 s: 5 s of holding asks at 0 only (answer at 2 s, next at 7 s).
    expect(hold(new LikePacer(), 0, (t) => t + 2000)).toBe(1);
  });

  it('a refusal stops the asking for a while', () => {
    const pacer = new LikePacer();
    const token = pacer.start(0);
    pacer.finish(token, 3000, false);
    expect(pacer.canStart(3000 + FAILED_SIGN_GAP_MS - 1)).toBe(false);
    expect(pacer.canStart(3000 + FAILED_SIGN_GAP_MS)).toBe(true);
  });

  it('a request never answered is given up on, and its late answer is ignored', () => {
    const pacer = new LikePacer();
    const stale = pacer.start(0);
    expect(pacer.canStart(SIGN_ABANDON_MS - 1)).toBe(false);
    expect(pacer.canStart(SIGN_ABANDON_MS)).toBe(true);
    const fresh = pacer.start(SIGN_ABANDON_MS);
    pacer.finish(stale, SIGN_ABANDON_MS + 10, false);
    // The newer request is still out.
    expect(pacer.canStart(SIGN_ABANDON_MS + PUBLISH_MIN_GAP_MS + 10)).toBe(false);
    pacer.finish(fresh, SIGN_ABANDON_MS + 20, true);
    expect(pacer.canStart(SIGN_ABANDON_MS + PUBLISH_MIN_GAP_MS)).toBe(true);
  });
});
