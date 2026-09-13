import { describe, it, expect } from 'vitest';
import {
  isPubkeyMuted,
  containsMutedWord,
  hasMutedTag,
  isThreadMuted,
  isEventMutedBy,
  type MuteList
} from './muteFilter';

const EMPTY: MuteList = { pubkeys: [], words: [], tags: [], threads: [] };

function muteList(partial: Partial<MuteList>): MuteList {
  return { ...EMPTY, ...partial };
}

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const NOTE_ID = 'e'.repeat(64);

describe('the individual checks', () => {
  it('matches a muted pubkey exactly', () => {
    const list = muteList({ pubkeys: [{ type: 'pubkey', value: ALICE }] });
    expect(isPubkeyMuted(list, ALICE)).toBe(true);
    expect(isPubkeyMuted(list, BOB)).toBe(false);
  });

  it('matches muted words case-insensitively, as substrings', () => {
    const list = muteList({ words: [{ type: 'word', value: 'Spoiler' }] });
    expect(containsMutedWord(list, 'big SPOILER ahead')).toBe(true);
    expect(containsMutedWord(list, 'nothing to see')).toBe(false);
    expect(containsMutedWord(list, '')).toBe(false);
  });

  it('matches muted hashtags case-insensitively', () => {
    const list = muteList({ tags: [{ type: 'tag', value: 'Politics' }] });
    expect(hasMutedTag(list, [['t', 'POLITICS']])).toBe(true);
    expect(hasMutedTag(list, [['t', 'foodstr']])).toBe(false);
    expect(hasMutedTag(list, [['p', 'politics']])).toBe(false);
    expect(hasMutedTag(list, [])).toBe(false);
  });

  it('tolerates malformed tags without throwing', () => {
    const list = muteList({ tags: [{ type: 'tag', value: 'politics' }] });
    const malformed = [null, 't', ['t'], ['t', 1], ['t', 'POLITICS']] as unknown as string[][];
    expect(() => hasMutedTag(list, malformed)).not.toThrow();
    expect(hasMutedTag(list, malformed)).toBe(true);
  });

  it('matches a muted thread by event id', () => {
    const list = muteList({ threads: [{ type: 'thread', value: NOTE_ID }] });
    expect(isThreadMuted(list, NOTE_ID)).toBe(true);
    expect(isThreadMuted(list, 'f'.repeat(64))).toBe(false);
  });
});

describe('isEventMutedBy', () => {
  const event = {
    id: NOTE_ID,
    pubkey: ALICE,
    content: 'braised short ribs, spoiler: they were good',
    tags: [['t', 'foodstr']]
  };

  it('mutes nothing when there is no mute list', () => {
    expect(isEventMutedBy(null, event)).toBe(false);
    expect(isEventMutedBy(undefined, event)).toBe(false);
  });

  it('mutes nothing when the list is empty', () => {
    expect(isEventMutedBy(EMPTY, event)).toBe(false);
  });

  it('catches a muted author', () => {
    expect(isEventMutedBy(muteList({ pubkeys: [{ type: 'pubkey', value: ALICE }] }), event)).toBe(
      true
    );
    expect(isEventMutedBy(muteList({ pubkeys: [{ type: 'pubkey', value: BOB }] }), event)).toBe(
      false
    );
  });

  it('catches a muted word — the kind of mute the food filter used to switch off', () => {
    expect(isEventMutedBy(muteList({ words: [{ type: 'word', value: 'spoiler' }] }), event)).toBe(
      true
    );
  });

  it('catches a muted tag', () => {
    expect(isEventMutedBy(muteList({ tags: [{ type: 'tag', value: 'foodstr' }] }), event)).toBe(
      true
    );
  });

  it('catches a muted thread', () => {
    expect(isEventMutedBy(muteList({ threads: [{ type: 'thread', value: NOTE_ID }] }), event)).toBe(
      true
    );
  });

  it('tolerates an event with missing fields', () => {
    const list = muteList({
      pubkeys: [{ type: 'pubkey', value: ALICE }],
      words: [{ type: 'word', value: 'spoiler' }],
      tags: [{ type: 'tag', value: 'foodstr' }],
      threads: [{ type: 'thread', value: NOTE_ID }]
    });
    expect(isEventMutedBy(list, {})).toBe(false);
    expect(isEventMutedBy(list, { pubkey: BOB })).toBe(false);
    expect(isEventMutedBy(list, { pubkey: ALICE })).toBe(true);
  });

  it('does not mute on an empty-string id or pubkey', () => {
    // An unsigned/blank event must not collide with a mute entry.
    const list = muteList({
      pubkeys: [{ type: 'pubkey', value: '' }],
      threads: [{ type: 'thread', value: '' }]
    });
    expect(isEventMutedBy(list, { id: '', pubkey: '' })).toBe(false);
  });
});
