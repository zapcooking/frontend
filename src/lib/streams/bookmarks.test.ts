import { describe, expect, it } from 'vitest';
import { decodeBookmarks, encodeBookmarks, mergeBookmarks } from './bookmarks';
import { streamBookmark } from './parse';

const hex64 = (char: string) => char.repeat(64);

describe('stream bookmarks', () => {
  it('backup payloads round-trip safe bookmarks', () => {
    const local = streamBookmark({ url: 'https://example.com/local', title: 'Local' })!;
    expect(decodeBookmarks(encodeBookmarks([local]))).toEqual([local]);
  });

  it('merging never deletes local saves', () => {
    const local = streamBookmark({ url: 'https://example.com/local', title: 'Local' })!;
    const remote = streamBookmark({ url: 'https://example.com/remote', title: 'Remote' })!;
    const stale = { ...local, title: 'Old' };
    expect(mergeBookmarks([local], [remote, stale])).toEqual([remote, local]);
  });

  it('restores reject foreign versions and unsafe entries', () => {
    expect(() => decodeBookmarks('{"version":2,"streams":[]}')).toThrow();
    expect(() => decodeBookmarks('{"version":1,"streams":[{"url":"javascript:alert(1)"}]}')).toThrow();
    expect(() => decodeBookmarks('nonsense')).toThrow();
    expect(() =>
      decodeBookmarks(
        '{"version":1,"streams":' +
          JSON.stringify(Array.from({ length: 201 }, () => ({ url: 'https://example.com/x' }))) +
          '}'
      )
    ).toThrow();
  });

  it('encoding refuses more than two hundred bookmarks', () => {
    const tooMany = Array.from({ length: 201 }, (_, i) =>
      streamBookmark({ url: 'https://example.com/' + i })!
    );
    expect(() => encodeBookmarks(tooMany)).toThrow(/Too many/);
  });

  it('a saved addressable stream keeps its key rather than an event id', () => {
    const key = `30311:${hex64('a')}:radio:live`;
    const saved = streamBookmark({
      key,
      id: 'old-event',
      url: 'https://example.com/old.m3u8',
      title: 'Radio',
      host: hex64('b')
    })!;
    expect(saved.key).toBe(key);
    expect(decodeBookmarks(encodeBookmarks([saved]))[0].key).toBe(key);
  });
});
