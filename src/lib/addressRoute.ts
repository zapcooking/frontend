/**
 * Where a *loaded* addressable event belongs.
 *
 * Kind 30023 is both a recipe and a long-form article, so a pointer alone
 * cannot say which page to open; the event can. A recipe is what the app
 * already treats as one everywhere else: it carries a recipe tag, or its
 * content is a valid recipe template (the same two tests the article feeds use
 * to leave recipes out). Anything else in kind 30023 is an article and lives
 * on `/r/`.
 *
 * Returns the path to move to, or null when the current recipe page is right.
 * Deliberately conservative: it only ever moves things that are clearly not
 * recipes, so an untagged recipe in the old template format stays where it was.
 */
import { nip19 } from 'nostr-tools';
import { RECIPE_TAGS } from './consts';
import { validateMarkdownTemplate } from './parser';
import { addressPath } from './nip19Input';

export interface AddressedEvent {
  kind?: number;
  pubkey: string;
  content?: string;
  tags: string[][];
}

/** A recipe by the app's own definition (tag, or recipe-shaped content). */
export function isRecipeLike(event: Pick<AddressedEvent, 'tags' | 'content'>): boolean {
  const tagged = event.tags.some(
    (tag) =>
      Array.isArray(tag) && tag[0] === 't' && RECIPE_TAGS.includes((tag[1] || '').toLowerCase())
  );
  if (tagged) return true;
  // validateMarkdownTemplate returns a string (the error) when it is not a recipe.
  return typeof validateMarkdownTemplate(event.content || '') !== 'string';
}

export function routeForLoadedAddress(event: AddressedEvent): string | null {
  const identifier = event.tags.find((tag) => tag[0] === 'd')?.[1];
  if (event.kind === undefined || identifier === undefined) return null;
  let naddr: string;
  try {
    naddr = nip19.naddrEncode({ kind: event.kind, pubkey: event.pubkey, identifier });
  } catch {
    return null;
  }
  if (event.kind === 30023) {
    return isRecipeLike(event) ? null : `/r/${naddr}`;
  }
  const path = addressPath(event.kind, naddr);
  return path.startsWith('/recipe/') ? null : path;
}
