/**
 * Auto-detection for the unified Sous Chef input. Consumed by
 * `src/routes/souschef/+page.svelte` to derive the active import mode
 * from a single textarea + optional staged image, replacing the prior
 * three-tab UI.
 *
 * Rules (kept narrow on purpose):
 *   - `hasImage` wins. If an image is staged, mode is always `'image'`
 *     regardless of any text in the textarea (we don't support
 *     multi-modal input — see the consolidation prompt's "out of
 *     scope" list).
 *   - URL only if the entire trimmed input is a single URL token. A
 *     URL on line 1 with recipe text below routes to `'text'` so we
 *     don't accidentally throw the user into the rate-limited URL
 *     path when they pasted a recipe with a source link.
 *   - Text mode requires ≥30 trimmed characters. Below that we return
 *     `null` so the submit button stays disabled while the user is
 *     still typing the first word.
 */

export type SousChefMode = 'image' | 'url' | 'text';

export function detectMode(text: string, hasImage: boolean): SousChefMode | null {
  if (hasImage) return 'image';
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  // URL only if the entire trimmed input is a single URL token.
  // The anchored `^...$` plus `\S+` guarantees no whitespace
  // anywhere in the string — a recipe pasted with a source link at
  // the top falls through to the text branch below.
  if (/^https?:\/\/\S+$/i.test(trimmed)) return 'url';
  if (trimmed.length >= 30) return 'text';
  return null;
}
