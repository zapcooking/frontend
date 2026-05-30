/**
 * Scope-aware promo engine — public server entry point.
 *
 * The implementation still lives in the historically-named cookbook
 * modules (`cookbookPromo.server.ts`, `cookbookPromoStore.server.ts`,
 * `cookbookPricing.ts`), kept in place to avoid churning existing
 * imports. This barrel re-exports them under a scope-neutral name so
 * non-cookbook surfaces (membership, genesis) read clearly:
 *
 *   import { applyPromo } from '$lib/promoEngine.server';
 *   await applyPromo(kv, code, baseUsdCents, 'membership');
 */

export {
	applyPromo,
	resolvePromoConfig,
	isFreePromoApplied,
	DEFAULT_PROMO_CONFIG,
	type PromoLookup
} from '$lib/cookbookPromo.server';

export {
	applyPromoMath,
	scopeAllows,
	ALL_SCOPE_COVERS,
	type PromoApplied,
	type PromoScope
} from '$lib/cookbookPricing';

export {
	loadPromoConfig,
	savePromoConfig,
	setPromoEnabled,
	upsertPromoCode,
	deletePromoCode,
	type PromoEntry,
	type PromoConfigState,
	type PromoKV
} from '$lib/cookbookPromoStore.server';
