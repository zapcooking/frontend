import { describe, it, expect } from 'vitest';
import {
  goLiveAddress,
  goLiveZapTargets,
  isEventTarget,
  targetFilter,
  targetFilters,
  targetTag
} from './target';

describe('stream targets', () => {
  const NOTE = 'a'.repeat(64);
  const ADDRESS = `30311:${'b'.repeat(64)}:show`;

  it('tells a note id from a stream address', () => {
    expect(isEventTarget(NOTE)).toBe(true);
    expect(isEventTarget(ADDRESS)).toBe(false);
    expect(isEventTarget('A'.repeat(64))).toBe(false);
    expect(isEventTarget(null)).toBe(false);
    expect(targetTag(NOTE)).toBe('e');
    expect(targetTag(ADDRESS)).toBe('a');
  });

  it('builds the relay filter fragment', () => {
    expect(targetFilter(NOTE)).toEqual({ '#e': [NOTE] });
    expect(targetFilter(ADDRESS)).toEqual({ '#a': [ADDRESS] });
  });

  it("builds a Go live session's address from the host and the session id", () => {
    const HOST = 'b'.repeat(64);
    const SESSION = '0123456789abcdef0123456789abcdef';
    expect(goLiveAddress(HOST, SESSION)).toBe(`30311:${HOST}:${SESSION}`);
    expect(goLiveAddress(HOST.toUpperCase(), ` ${SESSION} `)).toBe(`30311:${HOST}:${SESSION}`);
    // It is an address, never mistaken for a note id.
    expect(isEventTarget(goLiveAddress(HOST, SESSION))).toBe(false);
    expect(goLiveAddress('npub1abc', SESSION)).toBeNull();
    expect(goLiveAddress(HOST, '')).toBeNull();
    expect(goLiveAddress(HOST, 'x'.repeat(201))).toBeNull();
    expect(goLiveAddress(null, null)).toBeNull();
  });

  it("lists a Go live session's zap targets: the note when there is one, and the address", () => {
    const HOST = 'b'.repeat(64);
    const SESSION = '0123456789abcdef0123456789abcdef';
    const LIVE = `30311:${HOST}:${SESSION}`;
    expect(goLiveZapTargets(HOST, SESSION, NOTE)).toEqual([NOTE, LIVE]);
    expect(goLiveZapTargets(HOST, SESSION, null)).toEqual([LIVE]);
    expect(goLiveZapTargets(HOST, SESSION)).toEqual([LIVE]);
    expect(goLiveZapTargets(HOST, SESSION, 'not-an-id')).toEqual([LIVE]);
    expect(goLiveZapTargets('nope', SESSION, NOTE)).toEqual([]);
  });

  it('builds one filter per target, never one filter with both tags', () => {
    expect(targetFilters([NOTE, ADDRESS])).toEqual([{ '#e': [NOTE] }, { '#a': [ADDRESS] }]);
    expect(targetFilters([ADDRESS, ADDRESS])).toEqual([{ '#a': [ADDRESS] }]);
    expect(targetFilters([])).toEqual([]);
  });
});
