import { describe, it, expect, vi } from 'vitest';
import { fetchHiddenAuthors, setHiddenAuthor } from './hiddenClient';

const T = 'b'.repeat(64);
const ID = 'a'.repeat(32);

describe('fetchHiddenAuthors', () => {
  it('returns well-formed entries only', async () => {
    const fetchFn = vi.fn(async () =>
      Response.json({
        hidden: [
          { pubkey: T, scope: 'host' },
          { pubkey: 'c'.repeat(64), scope: 'global' },
          { pubkey: 'bad', scope: 'host' },
          { pubkey: T, scope: 'site' }
        ]
      })
    );
    expect(await fetchHiddenAuthors(ID, fetchFn as never)).toEqual([
      { pubkey: T, scope: 'host' },
      { pubkey: 'c'.repeat(64), scope: 'global' }
    ]);
  });

  it('returns null when it cannot tell (so the chat keeps what it applied)', async () => {
    expect(
      await fetchHiddenAuthors(ID, (async () => new Response('', { status: 500 })) as never)
    ).toBeNull();
    expect(
      await fetchHiddenAuthors(ID, (async () => {
        throw new Error('offline');
      }) as never)
    ).toBeNull();
  });
});

describe('setHiddenAuthor', () => {
  const base = { sessionId: ID, pubkey: T, hidden: true, scope: 'host' as const };

  it('signs the exact body and posts it', async () => {
    let signed: { url: string; bodyString: string } | null = null;
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.body).toBe(signed!.bodyString);
      expect(new Headers(init.headers).get('Authorization')).toBe('Nostr x');
      return new Response('{}', { status: 200 });
    });
    const outcome = await setHiddenAuthor(
      {
        ...base,
        sign: async (req) => {
          signed = req;
          return 'Nostr x';
        }
      },
      fetchFn as never
    );
    expect(outcome).toBe('ok');
    expect(JSON.parse(signed!.bodyString)).toEqual({ pubkey: T, hidden: true, scope: 'host' });
    expect(signed!.url).toMatch(new RegExp(`/api/live/${ID}/hidden$`));
  });

  it('maps refusals and failures', async () => {
    const sign = async () => 'Nostr x';
    const reply = (status: number) => (async () => new Response('{}', { status })) as never;
    expect(await setHiddenAuthor({ ...base, sign }, reply(403))).toBe('forbidden');
    expect(await setHiddenAuthor({ ...base, sign }, reply(409))).toBe('full');
    expect(await setHiddenAuthor({ ...base, sign }, reply(500))).toBe('error');
    expect(
      await setHiddenAuthor(
        {
          ...base,
          sign: async () => {
            throw new Error('refused');
          }
        },
        reply(200)
      )
    ).toBe('sign_failed');
  });
});
