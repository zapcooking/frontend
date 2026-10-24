import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$app/environment', () => ({ browser: false }));
vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return { ndk: writable({}), userPublickey: writable('') };
});
vi.mock('$lib/nip98', () => ({ signNip98AuthHeader: vi.fn() }));
vi.mock('$lib/cheffyTrialClient', () => ({ loadCheffyTrial: vi.fn() }));
vi.mock('$lib/photoAsk', () => ({
  askAboutPhoto: vi.fn(),
  fileToBase64: vi.fn(),
  isPhotoAskRetryable: () => false
}));
import { userPublickey } from '$lib/nostr';
import { signNip98AuthHeader } from '$lib/nip98';
import { loadCheffyTrial } from '$lib/cheffyTrialClient';
import {
  cheffyThread,
  cheffyDraft,
  cheffyLoading,
  cheffyExperienceCount,
  cheffyExperienceUsed,
  cheffyExperienceMode,
  cheffyTrialStatus,
  cheffyConversion,
  refreshCheffyTrial,
  startCheffyExperience,
  sendCheffy,
  retryCheffy,
  startOverCheffy
} from './cheffyChat';

const accountA = 'a'.repeat(64);
const accountB = 'b'.repeat(64);
const fetchMock = vi.fn();
const reply = (remaining: number) => ({
  ok: true,
  json: async () => ({ ok: true, output: 'Try a little lemon.', trial: { remaining, limit: 3 } })
});
beforeEach(() => {
  vi.stubGlobal('window', { location: { origin: 'https://zap.cooking' } });
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset().mockResolvedValue(reply(2));
  vi.mocked(signNip98AuthHeader).mockReset().mockResolvedValue('Nostr signed');
  vi.mocked(loadCheffyTrial).mockReset().mockResolvedValue(3);
  userPublickey.set('');
  userPublickey.set(accountA);
  cheffyLoading.set(false);
  startOverCheffy();
});
afterEach(() => vi.unstubAllGlobals());

async function beginTrial() {
  cheffyExperienceMode.set(true);
  await refreshCheffyTrial();
}
function body(index = 0) {
  return JSON.parse(fetchMock.mock.calls[index][1].body);
}

describe('signed-in Cheffy trial', () => {
  it('loads durable usage and stops the composer after the third reply', async () => {
    await beginTrial();
    fetchMock
      .mockResolvedValueOnce(reply(2))
      .mockResolvedValueOnce(reply(1))
      .mockResolvedValueOnce(reply(0));
    await sendCheffy('First question');
    await sendCheffy('Second question');
    await sendCheffy('Third question');
    await sendCheffy('Fourth question');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(get(cheffyExperienceCount)).toBe(3);
    expect(get(cheffyExperienceUsed)).toBe(true);
    expect(get(cheffyConversion)).toBe('response');
    expect(body().experience).toBe(true);
    expect(typeof body().trialRequestId).toBe('string');
    expect(new Set([body(0), body(1), body(2)].map((v) => v.trialRequestId)).size).toBe(3);
    expect(get(cheffyThread).filter((m) => m.role === 'cheffy' && m.kind === 'text')).toHaveLength(
      3
    );
  });

  it('retains the request id and exact body across a network retry', async () => {
    await beginTrial();
    fetchMock.mockRejectedValueOnce(new Error('Network disconnected'));
    await sendCheffy('What can I cook?');
    expect(get(cheffyExperienceCount)).toBe(0);
    await retryCheffy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body(1)).toEqual(body(0));
    expect(get(cheffyExperienceCount)).toBe(1);
    expect(signNip98AuthHeader).toHaveBeenCalledTimes(2);
  });

  it('offers a new message after a completed request cannot be replayed', async () => {
    await beginTrial();
    vi.mocked(loadCheffyTrial).mockResolvedValue(2);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        code: 'TRIAL_REQUEST_COMPLETED',
        error: 'That message was already answered.'
      })
    });
    await sendCheffy('What can I cook?');
    expect(get(cheffyThread).at(-1)?.retryable).toBe(false);
    expect(get(cheffyDraft)).toBe('What can I cook?');
    expect(get(cheffyExperienceCount)).toBe(1);
    await retryCheffy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await sendCheffy(get(cheffyDraft));
    expect(body(1).trialRequestId).not.toBe(body(0).trialRequestId);
  });

  it('requires an account and never falls back to an unsigned request', async () => {
    userPublickey.set('');
    await startCheffyExperience('Dinner ideas');
    expect(loadCheffyTrial).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    userPublickey.set(accountA);
    await beginTrial();
    vi.mocked(signNip98AuthHeader).mockRejectedValue(new Error('Signing declined'));
    await sendCheffy('Dinner ideas');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(get(cheffyThread).at(-1)?.kind).toBe('error');
  });

  it('keeps the trial unavailable if the allowance service fails', async () => {
    vi.mocked(loadCheffyTrial).mockRejectedValue(new Error('Service unavailable'));
    await beginTrial();
    await sendCheffy('Dinner ideas');
    expect(get(cheffyTrialStatus)).toBe('error');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clears account usage, conversation and retry state when accounts change', async () => {
    await beginTrial();
    await sendCheffy('Dinner ideas');
    userPublickey.set(accountB);
    expect(get(cheffyExperienceCount)).toBe(0);
    expect(get(cheffyTrialStatus)).toBe('idle');
    expect(get(cheffyThread)).toEqual([]);
    await retryCheffy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ignores a reply that arrives after switching accounts', async () => {
    await beginTrial();
    let finish!: (value: ReturnType<typeof reply>) => void;
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const request = sendCheffy('Dinner ideas');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    userPublickey.set(accountB);
    finish(reply(0));
    await request;
    expect(get(cheffyThread)).toEqual([]);
    expect(get(cheffyExperienceCount)).toBe(0);
    expect(get(cheffyConversion)).toBe(null);
  });

  it('uses server exhaustion from another tab instead of incrementing a device counter', async () => {
    await beginTrial();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ code: 'CHEFFY_EXPERIENCE_USED' })
    });
    await sendCheffy('Dinner ideas');
    expect(get(cheffyExperienceUsed)).toBe(true);
    expect(get(cheffyConversion)).toBe('used');
    expect(get(cheffyThread).some((m) => m.kind === 'pending')).toBe(false);
  });
});
