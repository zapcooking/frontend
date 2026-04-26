/**
 * Cookbook promo config store — KV-backed admin storage.
 *
 * Single-key layout in `GATED_CONTENT`:
 *   cb_promo_config → { enabled, codes: { CODE: PromoEntry } }
 *
 * The single-key shape is deliberate. There's at most a handful of
 * promo codes at any one time, and a single read-modify-write keeps
 * the admin operations trivial — no list pagination, no cross-key
 * consistency to worry about. KV is single-writer here (the admin),
 * so the read-modify-write race window is small enough to ignore.
 *
 * If the key is empty (first deploy, or KV was wiped) the lookup path
 * falls back to the hardcoded `DEFAULT_PROMO_CONFIG` in
 * `cookbookPromo.server.ts`, so the system keeps working without an
 * explicit migration step.
 *
 * Note: KV propagation is eventually consistent across CF edges (~60s
 * worst case). An admin toggle may not be immediately visible to all
 * workers — acceptable for promo management; a stale read at worst
 * extends a code's life by a minute.
 */

export interface PromoEntry {
	percentOff: number; // 0-100
	flatOff: number; // sats removed AFTER percent
	expiresAt?: number; // unix ms — undefined = never expires
	note?: string;
}

export interface PromoConfigState {
	enabled: boolean;
	codes: Record<string, PromoEntry>;
}

export type PromoKV =
	| {
			get(key: string, type?: 'text' | 'json'): Promise<string | unknown | null>;
			put(key: string, value: string): Promise<void>;
			delete(key: string): Promise<void>;
	  }
	| null
	| undefined;

const KEY = 'cb_promo_config';

// Dev-only in-memory fallback when no KV binding is bound.
let memState: PromoConfigState | null = null;

/**
 * Load the full promo config. Returns `null` when no override has been
 * stored yet — the caller is responsible for falling back to defaults.
 */
export async function loadPromoConfig(kv: PromoKV): Promise<PromoConfigState | null> {
	if (kv) {
		const raw = (await kv.get(KEY, 'text')) as string | null;
		if (!raw) return null;
		try {
			const parsed = JSON.parse(raw) as PromoConfigState;
			// Defensive: missing fields → treat as null so caller falls
			// back to defaults rather than rendering a broken config.
			if (typeof parsed?.enabled !== 'boolean' || !parsed?.codes) return null;
			return parsed;
		} catch {
			return null;
		}
	}
	return memState;
}

export async function savePromoConfig(kv: PromoKV, state: PromoConfigState): Promise<void> {
	if (kv) {
		await kv.put(KEY, JSON.stringify(state));
	} else {
		memState = state;
	}
}

/** Toggle the global enabled flag. Returns the new state. */
export async function setPromoEnabled(
	kv: PromoKV,
	enabled: boolean,
	defaults: PromoConfigState
): Promise<PromoConfigState> {
	const current = (await loadPromoConfig(kv)) ?? defaults;
	const next: PromoConfigState = { ...current, enabled };
	await savePromoConfig(kv, next);
	return next;
}

/** Create or update a single code. Returns the new state. */
export async function upsertPromoCode(
	kv: PromoKV,
	code: string,
	entry: PromoEntry,
	defaults: PromoConfigState
): Promise<PromoConfigState> {
	const current = (await loadPromoConfig(kv)) ?? defaults;
	const next: PromoConfigState = {
		...current,
		codes: { ...current.codes, [code]: entry }
	};
	await savePromoConfig(kv, next);
	return next;
}

/** Delete a code. No-op if it doesn't exist. Returns the new state. */
export async function deletePromoCode(
	kv: PromoKV,
	code: string,
	defaults: PromoConfigState
): Promise<PromoConfigState> {
	const current = (await loadPromoConfig(kv)) ?? defaults;
	if (!(code in current.codes)) return current;
	const { [code]: _removed, ...rest } = current.codes;
	void _removed;
	const next: PromoConfigState = { ...current, codes: rest };
	await savePromoConfig(kv, next);
	return next;
}
