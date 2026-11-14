import { describe, expect, it } from 'vitest';
import { dayDividerLabel, formatChatTime, isBeforeToday } from './chatTime';

// Built from local-time parts so the tests hold in any time zone.
const at = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(y, mo - 1, d, h, mi).getTime() / 1000;
const NOW = new Date(2026, 10, 13, 15, 0); // Nov 13 2026, 3:00 PM

describe('formatChatTime', () => {
  it('shows only the time for today', () => {
    expect(formatChatTime(at(2026, 11, 13, 9, 5), NOW, 'en-US')).toBe('9:05 AM');
    expect(formatChatTime(at(2026, 11, 13, 0, 1), NOW, 'en-US')).toBe('12:01 AM');
  });

  it('names the date for an earlier day this year', () => {
    expect(formatChatTime(at(2026, 11, 12, 13, 36), NOW, 'en-US')).toBe('Nov 12, 1:36 PM');
    expect(formatChatTime(at(2026, 1, 3, 8, 0), NOW, 'en-US')).toBe('Jan 3, 8:00 AM');
  });

  it('treats late yesterday as a past date, not "today"', () => {
    expect(formatChatTime(at(2026, 11, 12, 23, 59), NOW, 'en-US')).toBe('Nov 12, 11:59 PM');
  });

  it('adds the year for another year', () => {
    expect(formatChatTime(at(2025, 12, 31, 20, 15), NOW, 'en-US')).toBe('Dec 31, 2025, 8:15 PM');
  });

  it('returns nothing for a bad timestamp', () => {
    expect(formatChatTime(NaN, NOW, 'en-US')).toBe('');
  });
});

describe('isBeforeToday', () => {
  it('is false for any time today and true for earlier days', () => {
    expect(isBeforeToday(at(2026, 11, 13, 0, 0), NOW)).toBe(false);
    expect(isBeforeToday(at(2026, 11, 13, 14, 0), NOW)).toBe(false);
    expect(isBeforeToday(at(2026, 11, 12, 23, 59), NOW)).toBe(true);
    expect(isBeforeToday(NaN, NOW)).toBe(false);
  });
});

describe('dayDividerLabel', () => {
  it('adds nothing between messages on the same day', () => {
    expect(dayDividerLabel(at(2026, 11, 13, 9), at(2026, 11, 13, 14), NOW, 'en-US')).toBeNull();
    expect(dayDividerLabel(at(2026, 11, 3, 13), at(2026, 11, 3, 23), NOW, 'en-US')).toBeNull();
  });

  it('labels the day a run of messages starts on', () => {
    expect(dayDividerLabel(at(2026, 11, 2, 22), at(2026, 11, 3, 1), NOW, 'en-US')).toBe('Nov 3');
    expect(dayDividerLabel(at(2026, 11, 11, 22), at(2026, 11, 12, 1), NOW, 'en-US')).toBe('Yesterday');
    expect(dayDividerLabel(at(2026, 11, 12, 22), at(2026, 11, 13, 1), NOW, 'en-US')).toBe('Today');
    expect(dayDividerLabel(at(2025, 12, 30, 22), at(2025, 12, 31, 1), NOW, 'en-US')).toBe('Dec 31, 2025');
  });

  it('opens the list with a divider only when it starts on an earlier day', () => {
    expect(dayDividerLabel(null, at(2026, 11, 3, 13), NOW, 'en-US')).toBe('Nov 3');
    expect(dayDividerLabel(null, at(2026, 11, 13, 9), NOW, 'en-US')).toBeNull();
  });

  it('ignores bad timestamps', () => {
    expect(dayDividerLabel(null, NaN, NOW, 'en-US')).toBeNull();
    expect(dayDividerLabel(NaN, at(2026, 11, 13, 9), NOW, 'en-US')).toBeNull();
  });
});
