// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { nip19 } from 'nostr-tools';

// The mention pass resolves display names lazily through the NDK
// singleton. Neither is needed to assert the markup, and importing
// `$lib/nostr` for real would open relay connections in the test run.
vi.mock('$lib/nostr', () => ({ ndk: { subscribe: vi.fn() } }));
vi.mock('$lib/profileResolver', () => ({
  resolveProfileByPubkey: vi.fn().mockResolvedValue(null)
}));

import { parseMarkdown, parseMarkdownToEditorHtml } from './parser';

const PUBKEY = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const NPUB = nip19.npubEncode(PUBKEY);
const NPROFILE = nip19.nprofileEncode({ pubkey: PUBKEY, relays: ['wss://relay.example'] });

describe('parseMarkdown profile mentions', () => {
  it('links a bare nostr:npub mention to the profile page', () => {
    const html = parseMarkdown(`Thanks nostr:${NPUB} for the recipe`);
    expect(html).toContain(`href="/user/${NPUB}"`);
    expect(html).toContain('class="nostr-mention"');
    // Unresolved profiles show a shortened npub, never the raw URI.
    expect(html).not.toContain(`nostr:${NPUB}`);
  });

  it('links an nprofile mention to the same profile page', () => {
    const html = parseMarkdown(`Thanks nostr:${NPROFILE} for the recipe`);
    expect(html).toContain(`href="/user/${NPUB}"`);
    expect(html).not.toContain(`nostr:${NPROFILE}`);
  });

  it('keeps the surrounding text intact', () => {
    const html = parseMarkdown(`before nostr:${NPUB} after`);
    expect(html).toContain('before ');
    expect(html).toContain(' after');
  });

  it('leaves a malformed mention as written', () => {
    const written = 'nostr:npub1notrealbech32';
    expect(parseMarkdown(written)).toContain(written);
  });

  it('does not treat a mention as a hashtag target', () => {
    const html = parseMarkdown(`nostr:${NPUB} #brunch`);
    // The hashtag still links, and the mention anchor is not nested in one.
    expect(html).toContain('href="/tag/brunch"');
    expect(html).not.toContain('hashtag-link"><a');
  });

  it('renders an unresolved mention as a shortened npub, not an invented name', () => {
    const html = parseMarkdown(`nostr:${NPUB}`);
    expect(html).toContain(`@${NPUB.slice(0, 10)}`);
    expect(html).toContain(NPUB.slice(-4));
  });
});

describe('parseMarkdownToEditorHtml', () => {
  it('restores a mention as a Tiptap mention span, not a reader anchor', () => {
    const html = parseMarkdownToEditorHtml(`Thanks nostr:${NPUB} for the recipe`);
    expect(html).toContain('data-type="mention"');
    expect(html).toContain(`data-id="${NPUB}"`);
    expect(html).not.toContain('nostr-mention');
    expect(html).not.toContain('href=');
  });

  it('normalizes an nprofile mention to an npub in data-id', () => {
    // Publishing re-adds relay hints, and the turndown rule emits
    // `nostr:${data-id}` verbatim, so the id has to be an npub.
    const html = parseMarkdownToEditorHtml(`Thanks nostr:${NPROFILE}`);
    expect(html).toContain(`data-id="${NPUB}"`);
  });

  it('uses a supplied display name as the label', () => {
    const html = parseMarkdownToEditorHtml(
      `nostr:${NPUB}`,
      new Map([[PUBKEY, 'alice']])
    );
    expect(html).toContain('data-label="alice"');
    expect(html).toContain('@alice');
  });

  it('leaves hashtags as text so the editor does not gain stray links', () => {
    const html = parseMarkdownToEditorHtml('a #brunch post');
    expect(html).toContain('#brunch');
    expect(html).not.toContain('/tag/brunch');
  });

  it('does not embed videos into the editor', () => {
    const html = parseMarkdownToEditorHtml('https://youtu.be/dQw4w9WgXcQ');
    expect(html).not.toContain('<iframe');
  });
});
