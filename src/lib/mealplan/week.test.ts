import { describe, it, expect } from 'vitest';
import {
  weekIdForDate,
  weeksInISOYear,
  parseWeekId,
  isValidWeekId,
  mondayOfWeek,
  nextWeekId,
  prevWeekId,
  dTagForWeek,
  weekIdFromDTag,
  weekDisplayRange
} from './week';
import fixtures from '../../test/fixtures/week.vectors.json';

/** Local calendar date from fixture {y,m,d} (m is 1-indexed). */
function localDate(d: { y: number; m: number; d: number }): Date {
  return new Date(d.y, d.m - 1, d.d);
}

describe('week ids across ISO year boundaries', () => {
  for (const v of fixtures.weeksInISOYear) {
    it(v.id, () => {
      expect(weeksInISOYear(v.year)).toBe(v.expected);
    });
  }

  for (const v of fixtures.weekIdForDate) {
    it(v.id, () => {
      expect(weekIdForDate(localDate(v.date))).toBe(v.expected);
    });
  }
});

describe('week arithmetic', () => {
  for (const v of fixtures.nextWeekId) {
    it(`next:${v.id}`, () => {
      expect(nextWeekId(v.input)).toBe(v.expected);
    });
  }
  for (const v of fixtures.prevWeekId) {
    it(`prev:${v.id}`, () => {
      expect(prevWeekId(v.input)).toBe(v.expected);
    });
  }
  for (const v of fixtures.mondayOfWeek) {
    it(v.id, () => {
      const monday = mondayOfWeek(v.input);
      expect(monday.getDay()).toBe(v.expectedDayOfWeek);
      expect(weekIdForDate(monday)).toBe(v.expectedWeekId);
    });
  }
});

describe('d-tag round trip', () => {
  for (const v of fixtures.dTagRoundTrip) {
    it(v.id, () => {
      expect(dTagForWeek(v.weekId)).toBe(v.dTag);
      expect(weekIdFromDTag(v.dTag)).toBe(v.weekId);
    });
  }
  for (const v of fixtures.weekIdFromDTagReject) {
    it(v.id, () => {
      expect(weekIdFromDTag(v.input)).toBeNull();
    });
  }
});

describe('validation', () => {
  for (const v of fixtures.isValidWeekId) {
    it(v.id, () => {
      expect(isValidWeekId(v.input)).toBe(v.expected);
    });
  }
  for (const v of fixtures.parseWeekId) {
    it(v.id, () => {
      expect(parseWeekId(v.input)).toEqual(v.expected);
    });
  }
});

describe('display range', () => {
  for (const v of fixtures.weekDisplayRange) {
    it(v.id, () => {
      expect(weekDisplayRange(v.input)).toBe(v.expected);
    });
  }
});
