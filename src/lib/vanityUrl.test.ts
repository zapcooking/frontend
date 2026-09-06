import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveVanityShareUrl, clearVanityDirectoryCache } from './vanityUrl';

function mockDirectory(names: Record<string, string>) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ names })
  });
}

describe('resolveVanityShareUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearVanityDirectoryCache();
  });

  it('returns the vanity URL for a directory author', async () => {
    vi.stubGlobal('fetch', mockDirectory({ daniel: 'ee6ea13a'.padEnd(64, 'a') }));
    const url = await resolveVanityShareUrl('ee6ea13a'.padEnd(64, 'a'), 'my-article');
    expect(url).toBe('https://zap.cooking/daniel/my-article');
  });

  it('returns empty string for an author without a handle', async () => {
    vi.stubGlobal('fetch', mockDirectory({ daniel: 'ee6ea13a'.padEnd(64, 'a') }));
    const url = await resolveVanityShareUrl('ff'.padEnd(64, '0'), 'my-article');
    expect(url).toBe('');
  });

  it('ignores malformed handles in the directory', async () => {
    vi.stubGlobal(
      'fetch',
      mockDirectory({ 'UPPER CASE': 'ee6ea13a'.padEnd(64, 'a'), 'ok-handle': 'ff'.padEnd(64, '0') })
    );
    const url = await resolveVanityShareUrl('ee6ea13a'.padEnd(64, 'a'), 'my-article');
    expect(url).toBe('');
  });

  it('returns empty string when the directory fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down'))
    );
    const url = await resolveVanityShareUrl('ee6ea13a'.padEnd(64, 'a'), 'my-article');
    expect(url).toBe('');
  });

  it('returns empty string for missing inputs', async () => {
    vi.stubGlobal('fetch', mockDirectory({}));
    expect(await resolveVanityShareUrl('', 'slug')).toBe('');
    expect(await resolveVanityShareUrl('ee6ea13a'.padEnd(64, 'a'), '')).toBe('');
  });
});
