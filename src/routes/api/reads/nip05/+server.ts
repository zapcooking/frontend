/**
 * POST /api/reads/nip05 — which "All reads" authors have a verified NIP-05.
 *
 * Body: {"checks": [{"pubkey": "<64 hex>", "nip05": "name@domain"}, …]} (≤ 50).
 * Answer: {"verified": [pubkeys whose nostr.json names them]}, request order.
 *
 * The browser asks only about authors the feed relay doesn't already
 * trust. Each identifier's answer is edge-cached (see nip05Verify.server).
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { NIP05_MAX_CHECKS, verifyNip05Claims, type Nip05Check } from '$lib/reads/nip05Verify.server';

const MAX_BODY_BYTES = 32 * 1024;
const HEX64 = /^[0-9a-f]{64}$/;

function parseChecks(body: unknown): Nip05Check[] | null {
	const checks = (body as { checks?: unknown } | null)?.checks;
	if (!Array.isArray(checks) || checks.length > NIP05_MAX_CHECKS) return null;
	const out: Nip05Check[] = [];
	for (const c of checks) {
		const { pubkey, nip05 } = (c ?? {}) as Record<string, unknown>;
		if (typeof pubkey !== 'string' || !HEX64.test(pubkey) || typeof nip05 !== 'string' || nip05.length > 320) return null;
		out.push({ pubkey, nip05 });
	}
	return out;
}

export const POST: RequestHandler = async ({ request }) => {
	const text = await request.text();
	if (text.length > MAX_BODY_BYTES) return json({ error: 'Body too large' }, { status: 413 });
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}
	const checks = parseChecks(body);
	if (!checks) return json({ error: `Expected {checks: [{pubkey, nip05}]} with at most ${NIP05_MAX_CHECKS}` }, { status: 400 });

	const cache =
		typeof caches !== 'undefined' ? ((caches as unknown as { default?: Cache }).default ?? null) : null;
	const verified = await verifyNip05Claims(checks, { cache });
	return json({ verified }, { headers: { 'cache-control': 'no-store' } });
};
