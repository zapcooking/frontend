/**
 * The composer attachment model: an attachment is a slot on the draft, not
 * text in the editor.
 *
 *   draft = {
 *     text:  "what the person actually wrote",
 *     media: [ { url, alt, isVideo, ... }, ... ],   // ordered, authoritative
 *   }
 *
 * `text` never contains an attachment URL. `media` is an ordered array and
 * its order is the only ordering that exists — nothing else records it.
 *
 * Two pure functions bridge the two at publish time, and they are the entire
 * contract. Both composers (PostComposer, ReplyComposer) call them from
 * here; anything either one reimplements will diverge.
 *
 * The wire format does not change: the URL in the note content is still what
 * every client reads, so a note of bare URLs publishes byte-identical to
 * what it published before any of this existed.
 */

import { buildImetaTag, normalizeAltBreaks } from './feed/imeta';

/** A single bare http(s) URL token: scheme, then no whitespace. */
const BARE_URL_TOKEN = /^https?:\/\/\S+$/i;

/** One attachment slot on the draft. `alt` hangs off the slot so it follows
 * its image through a reorder for free. */
export interface MediaAttachment {
  url: string;
  alt?: string;
  isVideo?: boolean;
}

/** Alt descriptions are capped by code points, never by `String.slice`
 * code units — a `slice(0, 2000)` on a string ending in an emoji ships half
 * a surrogate pair. Matches the alt editor's input cap. */
export const MAX_ALT_CODEPOINTS = 2000;

/** Count characters, not code units: `Array.from` iterates code points. */
export function capByCodePoints(text: string, max: number): string {
  return Array.from(text).slice(0, max).join('');
}

/**
 * What the note says on the wire: the prose, then one blank line, then the
 * media URLs in draft order, one per line. Also what Preview shows, so the
 * review window previews the note that will go out rather than the half the
 * editor was showing. Duplicate slots keep their URLs — attaching the same
 * image twice carries it twice, exactly as pasting the URL twice in the
 * text era did.
 */
export function composeNoteContent(text: string, media: MediaAttachment[]): string {
  const prose = String(text || '').trim();
  const urls = (media || []).map((m) => m && m.url).filter(Boolean);
  if (!urls.length) return prose;
  return (prose ? prose + '\n\n' : '') + urls.join('\n');
}

/**
 * One NIP-92 `imeta` tag per DESCRIBED attachment, in draft order.
 * Undescribed media contributes nothing at all — an empty description emits
 * no tag, never an empty one. Half the value of alt text is that its
 * absence is legible; a note carrying `alt ""` for every image looks
 * described, which is worse than carrying nothing.
 *
 * The same URL may occupy more than one slot (attaching the same image
 * twice is allowed; the note content carries its URL twice) — but one
 * picture gets one tag, so tags are deduped by URL and the first described
 * occurrence wins.
 */
export function imetaTagsForMedia(media: MediaAttachment[]): string[][] {
  const tags: string[][] = [];
  const tagged = new Set<string>();
  for (const m of media || []) {
    if (!m || !m.url) continue;
    const alt = capByCodePoints(normalizeAltBreaks(m.alt || '').trim(), MAX_ALT_CODEPOINTS);
    if (!alt || tagged.has(m.url)) continue;
    tagged.add(m.url);
    tags.push(buildImetaTag(m.url, { alt }));
  }
  return tags;
}

/**
 * Migration for drafts saved under the old model, which carried the URLs in
 * their text: strip any line that is exactly an attachment's URL, or
 * publishing appends it a second time.
 *
 * Only a boundary occurrence is stripped — the URL alone on its own line. A
 * URL a person deliberately wrote inside a sentence ("mirror at
 * https://x/a.png if the first dies") is authored prose and survives. A URL
 * twice on one line is ambiguous; it is left alone.
 */
export function stripAttachmentUrlLines(text: string, urls: string[]): string {
  if (!text) return text;
  const wanted = new Set(urls.filter(Boolean));
  if (!wanted.size) return text;
  const lines = text.split('\n');
  const kept = lines.filter((line) => !wanted.has(line.trim()));
  if (kept.length === lines.length) return text;
  return kept.join('\n');
}

/**
 * Bare http(s) URLs offered as attachment slots: every URL occurrence on a
 * line that contains ONLY URLs (whitespace-separated) — so a run of pasted
 * links all surface, duplicates included (each accept consumes one
 * occurrence), and accepting one leaves the rest as candidates on their
 * own. A line with any non-URL word is authored prose and offers nothing.
 *
 * Deliberately more liberal than [stripAttachmentUrlLines]: the migration
 * strip only takes exact single-URL lines because it guesses; this feeds an
 * explicit user-tapped offer, so no guess is involved. Paste itself inserts
 * text — the offer is the only thing that converts.
 */
export function attachableUrlCandidates(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    if (tokens.length && tokens.every((t) => BARE_URL_TOKEN.test(t))) out.push(...tokens);
  }
  return out;
}

/**
 * Remove the FIRST occurrence of [url] as a whitespace-delimited token on a
 * URL-only line — the counterpart of accepting one offer. An emptied line
 * is removed entirely so no blank line lingers; other tokens on the line
 * stay. A URL on a line with any non-URL word is authored prose and is
 * never touched. Returns the original text when there is no occurrence to
 * consume (stale offer, fast double-tap).
 */
export function removeBareUrlOccurrence(text: string, url: string): string {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const tokens = lines[i].trim().split(/\s+/).filter(Boolean);
    if (!tokens.length || !tokens.every((t) => BARE_URL_TOKEN.test(t))) continue;
    const at = tokens.indexOf(url);
    if (at === -1) continue;
    tokens.splice(at, 1);
    if (tokens.length) lines[i] = tokens.join(' ');
    else lines.splice(i, 1);
    return lines.join('\n');
  }
  return text;
}
