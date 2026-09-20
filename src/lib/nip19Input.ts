/**
 * Reading a NIP-19 identifier that a human pasted.
 *
 * Every client renders references as `nostr:nevent1…` — NIP-21's URI form —
 * so that is what lands on the clipboard and that is what people paste into
 * a search box. The bare bech32 the app checks for is the exception, not the
 * rule. This normalizes the input once so each surface can stop
 * hand-rolling `.replace('nostr:', '')`, which the codebase had four
 * slightly different copies of.
 */
import { nip19 } from 'nostr-tools';

/** Where a pasted identifier should take the reader. */
export type Nip19Target =
  | { kind: 'note'; id: string; path: string }
  | { kind: 'profile'; id: string; path: string }
  | { kind: 'address'; id: string; path: string };

/**
 * Strip NIP-21's URI scheme, in either spelling.
 *
 * `web+nostr:` is the registered-handler form some clients write, and both
 * arrive with arbitrary case from copy buttons.
 */
export function stripNostrPrefix(input: string): string {
  return (input || '').trim().replace(/^(?:web\+)?nostr:\/{0,2}/i, '').trim();
}

/**
 * True for a secret key in any form.
 *
 * Worth its own check because the failure is silent and expensive: a search
 * box that treats an unrecognized string as text hands it to a relay as a
 * NIP-50 `search` term, so a mis-paste would publish someone's private key
 * to every search relay the app talks to.
 */
export function isSecretKeyInput(input: string): boolean {
  return /^nsec1[023456789acdefghjklmnpqrstuvwxyz]+$/i.test(stripNostrPrefix(input));
}

/**
 * Resolve pasted text to somewhere the app can navigate, or null when it is
 * an ordinary search term.
 *
 * Decoding rather than prefix-matching: `nevent1` followed by junk is not an
 * identifier, and sending it somewhere as though it were produces a page
 * that can only fail.
 */
export function parseNip19Input(input: string): Nip19Target | null {
  const value = stripNostrPrefix(input);
  if (!value) return null;

  // Never route on a secret key, and never echo one back into a URL.
  if (isSecretKeyInput(value)) return null;

  try {
    const decoded = nip19.decode(value);
    switch (decoded.type) {
      case 'note':
      case 'nevent':
        return { kind: 'note', id: value, path: `/${value}` };
      case 'npub':
      case 'nprofile':
        return { kind: 'profile', id: value, path: `/user/${value}` };
      case 'naddr':
        // Addressable events route through the recipe page, which is what
        // the search bars have always done with an naddr.
        return { kind: 'address', id: value, path: `/recipe/${value}` };
      default:
        return null;
    }
  } catch {
    return null;
  }
}
