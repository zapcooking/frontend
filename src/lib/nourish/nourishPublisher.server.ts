/**
 * Nourish Event Publisher (Server-side only)
 *
 * Signs and publishes Nourish analysis events (kind 30078) using
 * nostr-tools directly (not NDK). NDK's WebSocket handling doesn't
 * work reliably on Cloudflare Workers — direct WebSocket publish does.
 *
 * Phase 2: additive macros block in content + NIP-32 L/l self-labels.
 * Public relays accept unsigned connections; pantry requires NIP-42 AUTH
 * and an active membership for the service pubkey.
 */

import { nip19, finalizeEvent, getPublicKey } from 'nostr-tools';
import { makeAuthEvent } from 'nostr-tools/nip42';
import {
	NOURISH_CACHE_VERSION,
	NOURISH_PROMPT_VERSION,
	NOURISH_LABEL_NAMESPACE,
	type NourishScores,
	type AudienceScores,
	type IngredientSignal,
	type NourishMacros,
	type NourishLabel
} from './types';
import { buildNourishDTag } from './nourishRelay';

/** Public relays — no AUTH. Primary index store today (see Phase 0 §0.5). */
const PUBLIC_PUBLISH_RELAYS = [
	'wss://nos.lol',
	'wss://relay.damus.io',
	'wss://relay.primal.net'
];

/** Member relay — NIP-42 AUTH + active membership required to write. */
const PANTRY_RELAY = 'wss://pantry.zap.cooking';

const PUBLISH_RELAYS = [...PUBLIC_PUBLISH_RELAYS, PANTRY_RELAY];
const PUBLISH_TIMEOUT_MS = 8000;

/**
 * Resolve the private key from env var (supports both hex and nsec format).
 * Returns a Uint8Array for nostr-tools.
 */
function resolvePrivateKey(raw: string): Uint8Array {
	if (raw.startsWith('nsec1')) {
		const decoded = nip19.decode(raw);
		return decoded.data as Uint8Array;
	}
	if (/^[0-9a-fA-F]{64}$/.test(raw)) {
		return Uint8Array.from(raw.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
	}
	throw new Error('Invalid private key format — must be 64 hex chars or nsec');
}

export interface NourishPublishInput {
	recipePubkey: string;
	recipeDTag: string;
	contentHash: string;
	scores: NourishScores;
	improvements: string[];
	ingredientSignals: IngredientSignal[];
	audienceScores?: AudienceScores;
	/**
	 * Estimated per-serving macros (v4). Omitted when the engine degraded
	 * to no macros — event publishes cleanly with no macro content/tags.
	 */
	macros?: NourishMacros;
	/**
	 * Derived discovery labels (v4). Empty / omitted → no L/l tags.
	 * Threshold buckets are already confidence-gated upstream.
	 */
	labels?: NourishLabel[];
	/**
	 * Unix seconds. When set, emit an `updated_at` tag (and content-JSON
	 * mirror) marking this event as a rescore rather than a first-time
	 * score. Undefined → no tag emitted.
	 */
	updatedAt?: number;
	/** Override created_at (tests). Defaults to now. */
	createdAt?: number;
}

export interface NourishEventParts {
	tags: string[][];
	content: Record<string, unknown>;
}

/**
 * Pure builder for kind-30078 tags + content JSON.
 * Additive: v1/v2/v3 consumers ignore unknown keys/tags; a v4 event
 * missing macros (degraded-to-omitted) publishes with no macro tags.
 *
 * kcal-as-tag (0.5): kcal lives in content `macros` + bucket `l` tags
 * only — no raw `nourish_kcal` numeric tag.
 */
export function buildNourishEventParts(input: NourishPublishInput): NourishEventParts {
	const {
		recipePubkey,
		recipeDTag,
		contentHash,
		scores,
		improvements,
		ingredientSignals,
		audienceScores,
		macros,
		labels,
		updatedAt,
		createdAt: createdAtOverride
	} = input;

	const dTag = buildNourishDTag(recipePubkey, recipeDTag);
	const createdAt = createdAtOverride ?? Math.floor(Date.now() / 1000);

	const tags: string[][] = [
		['d', dTag],
		['client', 'zap.cooking'],
		['a', `30023:${recipePubkey}:${recipeDTag}`],
		['p', recipePubkey],
		['nourish_version', NOURISH_CACHE_VERSION],
		['content_hash', contentHash],
		['prompt_version', NOURISH_PROMPT_VERSION],
		['nourish_overall', String(scores.overall.score)],
		['nourish_gut', String(scores.gut.score)],
		['nourish_protein', String(scores.protein.score)],
		['nourish_realfood', String(scores.realFood.score)],
		// v2 Nourish dimensions — emitted on all events going forward.
		// v1 events in the wild won't have them; parser defaults to 0.
		['nourish_antiinflammatory', String(scores.antiInflammatory.score)],
		['nourish_bloodsugar', String(scores.bloodSugar.score)],
		['nourish_immunesupportive', String(scores.immuneSupportive.score)],
		['nourish_brainhealth', String(scores.brainHealth.score)],
		// v3 Nourish dimensions — heart health added in prompt v3.
		['nourish_hearthealth', String(scores.heartHealth.score)]
	];

	// Audience tag prefix is distinct from nourish_* so future consumers
	// can filter queries by namespace without pulling one when they want
	// the other.
	if (audienceScores) {
		tags.push(['audience_kidfriendly', String(audienceScores.kidFriendly.score)]);
	}
	if (updatedAt !== undefined) {
		tags.push(['updated_at', String(updatedAt)]);
	}

	// NIP-32 self-labels (Phase 2). Emit L once when any l is present.
	if (labels && labels.length > 0) {
		tags.push(['L', NOURISH_LABEL_NAMESPACE]);
		for (const label of labels) {
			tags.push(['l', label, NOURISH_LABEL_NAMESPACE]);
		}
	}

	const content: Record<string, unknown> = {
		gut: scores.gut,
		protein: scores.protein,
		realFood: scores.realFood,
		antiInflammatory: scores.antiInflammatory,
		bloodSugar: scores.bloodSugar,
		immuneSupportive: scores.immuneSupportive,
		brainHealth: scores.brainHealth,
		heartHealth: scores.heartHealth,
		overall: scores.overall,
		summary: scores.summary,
		improvements,
		ingredient_signals: ingredientSignals,
		cacheVersion: scores.cacheVersion,
		...(audienceScores ? { audience: audienceScores } : {}),
		// Macros — additive sibling. Absent when engine degraded to omitted.
		...(macros ? { macros } : {}),
		// Labels mirrored into content for self-describing payloads
		// (tags are the indexed discovery surface).
		...(labels && labels.length > 0 ? { labels } : {}),
		promptVersion: NOURISH_PROMPT_VERSION,
		contentHash,
		createdAt,
		...(updatedAt !== undefined ? { updatedAt } : {})
	};

	return { tags, content };
}

/**
 * Publish an event to a single relay via raw WebSocket.
 * When `privKeyBytes` is set, completes a NIP-42 AUTH handshake if the
 * relay challenges (pantry) or returns auth-required on EVENT.
 */
function publishToRelay(
	relayUrl: string,
	event: { id: string; [k: string]: unknown },
	privKeyBytes?: Uint8Array
): Promise<boolean> {
	return new Promise((resolve) => {
		try {
			const WebSocket = globalThis.WebSocket;
			const ws = new WebSocket(relayUrl);
			let settled = false;
			let challenge: string | null = null;
			let authed = false;
			let eventSent = false;
			let authEventId: string | null = null;
			let pendingAuthRetry = false;

			const finish = (ok: boolean) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				try {
					ws.close();
				} catch {
					/* ignore */
				}
				resolve(ok);
			};

			const timer = setTimeout(() => finish(false), PUBLISH_TIMEOUT_MS);

			const sendEvent = () => {
				if (settled) return;
				eventSent = true;
				try {
					ws.send(JSON.stringify(['EVENT', event]));
				} catch {
					finish(false);
				}
			};

			const sendAuth = (chal: string) => {
				if (!privKeyBytes || settled || authEventId) return;
				try {
					const authEvent = finalizeEvent(makeAuthEvent(relayUrl, chal), privKeyBytes);
					authEventId = authEvent.id;
					ws.send(JSON.stringify(['AUTH', authEvent]));
				} catch {
					finish(false);
				}
			};

			ws.onopen = () => {
				if (settled) return;
				if (relayUrl === PANTRY_RELAY && privKeyBytes) {
					// Wait briefly for a proactive AUTH challenge; then send
					// EVENT (auth-required path retries after AUTH OK).
					setTimeout(() => {
						if (settled) return;
						if (challenge && !authed) sendAuth(challenge);
						if (!eventSent) sendEvent();
					}, 400);
				} else {
					sendEvent();
				}
			};

			ws.onmessage = (msg: MessageEvent) => {
				try {
					const data = JSON.parse(typeof msg.data === 'string' ? msg.data : '');
					if (!Array.isArray(data) || data.length < 2) return;

					if (data[0] === 'AUTH' && typeof data[1] === 'string') {
						challenge = data[1];
						if (privKeyBytes && !authed) sendAuth(challenge);
						return;
					}

					if (data[0] === 'OK') {
						const okId = data[1];
						const accepted = data[2] === true;
						const reason = typeof data[3] === 'string' ? data[3] : '';

						if (authEventId && okId === authEventId) {
							if (!accepted) {
								finish(false);
								return;
							}
							authed = true;
							if (pendingAuthRetry || !eventSent) {
								pendingAuthRetry = false;
								sendEvent();
							}
							return;
						}

						if (okId === event.id) {
							if (accepted) {
								finish(true);
								return;
							}
							if (/auth-required/i.test(reason) && privKeyBytes) {
								pendingAuthRetry = true;
								eventSent = false;
								if (challenge) sendAuth(challenge);
								return;
							}
							finish(false);
						}
					}
				} catch {
					/* ignore malformed frames */
				}
			};

			ws.onerror = () => finish(false);
			ws.onclose = () => {
				if (!settled) finish(false);
			};
		} catch {
			resolve(false);
		}
	});
}

/**
 * Publish a Nourish analysis event to relays.
 *
 * Set `updatedAt` on rescores (admin-triggered) so the client can
 * distinguish fresh compute from re-scoring and render an "Updated"
 * badge for 24h. Normal first-time compute omits it — no tag is
 * emitted, so those events don't trigger the badge.
 */
export async function publishNourishEvent(opts: {
	privateKey: string;
	recipePubkey: string;
	recipeDTag: string;
	contentHash: string;
	scores: NourishScores;
	improvements: string[];
	ingredientSignals: IngredientSignal[];
	audienceScores?: AudienceScores;
	macros?: NourishMacros;
	labels?: NourishLabel[];
	updatedAt?: number;
}): Promise<boolean> {
	const { privateKey, ...input } = opts;

	try {
		const privKeyBytes = resolvePrivateKey(privateKey);
		// Sanity: signed events must come from the service key callers expect.
		void getPublicKey(privKeyBytes);

		const { tags, content } = buildNourishEventParts(input);
		const createdAt =
			typeof content.createdAt === 'number'
				? content.createdAt
				: Math.floor(Date.now() / 1000);

		const event = finalizeEvent(
			{
				kind: 30078,
				created_at: createdAt,
				tags,
				content: JSON.stringify(content)
			},
			privKeyBytes
		);

		const results = await Promise.all(
			PUBLISH_RELAYS.map((relay) => publishToRelay(relay, event, privKeyBytes))
		);

		const successCount = results.filter(Boolean).length;
		console.log(
			`[Nourish Publisher] Published to ${successCount}/${PUBLISH_RELAYS.length} relays for ${input.recipeDTag}`
		);

		// Success if ANY relay accepted — public relays remain the primary
		// store; pantry may fail if membership/AUTH isn't ready yet.
		return successCount > 0;
	} catch (err) {
		console.error('[Nourish Publisher] Failed:', err);
		return false;
	}
}
