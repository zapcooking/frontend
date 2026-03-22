import { browser } from '$app/environment';
import { NOURISH_CACHE_VERSION, type NourishScores, type ScanResponse } from './types';

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Recipe score cache (keyed by eventId) ───────────────────

interface CacheEntry {
	scores: NourishScores;
	timestamp: number;
	version: string;
}

function cacheKey(eventId: string): string {
	return `nourish_${eventId}`;
}

export function getNourishScores(eventId: string): NourishScores | null {
	if (!browser) return null;

	try {
		const raw = localStorage.getItem(cacheKey(eventId));
		if (!raw) return null;

		const entry: CacheEntry = JSON.parse(raw);

		if (entry.version !== NOURISH_CACHE_VERSION) return null;
		if (Date.now() - entry.timestamp > CACHE_TTL_MS) return null;

		return entry.scores;
	} catch {
		return null;
	}
}

export function setNourishScores(eventId: string, scores: NourishScores): void {
	if (!browser) return;

	try {
		const entry: CacheEntry = {
			scores,
			timestamp: Date.now(),
			version: NOURISH_CACHE_VERSION
		};
		localStorage.setItem(cacheKey(eventId), JSON.stringify(entry));
	} catch {
		// localStorage full or unavailable — silently ignore
	}
}

// ─── Scan result cache (keyed by content hash) ──────────────

interface ScanCacheEntry {
	data: ScanResponse;
	timestamp: number;
	version: string;
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

		if (entry.version !== NOURISH_CACHE_VERSION) return null;
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
			version: NOURISH_CACHE_VERSION
		};
		localStorage.setItem(hashText(text), JSON.stringify(entry));
	} catch {
		// localStorage full — silently ignore
	}
}
