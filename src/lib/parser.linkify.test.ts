// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/nostr', () => ({ ndk: { subscribe: vi.fn() } }));
vi.mock('$lib/profileResolver', () => ({
  resolveProfileByPubkey: vi.fn().mockResolvedValue(null)
}));

import { parseMarkdown } from './parser';

describe('parseMarkdown bare-domain linkification', () => {
  // A `for` loop, not it.each — it.each doesn't typecheck under this
  // repo's svelte-check (same limitation noted in photoAsk.test.ts).
  for (const domain of ['zap.cooking', 'jumble.social', 'wisp.dev', 'nostr.band', 'example.xyz', 'foo.app/path']) {
    it(`links ${domain} despite its newer TLD`, () => {
      expect(parseMarkdown(`see ${domain} for more`)).toContain(`href="http://${domain}"`);
    });
  }

  it('still links legacy TLDs', () => {
    expect(parseMarkdown('see primal.net')).toContain('href="http://primal.net"');
  });

  it('does not link a word followed by a non-TLD suffix', () => {
    expect(parseMarkdown('bake at 350.degreesf')).not.toContain('<a');
  });
});
