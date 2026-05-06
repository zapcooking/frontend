/**
 * /api/admin/promos — admin CRUD for cookbook export promo codes.
 *
 * GET   → returns the resolved config (KV override, else hardcoded
 *         defaults) so the admin UI can render the current state in
 *         a single round trip.
 * POST  → mutate. The body's `action` field discriminates:
 *           - { action: 'toggle', enabled: boolean }
 *           - { action: 'upsert', code, percentOff, flatOff,
 *               expiresAt?, note? }
 *           - { action: 'delete', code }
 *
 * Both verbs are gated by NIP-98 HTTP Auth — the caller signs a
 * kind-27235 event bound to this URL, the request method, and (for
 * POST) the exact request body bytes. Server checks signature, ±60s
 * timestamp skew, URL/method match, body hash, and that the signing
 * pubkey === ADMIN_PUBKEY. Header-only auth would be too weak here:
 * the admin pubkey is public, so a forged x-admin-pubkey header would
 * be enough to read or rewrite live promo config.
 *
 * KV binding: GATED_CONTENT (shared with the cookbook export store).
 * KV propagation across CF edges is eventually consistent (~60s
 * worst case) — admin writes may take that long to be seen by every
 * worker. Acceptable for promo management; we surface this in the UI
 * via a "may take ~1m to propagate" hint.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { ADMIN_PUBKEY } from '$lib/adminAuth';
import { verifyNip98 } from '$lib/nip98.server';
import {
	DEFAULT_PROMO_CONFIG,
	resolvePromoConfig
} from '$lib/cookbookPromo.server';
import {
	deletePromoCode,
	setPromoEnabled,
	upsertPromoCode,
	type PromoEntry
} from '$lib/cookbookPromoStore.server';

const CODE_RE = /^[A-Z0-9_-]{2,32}$/;

export const GET: RequestHandler = async ({ request, platform }) => {
	const auth = await verifyNip98(request, { expectedPubkey: ADMIN_PUBKEY });
	if (!auth.ok) {
		console.warn('[admin.promos.auth-failed]', { method: 'GET', reason: auth.reason });
		return json({ error: 'forbidden' }, { status: 403 });
	}

	const kv = platform?.env?.GATED_CONTENT ?? null;
	const config = await resolvePromoConfig(kv);
	return json({ config, defaults: DEFAULT_PROMO_CONFIG });
};

interface ToggleAction {
	action: 'toggle';
	enabled: boolean;
}
interface UpsertAction {
	action: 'upsert';
	code: string;
	percentOff: number;
	flatOff?: number;
	expiresAt?: number | null;
	note?: string;
}
interface DeleteAction {
	action: 'delete';
	code: string;
}
type AdminAction = ToggleAction | UpsertAction | DeleteAction;

export const POST: RequestHandler = async ({ request, platform }) => {
	// Read body bytes ONCE — the bytes back the NIP-98 payload check
	// AND the JSON parse below. Cloudflare Workers' request.clone()
	// has subtle body-consumption semantics that aren't worth depending
	// on when a single read is enough.
	const bodyBytes = new Uint8Array(await request.arrayBuffer());
	const auth = await verifyNip98(request, {
		expectedPubkey: ADMIN_PUBKEY,
		bodyBytes
	});
	if (!auth.ok) {
		console.warn('[admin.promos.auth-failed]', { method: 'POST', reason: auth.reason });
		return json({ error: 'forbidden' }, { status: 403 });
	}

	const kv = platform?.env?.GATED_CONTENT ?? null;

	let body: AdminAction;
	try {
		body = JSON.parse(new TextDecoder().decode(bodyBytes)) as AdminAction;
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	try {
		if (body.action === 'toggle') {
			if (typeof body.enabled !== 'boolean') {
				return json({ error: 'enabled must be boolean' }, { status: 400 });
			}
			const next = await setPromoEnabled(kv, body.enabled, DEFAULT_PROMO_CONFIG);
			console.log(`[admin.promos] toggle enabled=${body.enabled} by=${auth.pubkey}`);
			return json({ success: true, config: next });
		}

		if (body.action === 'upsert') {
			const code = String(body.code || '').trim().toUpperCase();
			if (!CODE_RE.test(code)) {
				return json(
					{ error: 'Code must be 2–32 chars, A–Z 0–9 _ -' },
					{ status: 400 }
				);
			}
			const percentOff = Number(body.percentOff);
			if (!Number.isFinite(percentOff) || percentOff < 0 || percentOff > 100) {
				return json({ error: 'percentOff must be 0–100' }, { status: 400 });
			}
			const flatOff = Number(body.flatOff ?? 0);
			if (!Number.isFinite(flatOff) || flatOff < 0) {
				return json({ error: 'flatOff must be ≥ 0' }, { status: 400 });
			}
			const entry: PromoEntry = {
				percentOff,
				flatOff
			};
			if (typeof body.expiresAt === 'number' && body.expiresAt > 0) {
				entry.expiresAt = body.expiresAt;
			}
			if (typeof body.note === 'string' && body.note.trim()) {
				entry.note = body.note.trim().slice(0, 200);
			}
			const next = await upsertPromoCode(kv, code, entry, DEFAULT_PROMO_CONFIG);
			console.log(
				`[admin.promos] upsert code=${code} percent=${percentOff} flat=${flatOff} by=${auth.pubkey}`
			);
			return json({ success: true, config: next });
		}

		if (body.action === 'delete') {
			const code = String(body.code || '').trim().toUpperCase();
			if (!CODE_RE.test(code)) {
				return json({ error: 'Invalid code' }, { status: 400 });
			}
			const next = await deletePromoCode(kv, code, DEFAULT_PROMO_CONFIG);
			console.log(`[admin.promos] delete code=${code} by=${auth.pubkey}`);
			return json({ success: true, config: next });
		}

		return json({ error: 'Unknown action' }, { status: 400 });
	} catch (err) {
		console.error('[admin.promos] error:', err);
		return json({ error: 'server_error' }, { status: 500 });
	}
};
