import { nip19 } from 'nostr-tools';
import { scanNostrRefs, type ScannedRef } from './nostrRefScan';

/**
 * Plain-text note previews for quote blocks (the "View full thread →" /
 * "View quoted note →" embeds in the feed cards).
 *
 * This used to live as two diverged copies — `cleanContentForPreview` in
 * $lib/replyContext (70 chars, newlines collapsed, mentions dropped) and an
 * inline block in FoodstrFeedOptimized (280 chars, newlines collapsed,
 * mentions resolved via profile fetches). Both collapsed ALL whitespace, so
 * a multi-paragraph parent note read as one run-on sentence. This builder is
 * the single source of truth for both surfaces now:
 *
 * - paragraph breaks survive (the CSS line-clamp on the quote block still
 *   caps the visible height, so newlines can't blow up the layout)
 * - URLs and nostr references are stripped, with nostr references resolved
 *   through the same scanner the full renderer uses (so bare, prefix-less
 *   refs — issue #637 — are handled identically there and here)
 * - npub/nprofile mentions become `@name` when the caller supplies names
 *   (callers that fetched profiles), and are dropped when it can't
 * - truncation is shared: one character budget, cut at a word boundary
 */

/** Character budget before the ellipsis. Generous on purpose: the quote
 *  block's CSS line-clamp caps the visible height, so a larger budget just
 *  lets those lines fill rather than dominating the card. */
export const NOTE_PREVIEW_MAX_LENGTH = 280;

export interface NotePreviewOptions {
  /** Character budget before the ellipsis (default NOTE_PREVIEW_MAX_LENGTH). */
  maxLength?: number;
  /** Hex pubkey → display name for npub/nprofile mentions. Mentions without
   *  an entry here are dropped, never shown as raw bech32. */
  mentionNames?: Map<string, string>;
}

/** Display text for a nostr reference inside a preview, or null to drop it. */
function refText(ref: ScannedRef, mentionNames?: Map<string, string>): string | null {
  if (ref.prefix !== 'npub1' && ref.prefix !== 'nprofile1') return null;
  const token = ref.content.replace(/^nostr:/, '');
  try {
    const decoded = nip19.decode(token);
    const pubkey =
      decoded.type === 'npub'
        ? (decoded.data as string)
        : decoded.type === 'nprofile'
          ? (decoded.data as { pubkey: string }).pubkey
          : '';
    if (!pubkey) return null;
    const name = mentionNames?.get(pubkey);
    // The @ lives here, not in the map: callers supply plain display names.
    return name ? `@${name}` : null;
  } catch {
    // Undecodable token: drop it rather than echo bech32 noise.
    return null;
  }
}

/** Word-boundary truncation: cut back to the last space/newline in the
 *  over-budget slice so previews never end mid-word ("imag..." → "is...").
 *  A boundary earlier in the slice is still preferred over a mid-word cut;
 *  only a slice with no whitespace at all is cut hard. */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const slice = text.slice(0, maxLength);
  const cut = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('\n'));
  return (cut > 0 ? slice.slice(0, cut) : slice).trimEnd() + '...';
}

export function buildNotePreview(content: string, options: NotePreviewOptions = {}): string {
  const { maxLength = NOTE_PREVIEW_MAX_LENGTH, mentionNames } = options;
  if (!content) return '';

  // CRLF would collapse into a space under the horizontal-whitespace pass
  // below, silently eating the paragraph break — normalize first.
  const text = content.replace(/\r\n?/g, '\n');

  let assembled = '';
  let last = 0;
  for (const ref of scanNostrRefs(text)) {
    // Scheme-less domains stay: "see zap.cooking/pow" reads fine as prose,
    // and a fuzzy match is an inference (mirrors the inline-link rule in
    // NoteContent). Explicit http(s) URLs go — they render as cards/media
    // in the full note, not as teaser text.
    if (ref.type === 'url' && ref.bare) continue;

    if (ref.index > last) assembled += text.slice(last, ref.index);
    assembled += refText(ref, mentionNames) ?? '';
    last = ref.index + ref.content.length;
  }
  assembled += text.slice(last);

  return truncate(
    assembled
      // Leftover nostr: tokens the scanner doesn't know (nsec etc.).
      .replace(/nostr:\S+/g, '')
      // Horizontal whitespace runs → one space; newlines survive.
      .replace(/[^\S\n]+/g, ' ')
      // One blank line max: a paragraph break, not a wall of gaps.
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    maxLength
  );
}
