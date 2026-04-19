import { browser } from '$app/environment';
import { NOURISH_CACHE_VERSION, type NourishScores, type ScanResponse } from './types';

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Cache-schema major version, used as a key prefix so future schema
// breaks can invalidate all prior entries independent of the minor
// version-mismatch check below. Bump by changing NOURISH_CACHE_VERSION
// in types.ts to a new major.
const SCHEMA_MAJOR = NOURISH_CACHE_VERSION.split('.')[0];

// ─── Recipe score cache ──────────────────────────────────────
// Keyed by (recipePubkey, recipeDTag, promptVersion) so that a v1
// score and a v2 score for the same recipe are distinct entries —
// cache hit guarantees version match without a post-read check.

interface CacheEntry {
	scores: NourishScores;
	timestamp: number;
	cacheVersion: string;
	contentHash?: string;
	promptVersion?: string;
	createdAt?: number;
	improvements?: string[];
	ingredientSignals?: import('./types').IngredientSignal[];
}

export interface NourishCacheKey {
	recipePubkey: string;
	recipeDTag: string;
	promptVersion: string;
}

function cacheKey({ recipePubkey, recipeDTag, promptVersion }: NourishCacheKey): string {
	return `nourish_v${SCHEMA_MAJOR}_${recipePubkey}:${recipeDTag}:${promptVersion}`;
}

export function getNourishCache(key: NourishCacheKey): CacheEntry | null {
	if (!browser) return null;

	try {
		const raw = localStorage.getItem(cacheKey(key));
		if (!raw) return null;

		const entry: CacheEntry = JSON.parse(raw);

		if (entry.cacheVersion !== NOURISH_CACHE_VERSION) return null;
		if (Date.now() - entry.timestamp > CACHE_TTL_MS) return null;

		return entry;
	} catch {
		return null;
	}
}

export function setNourishScores(
	key: NourishCacheKey,
	scores: NourishScores,
	extra?: {
		contentHash?: string;
		createdAt?: number;
		improvements?: string[];
		ingredientSignals?: import('./types').IngredientSignal[];
	}
): void {
	if (!browser) return;

	try {
		const entry: CacheEntry = {
			scores,
			timestamp: Date.now(),
			cacheVersion: NOURISH_CACHE_VERSION,
			contentHash: extra?.contentHash,
			promptVersion: key.promptVersion,
			createdAt: extra?.createdAt,
			improvements: extra?.improvements,
			ingredientSignals: extra?.ingredientSignals
		};
		localStorage.setItem(cacheKey(key), JSON.stringify(entry));
	} catch {
		// localStorage full or unavailable — silently ignore
	}
}

// ─── Scan result cache (keyed by content hash) ──────────────

interface ScanCacheEntry {
	data: ScanResponse;
	timestamp: number;
	cacheVersion: string;
}

/** Derive a cache key from text with extra entropy to reduce collisions. */
function hashText(text: string): string {
	const lengthPart = text.length.toString(36);
	const prefixPart = text.slice(0, 32).replace(/[^a-zA-Z0-9]/g, '_');
	let hash = 0;
	for (let i = 0; i < text.length; i++) {
		hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
	}
	return `nourish_scan_${lengthPart}_${prefixPart}_${Math.abs(hash).toString(36)}`;
}

export function getScanResult(text: string): ScanResponse | null {
	if (!browser) return null;

	try {
		const raw = localStorage.getItem(hashText(text));
		if (!raw) return null;

		const entry: ScanCacheEntry = JSON.parse(raw);

		if (entry.cacheVersion !== NOURISH_CACHE_VERSION) return null;
		if (Date.now() - entry.timestamp > CACHE_TTL_MS) return null;

		return entry.data;
	} catch {
		return null;
	}
}

export function setScanResult(text: string, data: ScanResponse): void {
	if (!browser) return;

	try {
		const entry: ScanCacheEntry = {
			data,
			timestamp: Date.now(),
			cacheVersion: NOURISH_CACHE_VERSION
		};
		localStorage.setItem(hashText(text), JSON.stringify(entry));
	} catch {
		// localStorage full — silently ignore
	}
}
