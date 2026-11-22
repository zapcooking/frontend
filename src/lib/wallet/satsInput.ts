/**
 * The Send form's amount field: a text field that only holds digits.
 *
 * It used to be `<input type="number">`, preset to 0. A focused number
 * field changes its value on every scroll-wheel / trackpad tick, and the
 * Send button sat below the fold, so scrolling down to it quietly lowered
 * the amount (5,000 became 4,927). The preset 0 also stayed in front of
 * whatever was typed ("01000"). A digits-only text field with
 * inputmode="numeric" keeps the numeric keypad on phones and has none of
 * that: no spinner arrows, no wheel changes, empty until typed.
 */

/** Keep only digits, without leading zeros ('' stays empty). */
export function sanitizeSatsInput(raw: string): string {
  return String(raw ?? '')
    .replace(/\D/g, '')
    .replace(/^0+(?=\d)/, '')
    .replace(/^0$/, '');
}

/** The amount in sats the field holds (0 when empty). */
export function satsFromInput(text: string): number {
  const digits = sanitizeSatsInput(text);
  return digits ? Number(digits) : 0;
}
