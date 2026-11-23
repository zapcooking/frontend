import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Replies from muted accounts collapse behind a one-line reveal in the
 * thread/comment views (the feed hides them outright — that behavior is
 * unchanged). The user asked for per-reply reveal rather than a global
 * unmute: reading one reply must not surface the muted account's others.
 */
const source = readFileSync(
  fileURLToPath(new URL('./CommentCard.svelte', import.meta.url)),
  'utf8'
);

describe('CommentCard muted-reply handling', () => {
  it('feed variant still hides muted replies outright — no reveal affordance', () => {
    // The feed branch of the condition never consults mutedRevealed.
    expect(source).toMatch(
      /authorMuted && \(variant === 'feed' \|\| !mutedRevealed\)/
    );
    expect(source).toMatch(/\{#if authorMuted && variant !== 'feed' && !mutedRevealed\}/);
  });

  it('non-feed muted replies render a per-card reveal, not the full card', () => {
    // The placeholder branch renders only when the reply is hidden and not
    // yet revealed; the reveal is per-instance state (each reply opens
    // individually).
    expect(source).toMatch(/let mutedRevealed = false;/);
    expect(source).toMatch(/mutedRevealed = true/);
    expect(source).toMatch(/class="muted-reply-reveal"/);
    expect(source).not.toMatch(/mutedRevealed = true;\s*\n\s*(?!.*placeholder)/);
  });

  it('the placeholder identifies the reply without naming the muted account', () => {
    // No display-name lookup or pubkey inside the placeholder row: the
    // point is that the muted account stays out of the reader's face.
    // (Scope: the reveal button only — the branch dispatch after it
    // legitimately mentions pubkeys.)
    const start = source.indexOf('muted-reply-reveal');
    const end = source.indexOf('</button>', start);
    const placeholderBlock = source.slice(start, end);
    expect(placeholderBlock).toContain('Reply from an account you muted');
    expect(placeholderBlock).not.toMatch(/pubkey|displayName|CustomName/);
  });
});
