import { describe, expect, it } from 'vitest';
import { eventKindLabel, kindCaption } from './eventKindLabel';

describe('eventKindLabel', () => {
  it('labels the kinds the drawer surfaces', () => {
    expect(eventKindLabel(0)).toBe('PROFILE');
    expect(eventKindLabel(1)).toBe('NOTE');
    expect(eventKindLabel(3)).toBe('FOLLOWS');
    expect(eventKindLabel(4)).toBe('DM');
    expect(eventKindLabel(5)).toBe('DELETION');
    expect(eventKindLabel(6)).toBe('REPOST');
    expect(eventKindLabel(7)).toBe('REACTION');
    expect(eventKindLabel(20)).toBe('PICTURE');
    expect(eventKindLabel(21)).toBe('VIDEO');
    expect(eventKindLabel(22)).toBe('VIDEO');
    expect(eventKindLabel(1059)).toBe('GIFT WRAP');
    expect(eventKindLabel(1068)).toBe('POLL');
    expect(eventKindLabel(1111)).toBe('COMMENT');
    expect(eventKindLabel(6969)).toBe('ZAP POLL');
    expect(eventKindLabel(30023)).toBe('ARTICLE');
    expect(eventKindLabel(30078)).toBe('APP DATA');
  });

  it('returns null for unknown kinds', () => {
    expect(eventKindLabel(9999)).toBeNull();
  });
});

describe('kindCaption', () => {
  it('formats known kinds as KIND <n> · <LABEL>', () => {
    expect(kindCaption(1111)).toBe('KIND 1111 · COMMENT');
    expect(kindCaption(1)).toBe('KIND 1 · NOTE');
  });

  it('degrades unknown kinds to a bare KIND <n>', () => {
    expect(kindCaption(1234)).toBe('KIND 1234');
  });

  it('treats a missing kind as zero rather than crashing', () => {
    expect(kindCaption(undefined)).toBe('KIND 0 · PROFILE');
    expect(kindCaption(null)).toBe('KIND 0 · PROFILE');
  });
});
