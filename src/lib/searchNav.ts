/**
 * Navigation helpers shared by the header's search field and the
 * sidebar's nested search field (≥xl, where the header strip is gone).
 */
import { goto } from '$app/navigation';
import { isSecretKeyInput, parseNip19Input } from '$lib/nip19Input';
import { mobileSearchOpen } from '$lib/stores/mobileSearch';

/** A pasted identifier is a destination, not a search term — and a
    secret key is neither, so it never reaches the results page (which
    would hand it to the search relays verbatim). */
function navigateQuery(query: string) {
  const target = parseNip19Input(query);
  if (target) {
    goto(target.path);
    return true;
  }
  return false;
}

export function openSearch(query: string) {
  mobileSearchOpen.set(false);
  if (isSecretKeyInput(query)) return;
  if (!navigateQuery(query)) {
    goto(`/search?q=${encodeURIComponent(query)}`);
  }
}

export function openTag(query: string) {
  mobileSearchOpen.set(false);
  if (isSecretKeyInput(query)) return;
  // Identifiers route to the thing they name, whether or not they arrived
  // wearing NIP-21's `nostr:` scheme; anything else is a tag.
  if (!navigateQuery(query)) {
    goto(`/tag/${query}`);
  }
}
