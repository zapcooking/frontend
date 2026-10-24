import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import { ONLYFOOD_BLOCKED_PUBKEYS, passesOnlyFoodStopgap } from './onlyFoodStopgap';

const BLOCKED_NPUB = 'npub1r069yjws95tycya0pc805vcg69t74up6tdlmawr08f8t8m26zmnsmz0gaw';
const BLOCKED_HEX = nip19.decode(BLOCKED_NPUB).data as string;

describe('OnlyFood stopgap denylist', () => {
  it('stores the hex that the commented npub decodes to', () => {
    expect(ONLYFOOD_BLOCKED_PUBKEYS.has(BLOCKED_HEX)).toBe(true);
  });

  it('excludes an event from the blocked pubkey', () => {
    expect(passesOnlyFoodStopgap({ pubkey: BLOCKED_HEX })).toBe(false);
    expect(passesOnlyFoodStopgap({ pubkey: BLOCKED_HEX.toUpperCase() })).toBe(false);
  });

  it('passes an event from a normal pubkey', () => {
    expect(passesOnlyFoodStopgap({ pubkey: 'a'.repeat(64) })).toBe(true);
    expect(passesOnlyFoodStopgap({})).toBe(true);
  });
});
