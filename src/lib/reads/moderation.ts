/**
 * Pure Reads moderation: normalize, scan, and blocklist checks.
 *
 * No I/O. Client and server both call `evaluateReadsContent` with the
 * merged lists (seed + KV overlay). Side effects (logging a keyword hit,
 * auto-blocking a pubkey) live in the client/server wrappers.
 */

import { nip19 } from 'nostr-tools';
import type { ReadsModerationLists } from './moderationConfig';
import { DEFAULT_READS_MODERATION } from './moderationConfig';

export type { ReadsModerationLists };

const BODY_SCAN_CHARS = 500;
const HEX64 = /^[0-9a-f]{64}$/;

/** Common lookalikes used to dodge keyword filters. */
const HOMOGLYPHS: Record<string, string> = {
	а: 'a',
	е: 'e',
	о: 'o',
	р: 'p',
	с: 'c',
	х: 'x',
	у: 'y',
	і: 'i',
	ѕ: 's',
	Α: 'a',
	α: 'a',
	Ε: 'e',
	ε: 'e',
	Ο: 'o',
	ο: 'o',
	Ρ: 'p',
	ρ: 'p',
	Τ: 't',
	τ: 't',
	Υ: 'y',
	υ: 'y',
	Χ: 'x',
	χ: 'x',
	Ι: 'i',
	ι: 'i',
	Ν: 'n',
	ν: 'n',
	Κ: 'k',
	κ: 'k',
	Μ: 'm',
	μ: 'm',
	ß: 'ss',
	ø: 'o',
	Ø: 'o'
};

const LEET: Record<string, string> = {
	'0': 'o',
	'1': 'i',
	'3': 'e',
	'4': 'a',
	'5': 's',
	'7': 't',
	'@': 'a',
	$: 's'
};

export interface ReadsEventLike {
	id?: string;
	pubkey?: string;
	content?: string;
	tags?: string[][];
	kind?: number;
}

export type ReadsBlockReason = 'pubkey' | 'event' | 'naddr' | 'keyword';

export interface ReadsModerationHit {
	blocked: true;
	reason: ReadsBlockReason;
	matchedTerm?: string;
	field?: 'title' | 'summary' | 'body' | 'hashtag';
	pubkey?: string;
	eventId?: string;
	naddr?: string;
}

export interface ReadsModerationClean {
	blocked: false;
}

export type ReadsModerationResult = ReadsModerationHit | ReadsModerationClean;

export interface ReadsPointer {
	pubkey?: string;
	eventId?: string;
	naddr?: string;
	identifier?: string;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Lowercase, strip zero-width / combining marks, fold homoglyphs and light
 * leetspeak, and turn punctuation into spaces so "n.a.k.e.d" and "big-ass"
 * still scan. Does not touch the original string.
 */
export function normalizeForScan(input: string): string {
	if (!input) return '';
	const stripped = input
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\u00ad]/g, '');

	let folded = '';
	for (const ch of stripped) {
		folded += HOMOGLYPHS[ch] ?? LEET[ch] ?? ch;
	}

	return folded
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function tagValue(tags: string[][] | undefined, name: string): string {
	if (!tags) return '';
	const row = tags.find((t) => t[0] === name && t[1]);
	return row?.[1] || '';
}

function hashtagValues(tags: string[][] | undefined): string[] {
	if (!tags) return [];
	return tags.filter((t) => t[0] === 't' && t[1]).map((t) => t[1]);
}

export function naddrFromEvent(event: ReadsEventLike): string | null {
	const d = tagValue(event.tags, 'd');
	const pubkey = event.pubkey;
	if (!d || !pubkey || !HEX64.test(pubkey.toLowerCase())) return null;
	try {
		return nip19.naddrEncode({
			kind: event.kind && event.kind > 0 ? event.kind : 30023,
			pubkey: pubkey.toLowerCase(),
			identifier: d
		});
	} catch {
		return null;
	}
}

export function decodeNaddr(naddr: string): { pubkey: string; identifier: string; kind: number } | null {
	if (!naddr || !naddr.toLowerCase().startsWith('naddr1')) return null;
	try {
		const decoded = nip19.decode(naddr);
		if (decoded.type !== 'naddr') return null;
		const data = decoded.data as nip19.AddressPointer;
		if (!data.pubkey || !data.identifier) return null;
		return {
			pubkey: data.pubkey.toLowerCase(),
			identifier: data.identifier,
			kind: data.kind || 30023
		};
	} catch {
		return null;
	}
}

function hexSet(values: string[]): Set<string> {
	const out = new Set<string>();
	for (const v of values) {
		const n = v.trim().toLowerCase();
		if (HEX64.test(n)) out.add(n);
	}
	return out;
}

function naddrSet(values: string[]): Set<string> {
	const out = new Set<string>();
	for (const v of values) {
		const n = v.trim().toLowerCase();
		if (n.startsWith('naddr1')) out.add(n);
	}
	return out;
}

export interface CompiledReadsLists {
	pubkeys: Set<string>;
	eventIds: Set<string>;
	naddrs: Set<string>;
	terms: CompiledTerm[];
}

interface CompiledTerm {
	raw: string;
	normalized: string;
	pattern: RegExp;
}

function termToPattern(normalized: string): RegExp {
	const words = normalized.split(' ').filter(Boolean);
	if (words.length === 0) {
		return /(?!)/; // never matches
	}
	if (words.length === 1) {
		const letters = [...words[0]];
		// Allow optional separators between letters so "n.a.k.e.d" / "n a k e d"
		// still hit. Word boundaries keep "foodporn" from matching "porn".
		const inner = letters.map(escapeRegex).join('[\\s._\\-]*');
		return new RegExp(`\\b${inner}\\b`, 'i');
	}
	const inner = words.map(escapeRegex).join('[\\s._\\-]+');
	return new RegExp(`\\b${inner}\\b`, 'i');
}

function compileLists(lists: ReadsModerationLists): CompiledReadsLists {
	const terms: CompiledTerm[] = [];
	const seen = new Set<string>();
	for (const raw of lists.denylist) {
		const normalized = normalizeForScan(raw);
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		terms.push({ raw, normalized, pattern: termToPattern(normalized) });
	}
	terms.sort((a, b) => b.normalized.length - a.normalized.length);
	return {
		pubkeys: hexSet(lists.blockedPubkeys),
		eventIds: hexSet(lists.blockedEventIds),
		naddrs: naddrSet(lists.blockedNaddrs),
		terms
	};
}

let cachedDefault: CompiledReadsLists | null = null;

export function compiledDefaultLists(): CompiledReadsLists {
	if (!cachedDefault) cachedDefault = compileLists(DEFAULT_READS_MODERATION);
	return cachedDefault;
}

export function compileModerationLists(lists: ReadsModerationLists): CompiledReadsLists {
	return compileLists(lists);
}

function scanField(
	text: string,
	terms: CompiledTerm[]
): { term: string } | null {
	if (!text) return null;
	const haystack = normalizeForScan(text);
	if (!haystack) return null;
	for (const term of terms) {
		if (term.pattern.test(haystack)) {
			return { term: term.raw };
		}
	}
	return null;
}

export function findDeniedTerm(
	text: string,
	lists: ReadsModerationLists | CompiledReadsLists = compiledDefaultLists()
): string | null {
	const compiled = 'terms' in lists ? lists : compileLists(lists);
	return scanField(text, compiled.terms)?.term ?? null;
}

function pointerBlocked(
	pointer: ReadsPointer,
	compiled: CompiledReadsLists
): Omit<ReadsModerationHit, 'blocked'> | null {
	const pubkey = pointer.pubkey?.trim().toLowerCase();
	if (pubkey && compiled.pubkeys.has(pubkey)) {
		return { reason: 'pubkey', pubkey };
	}

	const eventId = pointer.eventId?.trim().toLowerCase();
	if (eventId && compiled.eventIds.has(eventId)) {
		return { reason: 'event', eventId, pubkey };
	}

	const naddr = pointer.naddr?.trim().toLowerCase();
	if (naddr) {
		if (compiled.naddrs.has(naddr)) {
			return { reason: 'naddr', naddr, pubkey };
		}
		const decoded = decodeNaddr(naddr);
		if (decoded && compiled.pubkeys.has(decoded.pubkey)) {
			return { reason: 'pubkey', pubkey: decoded.pubkey, naddr };
		}
	}

	return null;
}

export function isBlockedReadsPointer(
	pointer: ReadsPointer,
	lists: ReadsModerationLists | CompiledReadsLists = compiledDefaultLists()
): boolean {
	const compiled = 'terms' in lists ? lists : compileLists(lists);
	return pointerBlocked(pointer, compiled) !== null;
}

/**
 * Evaluate an article (or recipe-shaped kind 30023) against the blocklist
 * and keyword denylist. Pure: no logging, no mutation.
 */
export function evaluateReadsContent(
	event: ReadsEventLike,
	lists: ReadsModerationLists | CompiledReadsLists = compiledDefaultLists()
): ReadsModerationResult {
	const compiled = 'terms' in lists ? lists : compileLists(lists);
	const pubkey = event.pubkey?.trim().toLowerCase();
	const eventId = event.id?.trim().toLowerCase();
	const naddr = naddrFromEvent(event) ?? undefined;

	const listed = pointerBlocked({ pubkey, eventId, naddr }, compiled);
	if (listed) {
		return { blocked: true, ...listed, pubkey, eventId, naddr };
	}

	const title = tagValue(event.tags, 'title');
	const summary = tagValue(event.tags, 'summary');
	const body = (event.content || '').slice(0, BODY_SCAN_CHARS);
	const hashtags = hashtagValues(event.tags);

	const titleHit = scanField(title, compiled.terms);
	if (titleHit) {
		return {
			blocked: true,
			reason: 'keyword',
			matchedTerm: titleHit.term,
			field: 'title',
			pubkey,
			eventId,
			naddr
		};
	}

	const summaryHit = scanField(summary, compiled.terms);
	if (summaryHit) {
		return {
			blocked: true,
			reason: 'keyword',
			matchedTerm: summaryHit.term,
			field: 'summary',
			pubkey,
			eventId,
			naddr
		};
	}

	for (const tag of hashtags) {
		const tagHit = scanField(tag, compiled.terms);
		if (tagHit) {
			return {
				blocked: true,
				reason: 'keyword',
				matchedTerm: tagHit.term,
				field: 'hashtag',
				pubkey,
				eventId,
				naddr
			};
		}
	}

	const bodyHit = scanField(body, compiled.terms);
	if (bodyHit) {
		return {
			blocked: true,
			reason: 'keyword',
			matchedTerm: bodyHit.term,
			field: 'body',
			pubkey,
			eventId,
			naddr
		};
	}

	return { blocked: false };
}

export function isDeniedReadsContent(
	event: ReadsEventLike,
	lists: ReadsModerationLists | CompiledReadsLists = compiledDefaultLists()
): boolean {
	return evaluateReadsContent(event, lists).blocked;
}

export function mergeReadsLists(
	base: ReadsModerationLists,
	overlay: Partial<ReadsModerationLists> | null | undefined
): ReadsModerationLists {
	if (!overlay) return cloneLists(base);
	const union = (a: string[], b?: string[]) => {
		const out: string[] = [];
		const seen = new Set<string>();
		for (const raw of [...a, ...(b || [])]) {
			const n = raw.trim().toLowerCase();
			if (!n || seen.has(n)) continue;
			seen.add(n);
			out.push(n);
		}
		return out;
	};
	return {
		blockedPubkeys: union(base.blockedPubkeys, overlay.blockedPubkeys),
		blockedEventIds: union(base.blockedEventIds, overlay.blockedEventIds),
		blockedNaddrs: union(base.blockedNaddrs, overlay.blockedNaddrs),
		// Denylist: if overlay provides one, it replaces (admin is source of
		// truth after first save). Otherwise keep seed.
		denylist: overlay.denylist && overlay.denylist.length > 0
			? uniqueNormalized(overlay.denylist)
			: uniqueNormalized(base.denylist)
	};
}

function uniqueNormalized(values: string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const raw of values) {
		const trimmed = raw.trim();
		if (!trimmed) continue;
		const key = normalizeForScan(trimmed) || trimmed.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(trimmed);
	}
	return out;
}

export function cloneLists(lists: ReadsModerationLists): ReadsModerationLists {
	return {
		blockedPubkeys: [...lists.blockedPubkeys],
		blockedEventIds: [...lists.blockedEventIds],
		blockedNaddrs: [...lists.blockedNaddrs],
		denylist: [...lists.denylist]
	};
}

export function isHex64(value: string | undefined | null): value is string {
	return !!value && HEX64.test(value.trim().toLowerCase());
}

export function isNaddr(value: string | undefined | null): value is string {
	return !!value && value.trim().toLowerCase().startsWith('naddr1') && value.trim().length > 10;
}
