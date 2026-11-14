/** Reports, holds, the automatic end and safety retention (adapted from draft PR #976). */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { approveHosts, createLiveDatabase } from '../../test/liveDatabase';
import { createStreamStub, STUB_ACCOUNT } from '../../test/liveStreamStub';
import { createSession, deleteOldEndedRows, endSession } from './sessions.server';
import {
  cleanupSafetyRecords,
  listIncidents,
  logAction,
  maybeAutoEnd,
  recordReport,
  releaseHold
} from './safety.server';
import type { StreamConfig } from './stream.server';

const HOST = 'a'.repeat(64);
const HASH = (n: number) => String(n).repeat(64).slice(0, 64);
const NOW = 2_000_000_000;
const DAY = 86400;

let db: ReturnType<typeof createLiveDatabase>;
let id: string;

beforeEach(async () => {
  db = createLiveDatabase();
  approveHosts(db, HOST);
  const created = await createSession(db, {
    hostPubkey: HOST,
    title: 'Test cooking stream',
    recipeA: null,
    mode: 'approved',
    now: NOW - 100
  });
  if (!created.ok) throw new Error('fixture failed');
  id = created.session.id;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const report = (hash: string, over: Partial<Parameters<typeof recordReport>[1]> = {}) =>
  recordReport(db, {
    sessionId: id,
    reporterHash: hash,
    reason: 'other',
    details: 'Test only',
    comment: null,
    now: NOW,
    ...over
  });
const hold = () => db.raw.prepare('SELECT * FROM live_holds WHERE session_id = ?').get(id);
const count = (table: string) => db.raw.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;

describe('recordReport', () => {
  it('stores the report and opens a hold with a snapshot that never holds the input id', async () => {
    db.raw.prepare("UPDATE live_sessions SET cf_input_uid = 'secret-uid' WHERE id = ?").run(id);
    const result = await report(HASH(1));
    expect(result).toMatchObject({ ok: true, recorded: true, urgent: false, title: 'Test cooking stream' });
    expect(hold().status).toBe('open');
    const snap = JSON.parse(hold().snapshot_json);
    expect(snap.title).toBe('Test cooking stream');
    expect(snap.host_pubkey).toBe(HOST);
    expect(hold().snapshot_json).not.toContain('secret-uid');
  });

  it('marks child safety and violence urgent', async () => {
    expect(await report(HASH(1), { reason: 'child_safety' })).toMatchObject({ urgent: true });
    expect(await report(HASH(2), { reason: 'violence' })).toMatchObject({ urgent: true });
    expect(await report(HASH(3), { reason: 'nudity' })).toMatchObject({ urgent: false });
  });

  it('keeps one report per reporter per target', async () => {
    expect((await report(HASH(1))).ok && (await report(HASH(1)))).toMatchObject({ recorded: false });
    const c1 = { id: 'c'.repeat(64), pubkey: 'd'.repeat(64) };
    expect(await report(HASH(1), { comment: c1 })).toMatchObject({ recorded: true });
    expect(await report(HASH(1), { comment: c1 })).toMatchObject({ recorded: false });
    expect(count('live_reports')).toBe(2);
  });

  it('never merges reports that have no usable reporter hash', async () => {
    await report('');
    await report('no-kv');
    expect(count('live_reports')).toBe(2);
  });

  it('refuses an unknown session and records nothing', async () => {
    expect(await report(HASH(1), { sessionId: 'f'.repeat(32) })).toEqual({
      ok: false,
      reason: 'not_found'
    });
    expect(count('live_reports')).toBe(0);
    expect(count('live_holds')).toBe(0);
  });

  it('reopens a released hold on a new report', async () => {
    await report(HASH(1));
    expect(await releaseHold(db, id, 'admin', NOW + 1)).toBe(true);
    expect(hold().status).toBe('released');
    await report(HASH(2));
    expect(hold()).toMatchObject({ status: 'open', released_at: null, released_by: null });
  });
});

describe('listIncidents', () => {
  it('lists holds with their reports, open first, and never a reporter hash', async () => {
    await report(HASH(1), { reason: 'child_safety', details: 'please look' });
    const incidents = await listIncidents(db);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ session_id: id, status: 'open', host_pubkey: HOST });
    expect(incidents[0].reports).toEqual([
      {
        reason: 'child_safety',
        details: 'please look',
        comment_id: null,
        comment_pubkey: null,
        created_at: NOW
      }
    ]);
    expect(JSON.stringify(incidents)).not.toContain(HASH(1));
  });
});

describe('maybeAutoEnd', () => {
  let cf: ReturnType<typeof createStreamStub>;
  let cfg: StreamConfig;
  beforeEach(() => {
    cf = createStreamStub();
    cfg = { accountId: STUB_ACCOUNT, token: 'token', inputPrefix: 'zc-live-' };
    cf.install();
  });

  it('ends at three distinct verified stream reporters, suspends the host and logs it', async () => {
    db.raw.prepare("UPDATE live_sessions SET status = 'live' WHERE id = ?").run(id);
    await report(HASH(1));
    await report(HASH(2));
    expect(await maybeAutoEnd(db, cfg, id, NOW)).toBe(false);
    await report(HASH(3));
    expect(await maybeAutoEnd(db, cfg, id, NOW)).toBe(true);
    expect(db.raw.prepare('SELECT status, end_reason FROM live_sessions WHERE id = ?').get(id)).toEqual(
      { status: 'ended', end_reason: 'admin' }
    );
    expect(
      db.raw.prepare('SELECT suspended_until FROM live_host_suspensions WHERE host_pubkey = ?').get(HOST)
        .suspended_until
    ).toBe(NOW + 3600);
    expect(db.raw.prepare('SELECT actor, action, session_id FROM live_actions').all()).toEqual([
      { actor: 'system', action: 'auto_end', session_id: id }
    ]);
    // Ending twice does nothing more.
    expect(await maybeAutoEnd(db, cfg, id, NOW)).toBe(false);
  });

  it('counts neither comment reports nor reports without a usable hash', async () => {
    db.raw.prepare("UPDATE live_sessions SET status = 'live' WHERE id = ?").run(id);
    const c = { id: 'c'.repeat(64), pubkey: 'd'.repeat(64) };
    await report(HASH(1), { comment: c });
    await report(HASH(2), { comment: c });
    await report('');
    await report('no-kv');
    await report(HASH(3));
    expect(await maybeAutoEnd(db, cfg, id, NOW)).toBe(false);
  });

  it('does nothing without a Cloudflare config', async () => {
    for (const n of [1, 2, 3]) await report(HASH(n));
    expect(await maybeAutoEnd(db, null, id, NOW)).toBe(false);
    expect(count('live_host_suspensions')).toBe(0);
  });
});

describe('retention', () => {
  it('keeps a reported session past 30 days while its hold is open', async () => {
    await report(HASH(1), { reason: 'child_safety' });
    await endSession(db, id, 'admin', NOW);
    await cleanupSafetyRecords(db, NOW + 400 * DAY);
    expect(await deleteOldEndedRows(db, NOW + 400 * DAY)).toBe(0);
    expect(count('live_reports')).toBe(1);
  });

  it('after release, deletes reports at 90 days, then the hold, then the session', async () => {
    await report(HASH(1));
    await releaseHold(db, id, 'admin', NOW + 1);
    await endSession(db, id, 'admin', NOW);
    await cleanupSafetyRecords(db, NOW + 60 * DAY);
    expect(count('live_reports')).toBe(1);
    expect(await deleteOldEndedRows(db, NOW + 30 * DAY)).toBe(0);

    await cleanupSafetyRecords(db, NOW + 91 * DAY);
    expect(count('live_reports')).toBe(0);
    expect(count('live_holds')).toBe(0);
    expect(await deleteOldEndedRows(db, NOW + 60 * DAY)).toBe(1);
  });

  it('removes expired suspensions and never the action log', async () => {
    db.raw
      .prepare(
        "INSERT INTO live_host_suspensions (host_pubkey, suspended_until, reason, session_id) VALUES (?, ?, 'x', ?)"
      )
      .run(HOST, NOW - 1, id);
    await logAction(db, { actor: 'system', action: 'auto_end', now: 1 });
    await cleanupSafetyRecords(db, NOW + 1000 * DAY);
    expect(count('live_host_suspensions')).toBe(0);
    expect(count('live_actions')).toBe(1);
  });
});

describe('logAction', () => {
  it('returns false, without throwing, when the log cannot be written', async () => {
    db.raw.exec('DROP TABLE live_actions');
    expect(await logAction(db, { actor: 'x', action: 'end' })).toBe(false);
  });
});
