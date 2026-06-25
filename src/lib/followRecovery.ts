/**
 * Follow List Recovery
 *
 * Scans a user's relays (plus a broad archival set) for historical kind:3
 * follow list events and lets the user republish a previously-overwritten
 * version. Ported from https://github.com/dmnyc/mutable.
 *
 * The "largest most-recent non-empty" version is highlighted as the
 * recommended pick, since cross-client kind:3 overwrites are the most
 * common way a follow graph gets clobbered.
 */

import { SimplePool } from 'nostr-tools/pool';
import type { Event, EventTemplate } from 'nostr-tools';

const FOLLOW_LIST_KIND = 3;

const DEFAULT_RELAYS = [
	'wss://relay.damus.io',
	'wss://relay.primal.net',
	'wss://nos.lol',
	'wss://relay.snort.social',
	'wss://purplepag.es',
	'wss://relay.nostr.net'
];

const ARCHIVAL_RELAYS = [
	'wss://nostr.wine',
	'wss://offchain.pub',
	'wss://nostr.mom',
	'wss://relay.noswhere.com',
	'wss://cache0.primal.net',
	'wss://cache1.primal.net',
	'wss://cache2.primal.net'
];

export interface FollowListCandidate {
	event: Event;
	eventId: string;
	createdAt: number;
	followCount: number;
	followPubkeys: string[];
	foundOnRelays: string[];
	isCurrent: boolean;
	isRecommended: boolean;
}

export interface FollowRecoveryScanResult {
	current: FollowListCandidate | null;
	candidates: FollowListCandidate[];
	recommended: FollowListCandidate | null;
	queriedRelays: string[];
	respondingRelays: string[];
}

export interface RecoverFollowListResult {
	eventId: string;
	accepted: string[];
	rejected: { relay: string; reason: string }[];
}

export interface ScanOptions {
	timeoutMs?: number;
	extraRelays?: string[];
	onProgress?: (message: string) => void;
}

function dedupeRelays(relays: string[]): string[] {
	return [...new Set(relays.filter((r) => r.startsWith('wss://')))];
}

function extractFollowPubkeys(event: Event): string[] {
	return event.tags
		.filter((tag) => tag[0] === 'p' && typeof tag[1] === 'string' && tag[1])
		.map((tag) => tag[1]);
}

async function queryRelayForFollowEvents(
	pool: SimplePool,
	relay: string,
	pubkey: string,
	timeoutMs: number
): Promise<Event[]> {
	try {
		const events = await Promise.race([
			pool.querySync([relay], { kinds: [FOLLOW_LIST_KIND], authors: [pubkey], limit: 10 }),
			new Promise<Event[]>((_, reject) =>
				setTimeout(() => reject(new Error(`timeout: ${relay}`)), timeoutMs)
			)
		]);
		return events;
	} catch {
		return [];
	}
}

export async function scanFollowListHistory(
	pubkey: string,
	userRelays: string[] = [],
	options: ScanOptions = {}
): Promise<FollowRecoveryScanResult> {
	const { timeoutMs = 6000, extraRelays = [], onProgress } = options;
	const pool = new SimplePool();

	const relays = dedupeRelays([
		...userRelays,
		...DEFAULT_RELAYS,
		...ARCHIVAL_RELAYS,
		...extraRelays
	]);

	onProgress?.(`Querying ${relays.length} relays…`);

	const respondingRelays: string[] = [];
	const candidatesById = new Map<string, FollowListCandidate>();

	await Promise.all(
		relays.map(async (relay) => {
			const events = await queryRelayForFollowEvents(pool, relay, pubkey, timeoutMs);
			if (events.length > 0) respondingRelays.push(relay);

			for (const event of events) {
				const followPubkeys = extractFollowPubkeys(event);
				let entry = candidatesById.get(event.id);
				if (!entry) {
					entry = {
						event,
						eventId: event.id,
						createdAt: event.created_at,
						followCount: followPubkeys.length,
						followPubkeys,
						foundOnRelays: [],
						isCurrent: false,
						isRecommended: false
					};
					candidatesById.set(event.id, entry);
				}
				if (!entry.foundOnRelays.includes(relay)) {
					entry.foundOnRelays.push(relay);
				}
			}
		})
	);

	pool.close(relays);

	const allCandidates = Array.from(candidatesById.values()).sort(
		(a, b) => b.createdAt - a.createdAt
	);

	const current = allCandidates[0] ?? null;
	if (current) current.isCurrent = true;

	const recommended = pickRecommendedRecovery(allCandidates, current);
	if (recommended) recommended.isRecommended = true;

	const count = allCandidates.length;
	onProgress?.(
		`Found ${count} distinct version${count === 1 ? '' : 's'} across ${respondingRelays.length}/${relays.length} relays.`
	);

	return { current, candidates: allCandidates, recommended, queriedRelays: relays, respondingRelays };
}

export function pickRecommendedRecovery(
	candidates: FollowListCandidate[],
	current: FollowListCandidate | null
): FollowListCandidate | null {
	const ranked = [...candidates]
		.sort((a, b) => b.followCount - a.followCount || b.createdAt - a.createdAt)
		.filter((c) => c.followCount > 0);

	if (ranked.length === 0) return null;

	const currentCount = current?.followCount ?? 0;
	const currentId = current?.eventId ?? null;

	for (const candidate of ranked) {
		if (candidate.eventId === currentId) continue;
		if (candidate.followCount > currentCount) return candidate;
	}

	return null;
}

export async function recoverFollowList(
	candidate: FollowListCandidate,
	userRelays: string[] = [],
	publishTimeoutMs = 15000
): Promise<RecoverFollowListResult> {
	if (typeof window === 'undefined' || !window.nostr) {
		throw new Error('No signer available');
	}

	const preservedTags = candidate.event.tags.filter(
		(tag) => tag[0] === 'p' && typeof tag[1] === 'string' && tag[1]
	);

	const template: EventTemplate = {
		kind: FOLLOW_LIST_KIND,
		tags: preservedTags,
		content: candidate.event.content ?? '',
		created_at: Math.floor(Date.now() / 1000)
	};

	const signed = await (window as any).nostr.signEvent(template);
	const pool = new SimplePool();

	const publishRelays = dedupeRelays([
		...(userRelays.length ? userRelays : DEFAULT_RELAYS),
		...ARCHIVAL_RELAYS
	]);

	const accepted: string[] = [];
	const rejected: { relay: string; reason: string }[] = [];

	const publishPromises = pool.publish(publishRelays, signed);

	await Promise.all(
		publishPromises.map((p, i) =>
			Promise.race([
				p.then(
					() => accepted.push(publishRelays[i]),
					(err: unknown) => rejected.push({ relay: publishRelays[i], reason: String(err) })
				),
				new Promise<void>((resolve) =>
					setTimeout(() => {
						rejected.push({ relay: publishRelays[i], reason: 'timeout' });
						resolve();
					}, publishTimeoutMs)
				)
			])
		)
	);

	pool.close(publishRelays);

	if (accepted.length === 0) {
		throw new Error('All relays rejected the restored follow list');
	}

	return { eventId: signed.id, accepted, rejected };
}
