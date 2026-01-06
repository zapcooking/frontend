import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { displayCurrency, getCurrencyByCode, type CurrencyCode } from './currencyStore';

export const conversionLoading = writable<boolean>(false);
export const conversionError = writable<string | null>(null);

// Cache rates for 5 minutes
const CACHE_DURATION = 5 * 60 * 1000;

interface RateCache {
	rates: Map<string, number>;
	lastFetched: number;
}

let rateCache: RateCache = {
	rates: new Map(),
	lastFetched: 0
};

function isCacheValid(): boolean {
	return Date.now() - rateCache.lastFetched < CACHE_DURATION;
}

/**
 * Convert satoshis to fiat value
 * Uses @getalby/lightning-tools for exchange rates with caching
 */
export async function convertSatsToFiat(
	satoshis: number,
	currencyCode?: CurrencyCode
): Promise<number | null> {
	if (!browser) return null;

	const code = currencyCode || get(displayCurrency);

	// SATS means no conversion needed
	if (code === 'SATS') return null;

	// Check cache first
	const cacheKey = code.toLowerCase();
	if (isCacheValid() && rateCache.rates.has(cacheKey)) {
		const rate = rateCache.rates.get(cacheKey)!;
		return (satoshis * rate) / 100_000_000;
	}

	try {
		conversionLoading.set(true);
		conversionError.set(null);

		// Dynamic import to avoid SSR issues
		const { getFiatValue } = await import('@getalby/lightning-tools');
		const value = await getFiatValue({
			satoshi: satoshis,
			currency: code.toLowerCase()
		});

		// Calculate and cache the rate (value per BTC)
		if (satoshis > 0) {
			const rate = (value / satoshis) * 100_000_000;
			rateCache.rates.set(cacheKey, rate);
			rateCache.lastFetched = Date.now();
		}

		return value;
	} catch (error) {
		console.error('Fiat conversion error:', error);
		conversionError.set('Unable to fetch exchange rate');
		return null;
	} finally {
		conversionLoading.set(false);
	}
}

/**
 * Format a fiat value with proper locale and currency symbol
 */
export function formatFiatValue(value: number | null, currencyCode?: CurrencyCode): string {
	if (value === null) return '--';

	const code = currencyCode || get(displayCurrency);
	if (code === 'SATS') return '';

	const currency = getCurrencyByCode(code);

	try {
		return value.toLocaleString(currency.locale, {
			style: 'currency',
			currency: code,
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		});
	} catch {
		// Fallback formatting
		return `${currency.symbol}${value.toFixed(2)}`;
	}
}

/**
 * Get formatted fiat string directly from satoshis
 * Convenience function combining convert + format
 */
export async function getFormattedFiat(
	satoshis: number,
	currencyCode?: CurrencyCode
): Promise<string> {
	const value = await convertSatsToFiat(satoshis, currencyCode);
	return formatFiatValue(value, currencyCode);
}

/**
 * Clear the rate cache (useful for testing or manual refresh)
 */
export function clearRateCache(): void {
	rateCache = {
		rates: new Map(),
		lastFetched: 0
	};
}
