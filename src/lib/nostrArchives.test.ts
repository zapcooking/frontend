import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

import { naSuggest } from './nostrArchives';

afterEach(() => vi.unstubAllGlobals());

describe('naSuggest', () => {
  it('strips a leading @ before querying (the index matches the literal name)', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ suggestions: [] }) });
    vi.stubGlobal('fetch', fetch);
    await naSuggest('@oshi');
    expect(fetch.mock.calls[0][0]).toContain('q=oshi&');
  });

  it('applies the 2-character minimum after stripping', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await naSuggest('@o')).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
