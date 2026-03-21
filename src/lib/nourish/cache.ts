import { browser } from '$app/environment';
import { NOURISH_CACHE_VERSION, type NourishScores } from './types';

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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
