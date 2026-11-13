/**
 * Tests for the Go live sweep. Rows are written straight into real SQLite
 * (migration 0004); Cloudflare is the stub in src/test/liveStreamStub.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createLiveDatabase } from '../../test/liveDatabase';
import { createStreamStub, STUB_ACCOUNT } from '../../test/liveStreamStub';
import { purgeLiveSessions } from './admin.server';
import { runLiveSweep } from './sweep.server';
import type { StreamConfig } from './stream.server';

const NOW = 1_800_000_000;
const MIN = 60;
const DAY = 86400;
const cfg: StreamConfig = {
  accountId: STUB_ACCOUNT,
  token: 'stream-token',
  inputPrefix: 'zc-live-'
};
const HOST = 'a'.repeat(64);
const OTHER_HOST = 'b'.repeat(64);

let db: ReturnType<typeof createLiveDatabase>;
let cf: ReturnType<typeof createStreamStub>;
let logged: string[];
let n = 0;

const hexId = (seed: string) => seed.repeat(32).slice(0, 32);
const uidFor = (seed: string) => `${seed}${'0'.repeat(32)}`.slice(0, 32);

interface RowInit {
  id?: string;
  host?: string;
  status?: 'created' | 'live' | 'ended';
  uid?: string | null;
  created?: number;
  started?: number | null;
  ended?: number | null;
  streak?: number;
}

/** Insert a session row; returns its id. A live row gets an input unless told otherwise. */
function row(init: RowInit = {}): string {
  n++;
  const id = init.id ?? hexId(n.toString(16).padStart(2, '0'));
  const status = init.status ?? 'live';
  const uid =
    init.uid === undefined ? (status === 'live' ? uidFor(`c${n.toString(16)}`) : null) : init.uid;
  // Each host may have only one session that has not ended.
  const host = init.host ?? (status === 'ended' ? HOST : n.toString(16).padStart(64, 'e'));
  db.raw
    .prepare(
      `INSERT INTO live_sessions (id, host_pubkey, title, host_token_hash, status, cf_input_uid, cf_play_url,
                                  created_at, started_at, ended_at, disconnected_streak)
       VALUES (?, ?, 't', 'hash', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      host,
      status,
      uid,
      uid && status === 'live'
        ? `https://customer-x.cloudflarestream.com/${uid}/webRTC/play`
        : null,
      init.created ?? NOW - 5 * MIN,
      init.started === undefined ? (status === 'created' ? null : NOW - 4 * MIN) : init.started,
      init.ended ?? (status === 'ended' ? NOW - MIN : null),
      init.streak ?? 0
    );
  if (uid && status !== 'ended') cf.add({ uid, name: `zc-live-${id}` });
  return id;
}

const get = (id: string) => db.raw.prepare('SELECT * FROM live_sessions WHERE id = ?').get(id);
const sweep = (at = NOW, c: StreamConfig | null = cfg) => runLiveSweep(db, c, { now: at });
const linesFor = (id: string) => logged.filter((l) => l.includes(`session=${id}`));

beforeEach(() => {
  n = 0;
  db = createLiveDatabase();
  cf = createStreamStub();
  cf.install();
  logged = [];
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
  }
});

afterEach(() => {
  // Log lines never carry an input id, an input name, a URL or the token.
  const all = logged.join('\n');
  for (const uid of [...cf.inputs.keys(), ...cf.deletes()]) expect(all).not.toContain(uid);
  expect(all).not.toMatch(/cloudflarestream|stream-token|zc-live-/);
  vi.restoreAllMocks();
});

describe('readings', () => {
  it('leaves a connected session alone and logs nothing for it', async () => {
    const id = row();
    const summary = await sweep();
    expect(summary.examined).toBe(1);
    expect(get(id).status).toBe('live');
    expect(get(id).disconnected_streak).toBe(0);
    expect(linesFor(id)).toEqual([]);
  });

  it('ends a session after two consecutive disconnected readings, not one', async () => {
    const id = row();
    const uid = get(id).cf_input_uid;
    cf.inputs.get(uid)!.state = 'disconnected';
    cf.inputs.get(uid)!.lastSeen = '2026-11-13T20:00:00.000Z';

    const first = await sweep();
    expect(get(id).status).toBe('live');
    expect(get(id).disconnected_streak).toBe(1);
    expect(first.counted).toBe(1);
    expect(first.ended.abandoned).toBe(0);
    expect(cf.inputs.has(uid)).toBe(true);

    const second = await sweep(NOW + MIN);
    const after = get(id);
    expect(after.status).toBe('ended');
    expect(after.end_reason).toBe('abandoned');
    expect(after.ended_at).toBe(NOW + MIN);
    expect(after.cf_input_uid).toBeNull();
    expect(after.host_token_hash).toBe('');
    expect(second.ended.abandoned).toBe(1);
    expect(second.inputsDeleted).toBe(1);
    expect(cf.inputs.has(uid)).toBe(false);

    // Every status it acted on is logged, with the reading and the count.
    expect(linesFor(id)).toEqual([
      `[LiveSweep] session=${id} status=live reading=disconnected last_seen=2026-11-13T20:00:00.000Z streak=0->1 action=counted`,
      `[LiveSweep] session=${id} status=live reading=disconnected last_seen=2026-11-13T20:00:00.000Z streak=1->2 action=end:abandoned`
    ]);
  });

  it('disconnected, connected, disconnected does not end a session', async () => {
    const id = row();
    const input = cf.inputs.get(get(id).cf_input_uid)!;
    input.state = 'disconnected';
    await sweep();
    input.state = 'connected';
    const middle = await sweep(NOW + MIN);
    expect(middle.reset).toBe(1);
    expect(get(id).disconnected_streak).toBe(0);
    input.state = 'disconnected';
    await sweep(NOW + 2 * MIN);
    expect(get(id).status).toBe('live');
    expect(get(id).disconnected_streak).toBe(1);
    expect(linesFor(id).map((l) => l.split('action=')[1])).toEqual(['counted', 'reset', 'counted']);
  });

  it('counts an input that never reported a status, and one that no longer exists', async () => {
    const never = row();
    cf.inputs.get(get(never).cf_input_uid)!.state = null;
    const gone = row();
    cf.inputs.delete(get(gone).cf_input_uid);

    await sweep();
    expect(get(never).disconnected_streak).toBe(1);
    expect(get(gone).disconnected_streak).toBe(1);
    await sweep(NOW + MIN);
    expect(get(never).end_reason).toBe('abandoned');
    expect(get(gone).end_reason).toBe('abandoned');
    expect(linesFor(never)[0]).toContain('reading=none');
    expect(linesFor(gone)[0]).toContain('reading=missing');
  });

  it('changes nothing when the status cannot be read or is not one it acts on', async () => {
    const id = row({ streak: 1 });
    const input = cf.inputs.get(get(id).cf_input_uid)!;

    cf.statusHttp = 500;
    let summary = await sweep();
    expect(summary.unreadable).toBe(1);
    cf.statusHttp = 200;
    cf.statusThrows = true;
    await sweep();
    cf.statusThrows = false;
    input.state = 'reconnecting';
    await sweep();

    expect(get(id).status).toBe('live');
    expect(get(id).disconnected_streak).toBe(1);
    expect(linesFor(id).map((l) => l.match(/reading=(\S+)/)![1])).toEqual([
      'unreadable:http_500',
      'unreadable:timeout',
      'other:reconnecting'
    ]);
    expect(linesFor(id).every((l) => l.endsWith('streak=1->1 action=none'))).toBe(true);
    summary = await sweep();
    expect(summary.ended.abandoned).toBe(0);
  });

  it('treats a session that dropped back to created after being live as not broadcasting', async () => {
    const id = row({ status: 'created', started: NOW - 20 * MIN, uid: null });
    await sweep();
    expect(get(id).status).toBe('created');
    expect(get(id).disconnected_streak).toBe(1);
    await sweep(NOW + MIN);
    expect(get(id).end_reason).toBe('abandoned');
    expect(linesFor(id)[0]).toContain('status=created reading=no_input');
    // No status was read: there is no input to ask about.
    expect(cf.calls.filter((c) => c.startsWith('status:'))).toEqual([]);
  });
});

describe('time limits', () => {
  it('ends a session 90 minutes after it went live, whatever its status', async () => {
    const id = row({ started: NOW - 90 * MIN });
    const uid = get(id).cf_input_uid;
    const young = row({ started: NOW - 89 * MIN });

    const summary = await sweep();
    expect(get(id).status).toBe('ended');
    expect(get(id).end_reason).toBe('timeout');
    expect(cf.inputs.has(uid)).toBe(false);
    expect(summary.ended.timeout).toBe(1);
    expect(get(young).status).toBe('live');
    // The 90-minute rule does not ask Cloudflare first.
    expect(cf.calls).not.toContain(`status:${uid}`);
    expect(linesFor(id)).toEqual([
      `[LiveSweep] session=${id} status=live reading=not_read last_seen=- streak=0->0 action=end:timeout`
    ]);
  });

  it('ends a session that never went live 10 minutes after creation', async () => {
    const old = row({ status: 'created', created: NOW - 10 * MIN });
    const fresh = row({ status: 'created', created: NOW - 9 * MIN });
    const summary = await sweep();
    expect(get(old).status).toBe('ended');
    expect(get(old).end_reason).toBe('never_started');
    expect(get(fresh).status).toBe('created');
    expect(get(fresh).disconnected_streak).toBe(0);
    expect(summary.ended.never_started).toBe(1);
    expect(linesFor(fresh)).toEqual([]);
  });

  it('counts the 90 minutes from the first go-live, not from creation', async () => {
    const id = row({ created: NOW - 200 * MIN, started: NOW - 30 * MIN });
    await sweep();
    expect(get(id).status).toBe('live');
  });
});

describe('running twice', () => {
  it('two sweeps at once end a session once and leave its input deleted', async () => {
    const id = row({ streak: 1 });
    const uid = get(id).cf_input_uid;
    cf.inputs.get(uid)!.state = 'disconnected';
    const [a, b] = await Promise.all([sweep(), sweep()]);
    expect(a.ended.abandoned + b.ended.abandoned).toBe(1);
    expect(get(id).status).toBe('ended');
    expect(get(id).disconnected_streak).toBe(2);
    expect(get(id).ended_at).toBe(NOW);
    expect(get(id).cf_input_uid).toBeNull();
    expect(cf.inputs.has(uid)).toBe(false);
    // The other sweep's retry step may send one more delete for the same
    // input. That is harmless: "already gone" counts as deleted.
    const deletes = cf.deletes().filter((u) => u === uid).length;
    expect(deletes).toBeGreaterThanOrEqual(1);
    expect(deletes).toBeLessThanOrEqual(2);
  });

  it('a second sweep after an end does nothing more', async () => {
    const id = row({ started: NOW - 91 * MIN });
    await sweep();
    cf.calls = [];
    const again = await sweep(NOW + MIN);
    expect(again.examined).toBe(0);
    expect(cf.deletes()).toEqual([]);
    expect(get(id).ended_at).toBe(NOW);
  });
});

describe('inputs left on ended rows', () => {
  it('keeps the input on record when the delete fails at end, and retries it next time', async () => {
    const id = row({ started: NOW - 91 * MIN });
    const uid = get(id).cf_input_uid;
    cf.deleteStatus = 500;
    const first = await sweep();
    expect(first.inputsPending).toBe(1);
    // The same run already tried once more in its retry step.
    expect(first.retried.pending).toBe(1);
    expect(get(id).status).toBe('ended');
    expect(get(id).cf_input_uid).toBe(uid);

    cf.deleteStatus = 200;
    const second = await sweep(NOW + MIN);
    expect(second.retried.deleted).toBe(1);
    expect(get(id).cf_input_uid).toBeNull();
    expect(cf.inputs.has(uid)).toBe(false);
    expect(linesFor(id).at(-1)).toBe(
      `[LiveSweep] session=${id} status=ended action=delete_retry:deleted`
    );
  });

  it('treats an input that is already gone as deleted', async () => {
    const id = row({ status: 'ended', uid: uidFor('dd') });
    const summary = await sweep();
    expect(summary.retried.deleted).toBe(1);
    expect(get(id).cf_input_uid).toBeNull();
  });
});

describe('orphan check', () => {
  const old = new Date((NOW - 30 * MIN) * 1000).toISOString();
  const young = new Date((NOW - 5 * MIN) * 1000).toISOString();

  function seed() {
    const recorded = row();
    const recordedUid = get(recorded).cf_input_uid;
    cf.inputs.get(recordedUid)!.created = old;
    cf.add({ uid: uidFor('f1'), name: `zc-live-${hexId('91')}`, created: old }); // orphan
    cf.add({ uid: uidFor('f2'), name: `zc-live-${hexId('92')}`, created: young }); // too new
    cf.add({ uid: uidFor('f3'), name: `zc-live-preview-${hexId('93')}`, created: old }); // other environment
    cf.add({ uid: uidFor('f4'), name: "Somebody else's stream", created: old }); // not ours
    cf.add({ uid: uidFor('f5'), name: `zc-live-${hexId('95')}`, created: null }); // no creation time
    cf.add({ uid: uidFor('f6'), name: `zc-live-${hexId('96')}-extra`, created: old }); // name does not match exactly
    return { recordedUid };
  }

  it("deletes only old, unrecorded inputs that carry this environment's prefix", async () => {
    const { recordedUid } = seed();
    const summary = await sweep();
    expect(summary.orphans).toEqual({ listed: 7, candidates: 1, deleted: 1, failed: 0 });
    expect(cf.deletes()).toEqual([uidFor('f1')]);
    for (const kept of [
      recordedUid,
      uidFor('f2'),
      uidFor('f3'),
      uidFor('f4'),
      uidFor('f5'),
      uidFor('f6')
    ]) {
      expect(cf.inputs.has(kept)).toBe(true);
    }
    // Counts only.
    expect(logged.filter((l) => l.includes('orphans'))).toEqual([
      '[LiveSweep] orphans listed=7 candidates=1 deleted=1 failed=0'
    ]);
  });

  it('on a preview, touches only preview-prefixed inputs', async () => {
    seed();
    const preview: StreamConfig = { ...cfg, inputPrefix: 'zc-live-preview-' };
    // The preview database has no rows here; production's inputs must survive.
    db.raw.prepare('DELETE FROM live_sessions').run();
    const summary = await sweep(NOW, preview);
    expect(cf.deletes()).toEqual([uidFor('f3')]);
    expect(summary.orphans.deleted).toBe(1);
  });

  it("does not treat an ended row's pending input as an orphan", async () => {
    const id = row({ status: 'ended', uid: uidFor('ab') });
    cf.add({ uid: uidFor('ab'), name: `zc-live-${id}`, created: old });
    cf.deleteStatus = 500;
    const summary = await sweep();
    expect(summary.orphans.candidates).toBe(0);
    expect(summary.retried.pending).toBe(1);
  });

  it('deletes nothing when the list cannot be read', async () => {
    seed();
    cf.listHttp = 500;
    const summary = await sweep();
    expect(summary.orphans.listed).toBeNull();
    expect(cf.deletes()).toEqual([]);
    expect(logged).toContain(
      '[LiveSweep] orphans listed=unreadable candidates=0 deleted=0 failed=0'
    );
  });

  it('counts an orphan it could not delete', async () => {
    cf.add({ uid: uidFor('f1'), name: `zc-live-${hexId('91')}`, created: old });
    cf.deleteStatus = 500;
    const summary = await sweep();
    expect(summary.orphans).toMatchObject({ candidates: 1, deleted: 0, failed: 1 });
  });
});

describe('retention', () => {
  it('deletes ended rows after 30 days, keeping any that still have an input', async () => {
    const old = row({ status: 'ended', uid: null, ended: NOW - 30 * DAY - 1 });
    const recent = row({ status: 'ended', uid: null, ended: NOW - 30 * DAY + 60 });
    const oldWithInput = row({ status: 'ended', uid: uidFor('ee'), ended: NOW - 40 * DAY });
    cf.add({ uid: uidFor('ee'), name: `zc-live-${oldWithInput}` });
    cf.deleteStatus = 500;
    const open = row({ status: 'created', created: NOW - MIN });

    const summary = await sweep();
    expect(summary.rowsDeleted).toBe(1);
    expect(get(old)).toBeUndefined();
    expect(get(recent)).toBeDefined();
    expect(get(oldWithInput)).toBeDefined();
    expect(get(open)).toBeDefined();

    // Once its input is confirmed deleted, the old row goes too.
    cf.deleteStatus = 200;
    await sweep(NOW + MIN);
    expect(get(oldWithInput)).toBeUndefined();
  });
});

describe('when Stream is not configured', () => {
  it('still applies the time limits, and leaves inputs on record', async () => {
    const timedOut = row({ started: NOW - 95 * MIN });
    const uid = get(timedOut).cf_input_uid;
    const neverStarted = row({ status: 'created', created: NOW - 11 * MIN });
    const live = row();

    const summary = await sweep(NOW, null);
    expect(summary.streamConfigured).toBe(false);
    expect(get(timedOut).status).toBe('ended');
    expect(get(timedOut).cf_input_uid).toBe(uid);
    expect(summary.inputsPending).toBe(1);
    expect(get(neverStarted).end_reason).toBe('never_started');
    expect(get(live).status).toBe('live');
    expect(get(live).disconnected_streak).toBe(0);
    expect(cf.calls).toEqual([]);
  });
});

describe('time budget', () => {
  it('stops when the budget is used up and says so', async () => {
    for (let i = 0; i < 5; i++) row();
    let t = 0;
    const summary = await runLiveSweep(db, cfg, {
      now: NOW,
      clockMs: () => (t += 6000),
      budgetMs: 20_000
    });
    expect(summary.outOfTime).toBe(true);
    expect(summary.examined).toBeLessThan(5);
    expect(logged.at(-1)).toContain('time budget used up');
  });
});

describe('purgeLiveSessions (account deletion)', () => {
  it("ends the member's open session, deletes its input and removes all their rows", async () => {
    const open = row({ host: HOST });
    const uid = get(open).cf_input_uid;
    row({ status: 'ended', host: HOST, uid: null });
    row({ status: 'ended', host: HOST, uid: null });
    const theirs = row({ host: OTHER_HOST });

    const removed = await purgeLiveSessions(db, cfg, HOST);
    expect(removed).toBe(3);
    expect(cf.inputs.has(uid)).toBe(false);
    expect(
      db.raw.prepare('SELECT COUNT(*) AS c FROM live_sessions WHERE host_pubkey = ?').get(HOST).c
    ).toBe(0);
    expect(get(theirs).status).toBe('live');
  });

  it('removes the rows even when the input cannot be deleted; the orphan check then finds it', async () => {
    const open = row({ host: HOST });
    const uid = get(open).cf_input_uid;
    cf.inputs.get(uid)!.created = new Date((NOW - 30 * MIN) * 1000).toISOString();
    cf.deleteStatus = 500;
    expect(await purgeLiveSessions(db, cfg, HOST)).toBe(1);
    expect(cf.inputs.has(uid)).toBe(true);

    cf.deleteStatus = 200;
    const summary = await sweep();
    expect(summary.orphans.deleted).toBe(1);
    expect(cf.inputs.has(uid)).toBe(false);
  });

  it('does nothing for a member with no sessions', async () => {
    expect(await purgeLiveSessions(db, cfg, HOST)).toBe(0);
    expect(cf.calls).toEqual([]);
  });
});
