/**
 * Human-readability gate for post content surfaced in search results.
 *
 * Search relays index every kind-1 event, including machine payloads:
 * bots posting JSON blobs, hex/base64-looking data walls, and notes that
 * are nothing but a bech32 identifier. Rendering those as search results
 * reads as broken, so both the dropdown's Posts section and the /search
 * feed filter through here. The gate is deliberately conservative — only
 * clearly non-human content is rejected.
 */

/** Things that are machine tokens even though they're valid prose chars. */
const MACHINE_TOKEN_RE =
  /https?:\/\/\S+|nostr:\S+|(npub|note|nevent|naddr|nprofile|nsec)1[a-z0-9]+/gi;

function stripMachineTokens(content: string): string {
  return content.replace(MACHINE_TOKEN_RE, ' ');
}

/**
 * Long run of base64/hex-ish characters — no spaces, mixed case+digits.
 * Human text (even 44-letter German compounds) stays under ~45 chars;
 * data walls are hundreds.
 */
function hasLongOpaqueRun(content: string): boolean {
  const runs = content.match(/[A-Za-z0-9+/=]{60,}/g) || [];
  // Bech32 and URLs were stripped first; anything left of this length is
  // a data blob.
  return runs.some((run) => !/^[0-9]+$/.test(run));
}

export function isHumanReadablePostContent(content: string | undefined | null): boolean {
  if (!content) return false;
  const trimmed = content.trim();
  if (trimmed.length === 0) return false;

  // JSON objects/arrays are payloads, not prose. (Numbers/strings that
  // parse as JSON are fine and rejected only by the opaque-run check.)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return false;
    } catch {
      // Starts like JSON but doesn't parse — likely prose with a bracket;
      // let the remaining checks decide.
    }
  }

  const withoutTokens = stripMachineTokens(trimmed);
  if (hasLongOpaqueRun(withoutTokens)) return false;

  // After stripping machine tokens, nothing human may remain (a bare URL
  // note is still worth showing, but a bare identifier is not).
  return withoutTokens.replace(/\s+/g, '').length > 0;
}

/**
 * Snippet text for a search result row: single line, whitespace-normalized,
 * machine tokens (URLs, bech32 ids) kept since they carry meaning but
 * truncated overall.
 */
export function postSnippet(content: string | undefined | null, max = 90): string {
  if (!content) return '';
  return content
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
