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

describe('week ids across ISO year boundaries', () => {
  it('2026 is a 53-week ISO year', () => {
    expect(weeksInISOYear(2026)).toBe(53);
    expect(weeksInISOYear(2025)).toBe(52);
  });

  it('Jan 1–3 2027 belong to 2026-W53', () => {
    expect(weekIdForDate(new Date(2027, 0, 1))).toBe('2026-W53');
    expect(weekIdForDate(new Date(2027, 0, 2))).toBe('2026-W53');
    expect(weekIdForDate(new Date(2027, 0, 3))).toBe('2026-W53');
    // Jan 4 2027 is a Monday — first day of 2027-W01
    expect(weekIdForDate(new Date(2027, 0, 4))).toBe('2027-W01');
  });

  it('Dec 29 2025 belongs to 2026-W01', () => {
    expect(weekIdForDate(new Date(2025, 11, 29))).toBe('2026-W01');
    expect(weekIdForDate(new Date(2025, 11, 28))).toBe('2025-W52');
  });

  it('zero-pads single-digit weeks', () => {
    expect(weekIdForDate(new Date(2026, 1, 2))).toBe('2026-W06');
  });
});

describe('week arithmetic', () => {
  it('crosses into and out of W53', () => {
    expect(nextWeekId('2026-W53')).toBe('2027-W01');
    expect(prevWeekId('2027-W01')).toBe('2026-W53');
  });

  it('crosses a 52-week year boundary', () => {
    expect(prevWeekId('2026-W01')).toBe('2025-W52');
    expect(nextWeekId('2025-W52')).toBe('2026-W01');
  });

  it('walks ordinary weeks', () => {
    expect(nextWeekId('2026-W29')).toBe('2026-W30');
    expect(prevWeekId('2026-W29')).toBe('2026-W28');
  });

  it('mondayOfWeek returns the ISO Monday', () => {
    const monday = mondayOfWeek('2026-W29');
    expect(monday.getDay()).toBe(1);
    expect(weekIdForDate(monday)).toBe('2026-W29');
  });
});

describe('d-tag round trip', () => {
  it('encodes and decodes', () => {
    expect(dTagForWeek('2026-W29')).toBe('mealplan-2026-W29');
    expect(weekIdFromDTag('mealplan-2026-W29')).toBe('2026-W29');
  });

  it('rejects foreign or malformed d-tags', () => {
    expect(weekIdFromDTag('grocery-abc123')).toBeNull();
    expect(weekIdFromDTag('mealplan-2026-29')).toBeNull();
    expect(weekIdFromDTag('mealplan-2026-W99')).toBeNull();
  });
});

describe('validation', () => {
  it('accepts real weeks and rejects out-of-range ones', () => {
    expect(isValidWeekId('2026-W53')).toBe(true); // 53-week year
    expect(isValidWeekId('2025-W53')).toBe(false); // 52-week year
    expect(isValidWeekId('2026-W00')).toBe(false);
    expect(isValidWeekId('2026-W54')).toBe(false);
    expect(isValidWeekId('26-W05')).toBe(false);
    expect(isValidWeekId('garbage')).toBe(false);
    expect(parseWeekId('2026-W29')).toEqual({ year: 2026, week: 29 });
  });
});

describe('display range', () => {
  it('formats a same-month week', () => {
    // 2026-W29: Mon Jul 13 – Sun Jul 19
    expect(weekDisplayRange('2026-W29')).toBe('Week 29 (Jul 13–19)');
  });

  it('formats a cross-month week', () => {
    // 2026-W27: Mon Jun 29 – Sun Jul 5
    expect(weekDisplayRange('2026-W27')).toBe('Week 27 (Jun 29–Jul 5)');
  });
});
