import { nip19 } from 'nostr-tools';
import { extractRecipeDetails, parseMarkdownForEditing, type RecipeDetails } from '$lib/parser';
import { publishedAt } from './posts';
import { TOPIC_NAMESPACE } from './archive';
import { LABELER_PUBKEY, type RelayEvent } from './relay';
import type { TopicGroup } from './topicList';

/**
 * What the "From the recipe box" card shows, read from the recipe itself.
 * Every field is optional: a recipe without an image gets no hero, one
 * without times or servings gets no chips, one without an ingredients
 * section gets no peek.
 */

export const PEEK_COUNT = 3;

export interface RecipeBoxData {
  title: string;
  image: string | null;
  /** The recipe page, or null without a `d` tag. */
  href: string | null;
  /** Detail chips, in order: prep, cook, servings. */
  chips: { key: 'prep' | 'cook' | 'servings'; label: string }[];
  /** The first PEEK_COUNT ingredients. */
  ingredients: string[];
  /** Ingredients beyond the peek. */
  moreIngredients: number;
  /** First published (`published_at`, else `created_at`), seconds. */
  sharedAt: number;
}

/**
 * A chip-sized time: the leading duration, units abbreviated.
 * "21 hours 30 minutes" → "21 h 30 min"; "30 min active cook time…" → "30 min";
 * "10-12 hours for the meat, plus…" → "10-12 h". Text without a leading
 * number ("overnight") is kept as written (and clipped by the caller).
 */
export function shortTime(v: string): string {
  const abbreviated = v
    .replace(/\bhours?\b|\bhrs?\b/gi, 'h')
    .replace(/\bminutes?\b|\bmins?\b/gi, 'min')
    .replace(/\s+/g, ' ')
    .trim();
  const n = String.raw`~?\s*\d+(?:[.,/]\d+)?(?:\s*[-–]\s*\d+(?:[.,/]\d+)?)?`;
  const unit = String.raw`(?:h|min|days?|d|secs?|seconds?|s)\b`;
  const lead = abbreviated.match(new RegExp(`^${n}(?:\\s*${unit})?(?:\\s*${n}\\s*${unit})?`, 'i'));
  return lead ? lead[0].trim() : abbreviated;
}

/** Markdown emphasis and links out of an ingredient line. */
function plain(line: string): string {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const CHIP_MAX = 24;
function clip(s: string): string {
  return s.length > CHIP_MAX ? s.slice(0, CHIP_MAX - 1).trimEnd() + '…' : s;
}

export function recipeBoxData(
  e: Pick<RelayEvent, 'kind' | 'pubkey' | 'tags' | 'content' | 'created_at'>
): RecipeBoxData {
  const tag = (k: string) => e.tags.find((t) => t[0] === k)?.[1]?.trim() || '';
  // The address uses the `d` value exactly as published (the recipe page
  // queries it verbatim), as recipeAddress does; only display trims.
  const rawD = e.tags.find((t) => t[0] === 'd')?.[1] ?? '';
  const d = rawD.trim();
  let href: string | null = null;
  if (rawD) {
    try {
      href = `/recipe/${nip19.naddrEncode({ identifier: rawD, kind: e.kind, pubkey: e.pubkey })}`;
    } catch {
      href = null;
    }
  }
  const content = e.content || '';
  // The shared parsers can throw on malformed markdown (a Details line
  // with no value); one bad recipe then shows no chips, not a broken feed.
  let details: RecipeDetails = { prepTime: null, cookTime: null, servings: null };
  try {
    details = extractRecipeDetails(content);
  } catch {
    // keep the empty details
  }
  const chips: RecipeBoxData['chips'] = [];
  if (details.prepTime)
    chips.push({ key: 'prep', label: `Prep ${clip(shortTime(details.prepTime))}` });
  if (details.cookTime)
    chips.push({ key: 'cook', label: `Cook ${clip(shortTime(details.cookTime))}` });
  if (details.servings) chips.push({ key: 'servings', label: `Serves ${clip(details.servings)}` });
  let all: string[] = [];
  try {
    all = parseMarkdownForEditing(content).ingredients.map(plain).filter(Boolean);
  } catch {
    // no peek
  }
  return {
    title: tag('title') || d || 'Untitled recipe',
    image: tag('image') || null,
    href,
    chips,
    ingredients: all.slice(0, PEEK_COUNT),
    moreIngredients: Math.max(0, all.length - PEEK_COUNT),
    sharedAt: publishedAt(e) ?? e.created_at
  };
}

/** "Shared 1 year ago" for the recipe's first publication. */
export function sharedAgo(timestamp: number, now = Math.floor(Date.now() / 1000)): string {
  const days = Math.max(0, Math.floor((now - timestamp) / 86400));
  const ago = (n: number, unit: string) => `Shared ${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (days < 1) return 'Shared today';
  if (days < 30) return ago(days, 'day');
  if (days < 365) return ago(Math.floor(days / 30), 'month');
  return ago(Math.floor(days / 365), 'year');
}

/**
 * Each event's top topic name, from the relay labeler's kind-1985 events:
 * the first topic label on the event, named from the topic catalog (a
 * group's own slug names the group). Labels from anyone else are ignored.
 */
export function topTopics(labels: RelayEvent[], groups: TopicGroup[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const g of groups) {
    names.set(g.slug, g.name);
    for (const t of g.topics) names.set(t.slug, t.name);
  }
  const out = new Map<string, string>();
  for (const ev of labels) {
    if (ev.kind !== 1985 || ev.pubkey !== LABELER_PUBKEY) continue;
    const name = ev.tags
      .filter((t) => t[0] === 'l' && t[2] === TOPIC_NAMESPACE && t[1])
      .map((t) => names.get(t[1]))
      .find(Boolean);
    if (!name) continue;
    for (const t of ev.tags) if (t[0] === 'e' && t[1] && !out.has(t[1])) out.set(t[1], name);
  }
  return out;
}
