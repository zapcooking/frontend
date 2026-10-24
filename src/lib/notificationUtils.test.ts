import { describe, it, expect, afterEach, vi } from 'vitest';
import type { NDKEvent } from '@nostr-dev-kit/ndk';

// The threshold store reaches for localStorage behind this flag; off keeps it
// in memory, which is all these cases need.
vi.mock('$app/environment', () => ({ browser: false }));

import { isHellthread } from './notificationUtils';
import { hellthreadThreshold } from './hellthreadFilterSettings';

// isHellthread is the single implementation of the member's mention threshold.
// The notification path and the feed both call it, so its edges are worth
// pinning: they now decide what a member sees in Following, not only in
// notifications.

function noteWithMentions(count: number): NDKEvent {
  const tags: string[][] = [['e', 'f'.repeat(64)]];
  for (let i = 0; i < count; i++) {
    tags.push(['p', String(i).padStart(64, '0')]);
  }
  tags.push(['t', 'foodstr']);
  return { tags } as unknown as NDKEvent;
}

afterEach(() => {
  hellthreadThreshold.reset();
});

describe('isHellthread', () => {
  it('hides a note at or above the threshold and keeps one below it', () => {
    hellthreadThreshold.setThreshold(25);

    expect(isHellthread(noteWithMentions(24))).toBe(false);
    expect(isHellthread(noteWithMentions(25))).toBe(true);
    expect(isHellthread(noteWithMentions(26))).toBe(true);
  });

  it('is disabled at 0, the value the settings copy tells the member to use', () => {
    hellthreadThreshold.setThreshold(0);

    expect(isHellthread(noteWithMentions(100))).toBe(false);
  });

  it('defaults to 25 when the member has never set a threshold', () => {
    expect(isHellthread(noteWithMentions(24))).toBe(false);
    expect(isHellthread(noteWithMentions(25))).toBe(true);
  });

  it('counts only p tags', () => {
    hellthreadThreshold.setThreshold(3);

    const otherTags = {
      tags: [
        ['e', 'f'.repeat(64)],
        ['t', 'foodstr'],
        ['t', 'baking'],
        ['q', 'a'.repeat(64)],
        ['p', 'b'.repeat(64)]
      ]
    } as unknown as NDKEvent;

    expect(isHellthread(otherTags)).toBe(false);
    expect(isHellthread(noteWithMentions(3))).toBe(true);
  });

  it('keeps an event whose tags are missing or malformed', () => {
    hellthreadThreshold.setThreshold(1);

    expect(isHellthread({} as unknown as NDKEvent)).toBe(false);
    expect(isHellthread({ tags: undefined } as unknown as NDKEvent)).toBe(false);
    expect(isHellthread({ tags: 'p' } as unknown as NDKEvent)).toBe(false);
    expect(isHellthread({ tags: [null, 'p', ['p', 'x']] } as unknown as NDKEvent)).toBe(true);
  });
});
