import type { ProfileState } from './profileStore';

/**
 * Whether the UI may offer to zap a recipient. A zap needs the recipient's
 * NIP-57 lightning address (kind:0 `lud16`): without one ZapManager fails
 * at send time ("User has no lightning address configured"), so the
 * affordance must not be offered at all. Null/empty/whitespace → not
 * offered.
 */
export function canOfferZap(lud16: string | null | undefined): boolean {
	return typeof lud16 === 'string' && lud16.trim().length > 0;
}

/**
 * `canOfferZap` for a profileStore state: offer only once the author's
 * kind:0 is found AND carries a lud16. Loading/missing/unconfirmed stay
 * hidden — prefer hiding over showing a button that would always fail at
 * send time.
 */
export function canOfferZapToProfile(state: ProfileState | null | undefined): boolean {
	return state?.status === 'found' && canOfferZap(state.profile.lud16);
}
