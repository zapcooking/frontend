import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTrialDatabase } from '../../../test/cheffyTrialDatabase';
import { trialRemaining } from '../../../lib/cheffyTrial.server';
const mocks = vi.hoisted(() => ({ verify: vi.fn(), member: vi.fn() }));
vi.mock('$lib/nip98.server', () => ({ verifyNip98: mocks.verify }));
vi.mock('$lib/membershipApi.server', () => ({ checkMembership: mocks.member }));
import { POST } from './+server';
import { POST as STATUS } from './trial-status/+server';
const pubkey = 'a'.repeat(64);
let db: ReturnType<typeof createTrialDatabase>;
const fetcher = vi.fn();
const body = (id: number) => ({
  mode: 'chat',
  prompt: 'What can I make with beans?',
  experience: true,
  trialRequestId: `message-request-${id}`
});
function event(payload: unknown, database: unknown = db) {
  return {
    request: new Request('https://zap.cooking/api/zappy', {
      method: 'POST',
      headers: { authorization: 'Nostr proof', 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    }),
    platform: {
      env: {
        OPENAI_API_KEY: 'test',
        MEMBERSHIP_ENABLED: 'true',
        RELAY_API_SECRET: 'test',
        SCHEDULER_DB: database
      }
    }
  } as never;
}
beforeEach(() => {
  db = createTrialDatabase();
  mocks.verify.mockReset().mockResolvedValue({ ok: true, pubkey });
  mocks.member
    .mockReset()
    .mockResolvedValue({ state: 'inactive', found: false, reason: 'not-found' });
  fetcher.mockReset().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'Try a bean stew.' } }] })
  });
  vi.stubGlobal('fetch', fetcher);
});
describe('three signed-in text samples', () => {
  it('counts three successful messages and refuses the fourth before a model call', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await POST(event(body(i)));
      expect(r.status).toBe(200);
      expect((await r.json()).trial.remaining).toBe(2 - i);
    }
    const r = await POST(event(body(3)));
    expect(r.status).toBe(429);
    expect((await r.json()).code).toBe('CHEFFY_EXPERIENCE_USED');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('holds the cap across concurrent API calls and duplicate in-flight IDs', async () => {
    let finish: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    fetcher.mockImplementation(async () => {
      await gate;
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'Cook beans.' } }] })
      };
    });
    const pending = Array.from({ length: 6 }, (_, i) => POST(event(body(i))));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    const duplicate = await POST(event(body(0)));
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).code).toBe('TRIAL_REQUEST_IN_PROGRESS');
    finish!();
    const responses = await Promise.all(pending);
    expect(responses.filter((r) => r.status === 200)).toHaveLength(3);
    expect(responses.filter((r) => r.status === 429)).toHaveLength(3);
  });
  it('does not reset quota when client cookies or body identities change', async () => {
    for (let i = 0; i < 3; i++) await POST(event(body(i)));
    const r = await POST(event({ ...body(4), pubkey: 'b'.repeat(64), used: 0 }));
    expect(r.status).toBe(429);
  });
  it('deduplicates successful request retries without retaining chat content', async () => {
    await POST(event(body(0)));
    const r = await POST(event(body(0)));
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe('TRIAL_REQUEST_COMPLETED');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await trialRemaining(db, pubkey)).toBe(2);
  });
  it('releases failed model attempts for a same-ID retry', async () => {
    fetcher.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    expect((await POST(event(body(0)))).status).toBe(500);
    expect(await trialRemaining(db, pubkey)).toBe(3);
    expect((await POST(event(body(0)))).status).toBe(200);
  });
  it('keeps formatting paid and validation above reservations', async () => {
    expect((await POST(event({ ...body(0), mode: 'format' }))).status).toBe(403);
    expect((await POST(event({ ...body(0), prompt: 'x'.repeat(751) }))).status).toBe(400);
    expect(await trialRemaining(db, pubkey)).toBe(3);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('fails closed when the database or schema is unavailable', async () => {
    expect((await POST(event(body(0), null))).status).toBe(503);
    expect(
      (
        await POST(
          event(body(0), {
            prepare() {
              throw Error('missing table');
            }
          })
        )
      ).status
    ).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps members outside the trial ledger', async () => {
    mocks.member.mockResolvedValue({ state: 'active' });
    for (let i = 0; i < 4; i++)
      expect((await POST(event({ prompt: 'Hello', mode: 'chat' }, null))).status).toBe(200);
  });
  it('returns signed private status and refuses unauthenticated status requests', async () => {
    await POST(event(body(0)));
    const r = await STATUS(event({}));
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(await r.json()).toEqual({ remaining: 2, limit: 3 });
    mocks.verify.mockResolvedValue({ ok: false });
    expect((await STATUS(event({}))).status).toBe(401);
  });
});
