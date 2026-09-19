/**
 * Hashtag suggestion pills under the kind-1 composer.
 *
 * A row of tappable tags. Tapping one appends `#tag` to the body; tapping it
 * again removes every `#tag` token. Nothing is added unless the user taps.
 * The body is the single source of truth: a pill reads as selected when its
 * tag is in the body, whether typed or tapped, and the counter counts the
 * body exactly as the feed's cap does (`$lib/hashtags`).
 *
 * Mirrors `OnlyFoodCompose` in zapcooking_ios (PR #83). The body edits are
 * pure functions so they can be tested without a component.
 */

import { MAX_HASHTAGS, countContentHashtags, extractHashtags } from './hashtags';

/**
 * The suggested set, measured from 60 days of relay usage on the OnlyFood
 * relays. The first eight are the set iOS ships; `foodstr` and `food`
 * dominate, `cookstr` and `lunch` are thin but are the community's own tags.
 *
 * `gratitude` is web's addition, for the theme. It is not in the food feed's
 * tag set and not a food word, so a note carrying only it does not reach the
 * Global feed or any relay-side filter; it rides alongside the food tags.
 */
export const SUGGESTED_HASHTAGS: readonly string[] = [
  'foodstr',
  'food',
  'cooking',
  'cookstr',
  'breakfast',
  'lunch',
  'dinner',
  'coffee',
  'gratitude'
];

/** Is `tag` in the body, however it got there? Case-insensitive. */
export function isHashtagSelected(content: string, tag: string): boolean {
  return extractHashtags(content).includes(tag.toLowerCase());
}

/** The counter's number: hashtag tokens in the body, as the feed counts. */
export function suggestedTagCount(content: string): number {
  return countContentHashtags(content);
}

/** At the cap: unselected pills stop responding. */
export function atHashtagCap(content: string): boolean {
  return suggestedTagCount(content) >= MAX_HASHTAGS;
}

/** Over the cap, which only typing can reach: the counter turns red. */
export function overHashtagCap(content: string): boolean {
  return suggestedTagCount(content) > MAX_HASHTAGS;
}

/**
 * Append `#tag` to the body. Tags gather on a trailing tag line: if the last
 * non-blank line is only hashtags, the tag joins it; otherwise it starts a
 * new paragraph. Trailing whitespace is dropped first so the result is
 * deterministic.
 */
export function appendHashtag(content: string, tag: string): string {
  const body = trimTrailingWhitespace(content);
  if (!body) return `#${tag}`;
  const lastLine = body.slice(body.lastIndexOf('\n') + 1);
  if (isHashtagLine(lastLine)) return `${body} #${tag}`;
  return `${body}\n\n#${tag}`;
}

/**
 * Remove every `#tag` token (case-insensitive, whole token) from the body and
 * tidy the whitespace it leaves behind.
 */
export function removeHashtag(content: string, tag: string): string {
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])#${escapeRegex(tag)}(?![\\p{L}\\p{N}_])`, 'giu');
  let out = content.replace(pattern, '');
  // A removed token leaves a double space, a space against a newline, or a
  // space at the very start.
  out = out.replace(/ {2,}/g, ' ');
  out = out.replace(/ \n/g, '\n').replace(/\n /g, '\n');
  out = out.replace(/^ +/, '');
  return trimTrailingWhitespace(out);
}

/**
 * The pill tap. Selected: remove. Unselected: append, unless the body is at
 * the cap, in which case the tap is a no-op. A selected pill always toggles
 * off, so a slot can be freed at the cap.
 */
export function toggleHashtag(content: string, tag: string): string {
  if (isHashtagSelected(content, tag)) return removeHashtag(content, tag);
  if (atHashtagCap(content)) return content;
  return appendHashtag(content, tag);
}

function isHashtagLine(line: string): boolean {
  const tokens = line.split(/[ \t]+/).filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.every((t) => t.startsWith('#') && t.length > 1);
}

function trimTrailingWhitespace(s: string): string {
  return s.replace(/\s+$/, '');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
