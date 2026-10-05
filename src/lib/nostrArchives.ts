/**
 * Nostr Archives global name search (sidecar's `na` integration).
 *
 * A second, independent username index beside Primal: sidecar merges it
 * into @-mention and search autocomplete so name lookup survives one
 * index being down, slow, or rate-limited. Unlike sidecar — a
 * privacy-first extension that asks once before ever querying — zap
 * cooking runs it always-on; the only courtesy kept is rate-limit
 * backoff, so a 429 cools down instead of hammering.
 *
 * API: GET /v1/search/suggest?q=&limit= → { suggestions: [{ pubkey,
 * display_name|preferred_name|name, picture }] }; POST /v1/profiles/metadata
 * { pubkeys: [hex] } (≤500 per chunk) → { profiles: [...] }.
 * A 429 backs off until its Retry-After (clamped 30s–3600s).
 */
import { browser } from '$app/environment';
import { nip19 } from 'nostr-tools';

const NA_BASE = 'https://api.nostrarchives.com';

export interface NaSuggestion {
	pubkey: string;
	name: string;
	picture: string | null;
	nip05: string | null;
}

let cooldownUntil = 0;
function naAvailable(): boolean {
	return Date.now() >= cooldownUntil;
}
function naBackoff(retryAfter: string | null): void {
	const secs = Math.min(3600, Math.max(30, Number(retryAfter) || 60));
	cooldownUntil = Date.now() + secs * 1000;
}

function isHex64(s: unknown): s is string {
	return typeof s === 'string' && /^[0-9a-f]{64}$/i.test(s);
}

function shortNpub(pubkey: string): string {
	try {
		const npub = nip19.npubEncode(pubkey);
		return `${npub.slice(0, 10)}…`;
	} catch {
		return `${pubkey.slice(0, 10)}…`;
	}
}

function pickName(p: { display_name?: string; preferred_name?: string; name?: string }): string | null {
	return p.display_name || p.preferred_name || p.name || null;
}

/**
 * Global username search → suggestions. Returns [] on any failure or
 * while cooling down after a rate limit.
 */
export async function naSuggest(query: string, limit = 8): Promise<NaSuggestion[]> {
	if (!browser || !query || query.length < 2 || !naAvailable()) return [];
	try {
		const resp = await fetch(
			`${NA_BASE}/v1/search/suggest?q=${encodeURIComponent(query)}&limit=${limit}`,
			{ signal: AbortSignal.timeout(5000) }
		);
		if (resp.status === 429) {
			naBackoff(resp.headers.get('retry-after'));
			return [];
		}
		if (!resp.ok) return [];
		const data = await resp.json();
		return (data.suggestions || [])
			.filter((s: { pubkey?: unknown }) => s && isHex64(s.pubkey))
			.map((s: { pubkey: string; display_name?: string; preferred_name?: string; name?: string; picture?: string; nip05?: string }) => {
				const pk = s.pubkey.toLowerCase();
				const name = pickName(s) || shortNpub(pk);
				return { pubkey: pk, name, picture: s.picture || null, nip05: s.nip05 || null };
			});
	} catch {
		return [];
	}
}

/**
 * Bulk profile metadata for a set of pubkeys → Map(pubkey → {name, picture}).
 * Chunks to the API's 500-pubkey limit; stops early on a rate limit.
 */
export async function naMetadata(
	pubkeys: string[]
): Promise<Map<string, { name: string | null; picture: string | null }>> {
	const out = new Map<string, { name: string | null; picture: string | null }>();
	if (!browser || !naAvailable()) return out;
	const ids = [...new Set((pubkeys || []).filter(isHex64).map((p) => p.toLowerCase()))];
	for (let i = 0; i < ids.length; i += 500) {
		const chunk = ids.slice(i, i + 500);
		try {
			const resp = await fetch(`${NA_BASE}/v1/profiles/metadata`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ pubkeys: chunk }),
				signal: AbortSignal.timeout(8000)
			});
			if (resp.status === 429) {
				naBackoff(resp.headers.get('retry-after'));
				break;
			}
			if (!resp.ok) continue;
			const data = await resp.json();
			(data.profiles || []).forEach((p: { pubkey?: unknown; display_name?: string; preferred_name?: string; name?: string; picture?: string }) => {
				if (p && isHex64(p.pubkey)) {
					out.set(p.pubkey.toLowerCase(), { name: pickName(p), picture: p.picture || null });
				}
			});
		} catch {
			// Keep whatever resolved so far.
		}
	}
	return out;
}
