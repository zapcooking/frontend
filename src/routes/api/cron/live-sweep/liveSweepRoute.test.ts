/** Tests for POST /api/cron/live-sweep: who may run the sweep. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createLiveDatabase } from '../../../../test/liveDatabase';
import { createStreamStub, STUB_ACCOUNT } from '../../../../test/liveStreamStub';
import { POST } from './+server';

const URL_ = 'https://zap.cooking/api/cron/live-sweep';
let db: ReturnType<typeof createLiveDatabase>;
let cf: ReturnType<typeof createStreamStub>;
let env: Record<string, unknown>;

const call = (auth?: string) =>
  POST({
    request: new Request(URL_, { method: 'POST', headers: auth ? { Authorization: auth } : {} }),
    platform: { env }
  } as any);

beforeEach(() => {
  db = createLiveDatabase();
  cf = createStreamStub();
  cf.install();
  env = {
    SCHEDULER_DB: db,
    CRON_SECRET: 'cron-secret',
    CF_STREAM_ACCOUNT_ID: STUB_ACCOUNT,
    CF_STREAM_API_TOKEN: 'stream-token'
  };
  for (const level of ['log', 'warn', 'error'] as const)
    vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('POST /api/cron/live-sweep', () => {
  it('refuses to run when CRON_SECRET is not configured', async () => {
    for (const secret of [undefined, '', '   ']) {
      env.CRON_SECRET = secret;
      for (const auth of [undefined, 'Bearer ', 'Bearer anything', 'Bearer undefined']) {
        const res = await call(auth);
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ error: 'not_configured' });
      }
    }
    expect(cf.calls).toEqual([]);
  });

  it('refuses a missing or wrong secret', async () => {
    for (const auth of [
      undefined,
      'Bearer wrong',
      'Bearer cron-secre',
      'Bearer cron-secret-and-more',
      'cron-secret',
      'Basic cron-secret'
    ]) {
      const res = await call(auth);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'unauthorized' });
    }
    expect(cf.calls).toEqual([]);
  });

  it('runs the sweep with the right secret and returns counts only', async () => {
    const res = await call('Bearer cron-secret');
    expect(res.status).toBe(200);
    const summary = await res.json();
    expect(summary).toMatchObject({ examined: 0, streamConfigured: true, rowsDeleted: 0 });
    expect(summary.orphans).toEqual({ listed: 0, candidates: 0, deleted: 0, failed: 0 });
    expect(cf.calls).toEqual(['list']);
  });

  it('accepts a secret that was stored with stray whitespace', async () => {
    env.CRON_SECRET = '  cron-secret\n';
    expect((await call('Bearer cron-secret')).status).toBe(200);
  });

  it('still runs, without Cloudflare calls, when Stream is not configured', async () => {
    env.CF_STREAM_API_TOKEN = undefined;
    const res = await call('Bearer cron-secret');
    expect(res.status).toBe(200);
    expect((await res.json()).streamConfigured).toBe(false);
    expect(cf.calls).toEqual([]);
  });

  it('reports not_configured when the database is not bound', async () => {
    env.SCHEDULER_DB = undefined;
    expect((await call('Bearer cron-secret')).status).toBe(500);
  });
});
