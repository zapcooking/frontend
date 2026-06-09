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

/** Error line specific to a failed ingredient scan. */
export const SCAN_ERROR_LINE = 'Cheffy could not read those ingredients. Try a clearer photo.';

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
