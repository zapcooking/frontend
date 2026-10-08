/**
 * Identity on POST /api/nourish and POST /api/nourish/scan.
 *
 * Both endpoints used to read `pubkey` from the request body and hand it to
 * the membership lookup. A body pubkey is a claim, not a proof: anyone could
 * name a known member and spend the OpenAI budget on that membership. Identity
 * now comes from a NIP-98 signature over the exact request; the body field is
 * ignored.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyNip98: vi.fn(),
  hasActiveMembership: vi.fn(),
  runScoringPipeline: vi.fn()
}));

vi.mock('$lib/nip98.server', () => ({ verifyNip98: mocks.verifyNip98 }));
vi.mock('$lib/membershipApi.server', () => ({ hasActiveMembership: mocks.hasActiveMembership }));
vi.mock('$lib/nourish/scoringEngine.server', () => ({ runScoringPipeline: mocks.runScoringPipeline }));

import { POST as nourishPost } from './+server';
import { POST as scanPost } from './scan/+server';

const MEMBER = 'a'.repeat(64);
const SOMEONE_ELSE = 'b'.repeat(64);
const fetchMock = vi.fn();

function makeEvent(
  url: string,
  body: unknown,
  opts: { signed?: boolean; membershipEnabled?: boolean } = {}
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.signed) headers.Authorization = 'Nostr fake';
  return {
    request: new Request(new URL(url), { method: 'POST', headers, body: JSON.stringify(body) }),
    url: new URL(url),
    platform: {
      env: {
        OPENAI_API_KEY: 'test-key',
        MEMBERSHIP_ENABLED: opts.membershipEnabled === false ? 'false' : 'true',
        RELAY_API_SECRET: 'secret'
      }
    }
  } as any;
}

const nourishBody = (pubkey: string) => ({
  pubkey,
  eventId: 'e'.repeat(64),
  title: 'Soup',
  ingredients: ['2 carrots', '1 onion'],
  tags: ['soup'],
  servings: '4'
});
const scanBody = (pubkey: string) => ({ pubkey, text: 'a bowl of lentil soup with bread' });

const scanOpenAiReply = {
  ok: true,
  json: async () => ({
    choices: [{ message: { content: JSON.stringify({ gut: { score: 7, label: 'Strong', reason: 'fiber' }, protein: { score: 6, label: 'Moderate', reason: 'lentils' }, realFood: { score: 8, label: 'Strong', reason: 'whole' }, antiInflammatory: { score: 6, label: 'Moderate', reason: '' }, bloodSugar: { score: 6, label: 'Moderate', reason: '' }, immuneSupportive: { score: 6, label: 'Moderate', reason: '' }, brainHealth: { score: 6, label: 'Moderate', reason: '' }, heartHealth: { score: 6, label: 'Moderate', reason: '' }, kidFriendly: { score: 6, label: 'Moderate', reason: '' }, summary: 'ok', quick_take: 'ok', ingredients: [], improvements: [] }) } }]
  })
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset().mockResolvedValue(scanOpenAiReply);
  // Mirror the real verifier's contract: no Authorization header is a hard failure.
  mocks.verifyNip98.mockReset().mockImplementation(async (req: Request) =>
    req.headers.get('authorization') ? { ok: true, pubkey: MEMBER } : { ok: false, reason: 'missing-header' }
  );
  mocks.hasActiveMembership.mockReset().mockResolvedValue(true);
  mocks.runScoringPipeline.mockReset().mockResolvedValue({
    ok: true,
    scores: {},
    improvements: [],
    ingredientSignals: [],
    audienceScores: {},
    macros: undefined,
    labels: []
  });
});

const endpoints = [
  { name: '/api/nourish', url: 'https://zap.cooking/api/nourish', post: nourishPost, body: nourishBody },
  { name: '/api/nourish/scan', url: 'https://zap.cooking/api/nourish/scan', post: scanPost, body: scanBody }
] as const;

for (const ep of endpoints) {
  describe(`POST ${ep.name}`, () => {
    it('rejects an unsigned request that names a member in the body (401, no lookup)', async () => {
      const res = await ep.post(makeEvent(ep.url, ep.body(MEMBER)));
      expect(res.status).toBe(401);
      expect(mocks.hasActiveMembership).not.toHaveBeenCalled();
      expect(mocks.verifyNip98).toHaveBeenCalledTimes(1);
    });

    it('rejects a present-but-invalid signature with 401', async () => {
      mocks.verifyNip98.mockResolvedValue({ ok: false, reason: 'bad-signature' });
      const res = await ep.post(makeEvent(ep.url, ep.body(MEMBER), { signed: true }));
      expect(res.status).toBe(401);
      expect(mocks.hasActiveMembership).not.toHaveBeenCalled();
    });

    it('checks membership against the SIGNING pubkey, ignoring the body pubkey', async () => {
      const res = await ep.post(makeEvent(ep.url, ep.body(SOMEONE_ELSE), { signed: true }));
      expect(res.status).toBe(200);
      expect(mocks.hasActiveMembership).toHaveBeenCalledTimes(1);
      expect(mocks.hasActiveMembership.mock.calls[0][0]).toBe(MEMBER);
    });

    it('verifies the signature over the exact body bytes that were sent', async () => {
      const body = JSON.stringify(ep.body(SOMEONE_ELSE));
      await ep.post(makeEvent(ep.url, ep.body(SOMEONE_ELSE), { signed: true }));
      const passed = mocks.verifyNip98.mock.calls[0][1].bodyBytes as Uint8Array;
      expect(new TextDecoder().decode(passed)).toBe(body);
    });

    it('still answers 403 for a verified non-member', async () => {
      mocks.hasActiveMembership.mockResolvedValue(false);
      const res = await ep.post(makeEvent(ep.url, ep.body(MEMBER), { signed: true }));
      expect(res.status).toBe(403);
    });

    it('needs no signature when the membership gate is off', async () => {
      const res = await ep.post(makeEvent(ep.url, ep.body(''), { membershipEnabled: false }));
      expect(res.status).toBe(200);
      expect(mocks.verifyNip98).not.toHaveBeenCalled();
      expect(mocks.hasActiveMembership).not.toHaveBeenCalled();
    });
  });
}
