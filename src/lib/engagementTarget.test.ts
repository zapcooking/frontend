import { describe, expect, it } from 'vitest';
import { getEngagementTargetId, targetsEvent, engagementTargetsNote } from './engagementTarget';

// Live payload shape from the bug report (Damus reaction to a reply,
// carrying root + intermediary context): the reaction targets the LAST
// tag, not the root or the intermediary it passes through.
const ROOT = '169c9e5206f57472048a4f7f33cf518c7bd88c45fc6f5d7db3d3b7b934f213f1';
const INTERMEDIARY = '5642ad912c9658ea4e99cd73fbfd4b2d3202ace97c2bb7809e6f0a8d95de80e8';
const TARGET = '5516783eb01000000000000000000000000000000000000000000000000dead';

describe('getEngagementTargetId', () => {
  it('uses the last positional tag for context-tagged events', () => {
    const tags = [
      ['e', ROOT, 'wss://eden.nostr.land'],
      ['e', INTERMEDIARY, ''],
      ['e', TARGET, ''],
      ['p', 'aa'.repeat(32)]
    ];
    expect(getEngagementTargetId(tags)).toBe(TARGET);
  });

  it('prefers a reply-marked tag over positional ones', () => {
    const tags = [
      ['e', ROOT, '', 'root'],
      ['e', TARGET, '', 'reply']
    ];
    expect(getEngagementTargetId(tags)).toBe(TARGET);
  });

  it('returns the only tag for a single-tag reaction', () => {
    expect(getEngagementTargetId([['e', TARGET], ['p', 'ff'.repeat(32)]])).toBe(TARGET);
  });

  it('returns the last positional tag even when a root marker is present', () => {
    const tags = [
      ['e', ROOT, '', 'root'],
      ['e', TARGET]
    ];
    expect(getEngagementTargetId(tags)).toBe(TARGET);
  });

  it('falls back to a lone root-marked tag', () => {
    expect(getEngagementTargetId([['e', ROOT, '', 'root']])).toBe(ROOT);
  });

  it('never targets mention-marked tags', () => {
    const tags = [
      ['e', ROOT, '', 'root'],
      ['e', INTERMEDIARY, '', 'mention']
    ];
    // No positional or reply tag exists; degenerate fallback is the last
    // e tag overall — document that behavior explicitly.
    expect(getEngagementTargetId(tags)).toBe(INTERMEDIARY);
  });

  it('returns null when there are no e tags', () => {
    expect(getEngagementTargetId([['p', 'ff'.repeat(32)]])).toBeNull();
    expect(getEngagementTargetId(undefined)).toBeNull();
    expect(getEngagementTargetId([])).toBeNull();
  });

  it('ignores malformed tags', () => {
    const tags = [['e'], ['e', ''], ['e', TARGET]] as string[][];
    expect(getEngagementTargetId(tags)).toBe(TARGET);
  });
});

describe('targetsEvent', () => {
  const contextReaction = [
    ['e', ROOT, 'wss://eden.nostr.land'],
    ['e', INTERMEDIARY, ''],
    ['e', TARGET, '']
  ];

  it('accepts the effective target only', () => {
    expect(targetsEvent(contextReaction, TARGET)).toBe(true);
    expect(targetsEvent(contextReaction, INTERMEDIARY)).toBe(false);
    expect(targetsEvent(contextReaction, ROOT)).toBe(false);
  });

  it('rejects when there are no e tags', () => {
    expect(targetsEvent([['p', 'ff'.repeat(32)]], TARGET)).toBe(false);
  });
});

describe('engagementTargetsNote', () => {
  const contextReaction = [
    ['e', ROOT, 'wss://eden.nostr.land'],
    ['e', INTERMEDIARY, ''],
    ['e', TARGET, '']
  ];

  it('applies the strict rule to reactions and comments', () => {
    expect(engagementTargetsNote(contextReaction, 7, TARGET)).toBe(true);
    expect(engagementTargetsNote(contextReaction, 7, ROOT)).toBe(false);
    expect(engagementTargetsNote(contextReaction, 1, INTERMEDIARY)).toBe(false);
  });

  it('keeps any-position matching for zap receipts', () => {
    expect(engagementTargetsNote(contextReaction, 9735, ROOT)).toBe(true);
    expect(engagementTargetsNote(contextReaction, 9735, INTERMEDIARY)).toBe(true);
    expect(engagementTargetsNote([['p', 'ff'.repeat(32)]], 9735, ROOT)).toBe(false);
  });
});
