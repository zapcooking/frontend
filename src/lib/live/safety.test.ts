/** Reports, holds, the action log and safety retention (adapted from draft PR #976). */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { approveHosts, createLiveDatabase } from '../../test/liveDatabase';
import { createSession, deleteOldEndedRows, endSession } from './sessions.server';
import {
  cleanupSafetyRecords,
  listIncidents,
  logAction,
  recordReport,
  releaseHold
} from './safety.server';

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

  it('deletes action log entries after 2 years, except those about a session with an open hold', async () => {
    const YEAR = 365 * DAY;
    await logAction(db, { actor: 'admin', action: 'mode', now: NOW - 3 * YEAR }); // old, no session
    await logAction(db, { actor: 'admin', action: 'end', sessionId: id, now: NOW - 3 * YEAR }); // old, held
    await logAction(db, { actor: 'admin', action: 'block', now: NOW - YEAR }); // recent
    await report(HASH(1)); // opens the hold on `id`
    await cleanupSafetyRecords(db, NOW);
    expect(db.raw.prepare('SELECT action FROM live_actions ORDER BY rowid').all()).toEqual([
      { action: 'end' },
      { action: 'block' }
    ]);

    // Once the hold is released, the held entry ages out too.
    await releaseHold(db, id, 'admin', NOW);
    await cleanupSafetyRecords(db, NOW);
    expect(db.raw.prepare('SELECT action FROM live_actions').all()).toEqual([{ action: 'block' }]);
  });
});

describe('logAction', () => {
  it('returns false, without throwing, when the log cannot be written', async () => {
    db.raw.exec('DROP TABLE live_actions');
    expect(await logAction(db, { actor: 'x', action: 'end' })).toBe(false);
  });
});
