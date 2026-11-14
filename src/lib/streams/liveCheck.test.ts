import { describe, it, expect } from 'vitest';
import { advancingPlaylist } from './liveCheck';

const PLAYLIST_URL = 'https://cdn.example.com/live.m3u8';

function response(body: string, finalUrl = PLAYLIST_URL): Response {
  return { ok: true, url: finalUrl, text: async () => body } as unknown as Response;
}

/** A scripted fetch: each URL read pops the next body (or repeats the last). */
function scriptedFetch(...bodies: string[]): typeof fetch & { reads: string[] } {
  const reads: string[] = [];
  const call = (async (input: RequestInfo | URL) => {
    const url = String(input);
    reads.push(url);
    const index = Math.min(reads.length - 1, bodies.length - 1);
    return response(bodies[index], url);
  }) as typeof fetch & { reads: string[] };
  call.reads = reads;
  return call;
}

const media = (sequence: number) =>
  [
    '#EXTM3U',
    '#EXT-X-TARGETDURATION:4',
    `#EXT-X-MEDIA-SEQUENCE:${sequence}`,
    '#EXTINF:4,seg.ts',
    'seg0.ts'
  ].join('\n');

const master = (child: string) =>
  ['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=1280000', child].join('\n');

describe('advancingPlaylist', () => {
  it('is true only when the media sequence advances', async () => {
    const live = scriptedFetch(media(10), media(11));
    await expect(advancingPlaylist(PLAYLIST_URL, undefined, live, async () => {})).resolves.toBe(
      true
    );

    const frozen = scriptedFetch(media(10));
    await expect(advancingPlaylist(PLAYLIST_URL, undefined, frozen, async () => {})).resolves.toBe(
      false
    );
  });

  it('follows a master playlist one level down', async () => {
    const variant = 'https://cdn.example.com/720p.m3u8';
    const fetch = scriptedFetch(master(variant), media(1), media(2));
    await expect(advancingPlaylist(PLAYLIST_URL, undefined, fetch, async () => {})).resolves.toBe(
      true
    );
    expect(fetch.reads[1]).toBe(variant);
  });

  it('rejects non-playlists, ended streams, and sequence-less media', async () => {
    await expect(
      advancingPlaylist(PLAYLIST_URL, undefined, scriptedFetch('<html>'), async () => {})
    ).resolves.toBe(false);
    await expect(
      advancingPlaylist(
        PLAYLIST_URL,
        undefined,
        scriptedFetch('#EXTM3U\n#EXT-X-ENDLIST'),
        async () => {}
      )
    ).resolves.toBe(false);
    await expect(
      advancingPlaylist(
        PLAYLIST_URL,
        undefined,
        scriptedFetch('#EXTM3U\n#EXTINF:4,seg.ts\nseg0.ts'),
        async () => {}
      )
    ).resolves.toBe(false);
  });

  it('rejects non-https addresses and honors abort', async () => {
    await expect(advancingPlaylist('http://cdn.example.com/live.m3u8')).resolves.toBe(false);
    const controller = new AbortController();
    controller.abort();
    await expect(
      advancingPlaylist(
        PLAYLIST_URL,
        controller.signal,
        scriptedFetch(media(1), media(2)),
        async () => {}
      )
    ).resolves.toBe(false);
  });

  it('reports a deep master chain as invalid', async () => {
    const fetch = scriptedFetch(
      master('https://cdn.example.com/a.m3u8'),
      master('https://cdn.example.com/b.m3u8')
    );
    await expect(advancingPlaylist(PLAYLIST_URL, undefined, fetch, async () => {})).resolves.toBe(
      false
    );
  });
});
