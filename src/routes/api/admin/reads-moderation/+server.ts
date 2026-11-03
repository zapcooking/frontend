/**
 * /api/admin/reads-moderation — view/edit Reads blocklists and review log.
 *
 * GET  → { lists, logs }
 * POST → mutate lists:
 *   { action: 'save', lists }
 *   { action: 'block-pubkey', pubkey }
 *   { action: 'unblock-pubkey', pubkey }
 *
 * NIP-98 auth, same as /api/admin/promos.
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { ADMIN_PUBKEY } from '$lib/adminAuth';
import { verifyNip98 } from '$lib/nip98.server';
import {
	addBlockedPubkey,
	listReadsReviewLogs,
	loadReadsModerationLists,
	saveReadsModerationLists,
	type ReadsModerationKV
} from '$lib/reads/moderation.server';
import { DEFAULT_READS_MODERATION, type ReadsModerationLists } from '$lib/reads/moderationConfig';
import { isHex64, isNaddr } from '$lib/reads/moderation';

function kvOf(platform: App.Platform | undefined): ReadsModerationKV {
	return platform?.env?.GATED_CONTENT ?? null;
}

function sanitizeLists(raw: unknown): ReadsModerationLists | null {
	if (!raw || typeof raw !== 'object') return null;
	const v = raw as Record<string, unknown>;
	if (
		!Array.isArray(v.blockedPubkeys) ||
		!Array.isArray(v.blockedEventIds) ||
		!Array.isArray(v.blockedNaddrs) ||
		!Array.isArray(v.denylist)
	) {
		return null;
	}
	const pubkeys = v.blockedPubkeys.filter((x): x is string => typeof x === 'string' && isHex64(x));
	const eventIds = v.blockedEventIds.filter((x): x is string => typeof x === 'string' && isHex64(x));
	const naddrs = v.blockedNaddrs.filter((x): x is string => typeof x === 'string' && isNaddr(x));
	const denylist = v.denylist
		.filter((x): x is string => typeof x === 'string')
		.map((s) => s.trim())
		.filter(Boolean)
		.slice(0, 200);
	return { blockedPubkeys: pubkeys, blockedEventIds: eventIds, blockedNaddrs: naddrs, denylist };
}

export const GET: RequestHandler = async ({ request, platform }) => {
	const auth = await verifyNip98(request, { expectedPubkey: ADMIN_PUBKEY });
	if (!auth.ok) {
		return json({ error: 'forbidden' }, { status: 403 });
	}
	const kv = kvOf(platform);
	const [lists, logs] = await Promise.all([
		loadReadsModerationLists(kv),
		listReadsReviewLogs(kv, 300)
	]);
	return json({ lists, logs, defaults: DEFAULT_READS_MODERATION });
};

export const POST: RequestHandler = async ({ request, platform }) => {
	const bodyBytes = new Uint8Array(await request.arrayBuffer());
	const auth = await verifyNip98(request, {
		expectedPubkey: ADMIN_PUBKEY,
		bodyBytes
	});
	if (!auth.ok) {
		return json({ error: 'forbidden' }, { status: 403 });
	}

	let body: { action?: string; lists?: unknown; pubkey?: string };
	try {
		body = JSON.parse(new TextDecoder().decode(bodyBytes)) as {
			action?: string;
			lists?: unknown;
			pubkey?: string;
		};
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const kv = kvOf(platform);

	try {
		if (body.action === 'save') {
			const lists = sanitizeLists(body.lists);
			if (!lists) return json({ error: 'invalid_lists' }, { status: 400 });
			const next = await saveReadsModerationLists(kv, lists);
			console.log(`[admin.reads-moderation] save by=${auth.pubkey}`);
			return json({ success: true, lists: next });
		}

		if (body.action === 'block-pubkey') {
			const pubkey = String(body.pubkey || '').trim().toLowerCase();
			if (!isHex64(pubkey)) return json({ error: 'invalid_pubkey' }, { status: 400 });
			const next = await addBlockedPubkey(kv, pubkey);
			console.log(`[admin.reads-moderation] block-pubkey ${pubkey} by=${auth.pubkey}`);
			return json({ success: true, lists: next });
		}

		if (body.action === 'unblock-pubkey') {
			const pubkey = String(body.pubkey || '').trim().toLowerCase();
			if (!isHex64(pubkey)) return json({ error: 'invalid_pubkey' }, { status: 400 });
			const current = await loadReadsModerationLists(kv);
			const next = await saveReadsModerationLists(kv, {
				...current,
				blockedPubkeys: current.blockedPubkeys.filter((p) => p !== pubkey)
			});
			console.log(`[admin.reads-moderation] unblock-pubkey ${pubkey} by=${auth.pubkey}`);
			return json({ success: true, lists: next });
		}

		return json({ error: 'Unknown action' }, { status: 400 });
	} catch (err) {
		console.error('[admin.reads-moderation] error:', err);
		return json({ error: 'server_error' }, { status: 500 });
	}
};
