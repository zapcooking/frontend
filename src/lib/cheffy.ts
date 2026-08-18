/**
 * Cheffy — shared voice lines and small helpers for Zap Cooking's
 * kitchen companion.
 *
 * Keeping the memetic lines here (rather than inline on the page) means
 * loading states, zap thank-yous, and error copy can pull from the same
 * rotating pools, and the lines stay reusable for stickers / social /
 * notifications later. Variety matters — `pickLine` avoids immediately
 * repeating the previous line.
 */

/**
 * Cheffy's small, typed set of moods and the two silhouette variants.
 * Canonical home for these types so the store, components, and icon all
 * agree (CheffyIcon re-exports them for its existing consumers).
 */
export type CheffyExpression =
  | 'neutral'
  | 'happy'
  | 'thinking'
  | 'excited'
  | 'concerned'
  | 'cooking';

export type CheffyVariant = 'compact' | 'character';

/** Rotating placeholders for the main Cheffy input. */
export const PROMPT_PLACEHOLDERS: string[] = [
  'What are we cooking?',
  'Tell me what is in your fridge.',
  'Can I substitute yogurt for sour cream?',
  'I burned the bottom. Can this be saved?',
  'I need dinner in 20 minutes.',
  'What goes well with salmon?'
];

/** Shown while Cheffy is preparing a conversational reply. */
export const THINKING_LINES: string[] = [
  'Tasting the idea…',
  'Rummaging through the pantry…',
  'Thinking with my whole spatula…',
  'Checking what plays well together…',
  'Giving it a quick stir…'
];

/** Shown while Cheffy is generating a full structured recipe. */
export const COOKING_LINES: string[] = [
  'Firing up the burners…',
  'Plating this up…',
  'Dinner has entered the chat…',
  'Three ingredients, zero panic…',
  'Crisping the edges…'
];

/** Title line on a successful zap. */
export const ZAP_THANKS_TITLES: string[] = [
  'Cheffy is fully seasoned. ⚡',
  'That put some heat in the kitchen. ⚡',
  'Cheffy says thanks. Dinner lives another day.',
  'Kitchen powered. ⚡'
];

/** Supporting line under the zap thank-you. */
export const ZAP_THANKS_SUBTITLES: string[] = [
  'Your sats keep the burners lit.',
  'We can work with that.',
  'A little fuel never testified against anyone.',
  'Right back into the kitchen it goes.'
];

/** Floating toast after a zap settles. */
export const ZAP_TOAST_LINES: string[] = [
  'Cheffy is fully seasoned. ⚡',
  'That put some heat in the kitchen. ⚡',
  'Kitchen powered. ⚡',
  'Dinner lives another day. ⚡'
];

/**
 * Cooking-flavored error lines. Each is paired in the UI with a real
 * recovery action and the actual technical detail — these never hide a
 * validation, membership, payment, or network error.
 */
export const ERROR_LINES: string[] = [
  'Cheffy dropped a spoon. Try that again.',
  'The kitchen lost the signal for a second.',
  'That request did not finish cooking.',
  'Cheffy got distracted by something on the stove.'
];

/**
 * Error line specific to a failed ingredient scan.
 *
 * The scanner asks exactly one question of a photo — what ingredients
 * are visible — so an empty result usually means the photo was fine and
 * the question was wrong (a plated dish has no ingredients to
 * enumerate). Name that, and point at the path that does answer it,
 * instead of blaming the member's camera.
 *
 * "the photo's still here" is a claim about code, not a reassurance.
 * Both scan surfaces hand the file to the composer as an attached photo
 * on every non-success exit — `handleScan` (CheffyMessenger.svelte) and
 * `handleFileSelect` (routes/cheffy/+page.svelte). If either stops doing
 * that, this sentence points at a photo that isn't there and has to
 * change with it.
 */
export const SCAN_ERROR_LINE =
  "Cheffy didn't spot any ingredients in that one. If it's a finished dish, ask your question below — the photo's still here.";

/**
 * Client-side failure lines for a photo ask.
 *
 * Both replace an exception message that used to reach the member
 * verbatim inside a Cheffy bubble ("User rejected the request.",
 * "window.nostr is undefined"). The underlying message still goes to
 * `console.warn` — it is diagnostic, not copy.
 *
 * Signing is the likeliest failure on this path because it is the only
 * step that depends on software we do not ship, so it gets the line that
 * names where to look. "signer app" is the term the login overlay
 * already uses.
 */
export const PHOTO_SIGN_FAILED_LINE =
  'Cheffy needs your approval to send a photo. Check your signer app and try again.';

export const PHOTO_NETWORK_ERROR_LINE =
  "Cheffy couldn't be reached. Check your connection and try again.";

/**
 * Rejection line for a file the pick-time byte gate does not recognize.
 *
 * THIS IS NOT THE ONLY WAY A PHOTO FAILS, and the wording carries that.
 * The gate is a NARROWING: an animated GIF, a corrupt JPEG with a clean
 * header, anything the model refuses downstream still gets through here
 * and comes back as IMAGE_UNREADABLE from the server, whose own live line
 * is "Cheffy couldn't get a good look at that photo. Try another one?"
 * (ask-photo/+server.ts:275-277, rendered verbatim via cheffyChat.ts:457
 * settleError — the server string wins whenever it exists).
 *
 * So these two lines must NOT read alike. Different events, different
 * costs: this one is instant and nothing left the browser; the server one
 * arrives after a signer approval, an upload and a wait, and carries no
 * Try again button (IMAGE_UNREADABLE is the one non-retryable code). A
 * member who reads the same sentence at both moments learns nothing from
 * the second, which is the expensive one.
 *
 * Hence "doesn't recognize", not "couldn't read": at pick time Cheffy has
 * read nothing. We looked at sixteen bytes and matched no signature.
 *
 * THE LIST IS ADVICE, NOT A SPECIFICATION. identifyPhotoFormat also
 * accepts GIF, and GIF is deliberately absent here: this string renders
 * only when nothing matched, so no GIF holder — animated or still — ever
 * reads it. Listing GIF would spend a clause on a format its reader does
 * not have. The names here answer "what do I convert TO", and the gate
 * remains the specification. Do not sync this list to the gate.
 *
 * The HEIC noun is diagnosis, not spec, and that is why it survives the
 * same rule: it is the one fact that turns into an action outside our
 * product. It renders only when the bytes matched nothing AND the browser
 * independently guessed heic — two signals agreeing.
 *
 * Copy owner: Growth (rev 4). Do not reword without her.
 */
export function photoFormatLine(fileType: string): string {
  if (/heic|heif/i.test(fileType)) {
    return "Cheffy reads JPG, PNG, and WEBP — that one's a HEIC. Try another photo?";
  }
  return "Cheffy doesn't recognize that file — it reads JPG, PNG, and WEBP. Try another photo?";
}

/**
 * Error line for a rate-limited ingredient scan.
 *
 * Derived from the already-shipped note-review limit line
 * (`api/zappy/note-review/+server.ts`, "Cheffy needs a breather — you've
 * hit the photo-review limit for now.") with one noun changed to name
 * the right feature. It exists because the alternatives are both wrong
 * in front of a user: the limiter's own body carries the raw token
 * `rate_limited`, and falling through to SCAN_ERROR_LINE tells someone
 * who is rate-limited to retry with a clearer photo — a retry that also
 * gets a 429.
 */
export const SCAN_RATE_LIMIT_LINE =
  "Cheffy needs a breather — you've hit the fridge-scan limit for now.";

/**
 * Pick a line from a pool, avoiding `avoid` (usually the previously
 * shown line) so consecutive states don't repeat. Falls back to the
 * first line for single-entry pools.
 */
export function pickLine(pool: string[], avoid?: string): string {
  if (pool.length === 0) return '';
  if (pool.length === 1) return pool[0];
  let next = pool[Math.floor(Math.random() * pool.length)];
  // One re-roll is enough to dodge an immediate repeat without risking
  // a pathological loop.
  if (next === avoid) {
    next = pool[(pool.indexOf(next) + 1) % pool.length];
  }
  return next;
}

/**
 * Does this assistant message contain a full, structured recipe (the
 * format the editor can parse), as opposed to a conversational answer?
 *
 * Cheffy only emits the strict format when the user asks for a complete
 * recipe, so this gate decides whether the Save / Share / Zap actions
 * attach to a given message. Requires both an Ingredients and a
 * Directions section under markdown headings.
 */
export function looksLikeStructuredRecipe(md: string): boolean {
  if (!md) return false;
  const hasIngredients = /^##\s*Ingredients\b/im.test(md);
  const hasDirections = /^##\s*Directions\b/im.test(md);
  const hasTitle = /^#\s+\S/m.test(md);
  return hasTitle && hasIngredients && hasDirections;
}

// ── Explore → Cheffy prompt handoff ─────────────────────────────
// Mirrors the existing anon-import handoff pattern (sessionStorage,
// short freshness window) rather than putting a user's prompt in a
// public URL. Lets the Explore card hand a prompt to /cheffy, which
// consumes it once on load and pre-fills the input.

export const CHEFFY_PROMPT_KEY = 'zapcooking:cheffy-prompt';
export const CHEFFY_PROMPT_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

export interface CheffyPromptHandoff {
  prompt: string;
  at: number;
}

/** Stash a prompt for /cheffy to pick up. No-op if storage is blocked. */
export function setCheffyPrompt(prompt: string): void {
  const trimmed = prompt.trim();
  if (!trimmed) return;
  try {
    sessionStorage.setItem(
      CHEFFY_PROMPT_KEY,
      JSON.stringify({
        prompt: trimmed.slice(0, 2000),
        at: Date.now()
      } satisfies CheffyPromptHandoff)
    );
  } catch {
    // Private mode / storage disabled — handoff simply doesn't happen.
  }
}

/**
 * Read and clear a pending Cheffy prompt (single-use). Returns null if
 * absent, stale, or storage is unavailable.
 */
export function consumeCheffyPrompt(): string | null {
  try {
    const raw = sessionStorage.getItem(CHEFFY_PROMPT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(CHEFFY_PROMPT_KEY);
    const parsed = JSON.parse(raw) as CheffyPromptHandoff | null;
    if (
      parsed &&
      typeof parsed.prompt === 'string' &&
      typeof parsed.at === 'number' &&
      Date.now() - parsed.at <= CHEFFY_PROMPT_MAX_AGE_MS
    ) {
      return parsed.prompt;
    }
  } catch {
    // ignore
  }
  return null;
}
