import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Source-level guard, in the same spirit as postEngagementToggle.test.ts.
 *
 * NDK's subscription grouping merges same-shaped filters created close
 * together. Every note on a thread page requests engagement with an
 * identical filter shape, so grouping turned a thread into a single REQ
 * with one `#e` value per note, which the relay then truncated — each
 * note saw a fraction of its reactions. Nothing in a unit test can
 * observe NDK's grouping, so this pins the call site instead.
 */
describe('engagement subscription options', () => {
  const source = readFileSync('src/lib/engagementCache.ts', 'utf8');

  it('opts out of NDK subscription grouping', () => {
    expect(source).toMatch(/ndk\.subscribe\(\s*filter,\s*\{[^}]*groupable:\s*false/);
  });

  it('keeps the subscription open past EOSE for live updates', () => {
    expect(source).toMatch(/ndk\.subscribe\(\s*filter,\s*\{[^}]*closeOnEose:\s*false/);
  });
});
