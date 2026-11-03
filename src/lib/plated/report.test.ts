import { describe, it, expect } from 'vitest';
import { readsReportReason, platedReportDetails } from './report';
import { REPORT_TYPES } from '$lib/freshFeed/social';

describe('readsReportReason', () => {
  it('maps nudity to nsfw and spam to spam', () => {
    expect(readsReportReason('nudity')).toBe('nsfw');
    expect(readsReportReason('spam')).toBe('spam');
  });

  it('maps every other report type to other', () => {
    for (const { value } of REPORT_TYPES) {
      if (value === 'nudity' || value === 'spam') continue;
      expect(readsReportReason(value)).toBe('other');
    }
  });

  it('only ever yields a reason the report endpoint accepts', () => {
    for (const { value } of REPORT_TYPES) {
      expect(['nsfw', 'spam', 'other']).toContain(readsReportReason(value));
    }
  });
});

describe('platedReportDetails', () => {
  it('names the recipe and type, and keeps the note when given', () => {
    expect(platedReportDetails('30023:abc:pancakes', 'illegal', '  stolen photo ')).toBe(
      'Plated photo on recipe 30023:abc:pancakes — type: illegal — stolen photo'
    );
    expect(platedReportDetails('30023:abc:pancakes', 'spam', '')).toBe(
      'Plated photo on recipe 30023:abc:pancakes — type: spam'
    );
  });
});
