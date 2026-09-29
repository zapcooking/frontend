/**
 * Temporary stopgap — remove when curated feed replaces OnlyFood.
 *
 * Hides specific spam accounts from the Global Food (OnlyFood) feed only.
 * Not a moderation system: no UI, no persistence, no other surface reads it.
 */

// Temporary stopgap — remove when curated feed replaces OnlyFood.
export const ONLYFOOD_BLOCKED_PUBKEYS: ReadonlySet<string> = new Set([
  // npub1r069yjws95tycya0pc805vcg69t74up6tdlmawr08f8t8m26zmnsmz0gaw ("ytmeta4", YouTube-mirror bot)
  '1bf45249d02d164c13af0e0efa3308d157eaf03a5b7fbeb86f3a4eb3ed5a16e7'
]);

/** False when the event's author is on the OnlyFood stopgap denylist. */
export function passesOnlyFoodStopgap(event: { pubkey?: string }): boolean {
  return !ONLYFOOD_BLOCKED_PUBKEYS.has((event.pubkey || '').toLowerCase());
}
