import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { displayCurrency, getCurrencyByCode, type CurrencyCode } from './currencyStore';

export const conversionLoading = writable<boolean>(false);
export const conversionError = writable<string | null>(null);

// Cache rates for 5 minutes
const CACHE_DURATION = 5 * 60 * 1000;

interface RateCache {
	// Maps currency code (lowercase) → fiat value of 1 BTC
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

// ── Centralized Formatting & Conversion Utilities ────────────────────

/**
 * Format a price in its native currency for display.
 * - SATS: "18,500 sats" (whole numbers, comma-separated)
 * - Fiat: "$24", "€8", "$24.50" (up to 2 decimals, no trailing zeros)
 */
export function formatPrice(price: number, currency: CurrencyCode): string {
	if (currency === 'SATS') return formatSats(price);

	const currencyInfo = getCurrencyByCode(currency);
	try {
		return new Intl.NumberFormat(currencyInfo.locale, {
			style: 'currency',
			currency: currency,
			minimumFractionDigits: 0,
			maximumFractionDigits: 2
		}).format(price);
	} catch {
		return `${currencyInfo.symbol}${price}`;
	}
}

/**
 * Format a sats amount as a display string.
 * Always whole numbers with comma separators.
 * Example: 28500 → "28,500 sats"
 */
export function formatSats(amount: number): string {
	return `${Math.round(amount).toLocaleString()} sats`;
}

/**
 * Fetch all BTC exchange rates from yadio.io in a single call.
 * Returns a map of currency code → fiat value of 1 BTC.
 * Caches the result for CACHE_DURATION.
 * Uses an in-flight lock so concurrent callers share one request.
 */
let inflightRatesFetch: Promise<boolean> | null = null;

async function fetchAllRates(): Promise<boolean> {
	if (isCacheValid() && rateCache.rates.size > 0) return true;

	// Deduplicate concurrent calls — all callers await the same promise
	if (inflightRatesFetch) return inflightRatesFetch;

	inflightRatesFetch = (async () => {
		try {
			const res = await fetch('https://api.yadio.io/exrates/BTC');
			if (!res.ok) throw new Error(`yadio.io returned ${res.status}`);
			const data = await res.json();
			const btcRates: Record<string, number> = data.BTC || data;

			for (const [code, rate] of Object.entries(btcRates)) {
				if (typeof rate === 'number' && rate > 0) {
					rateCache.rates.set(code.toLowerCase(), rate);
				}
			}
			// Hardcode SATS and BTC
			rateCache.rates.set('sats', 100_000_000);
			rateCache.rates.set('btc', 1);
			rateCache.lastFetched = Date.now();
			return true;
		} catch (error) {
			console.error('[Currency] Failed to fetch exchange rates from yadio.io:', error);
			return false;
		} finally {
			inflightRatesFetch = null;
		}
	})();

	return inflightRatesFetch;
}

/**
 * Get the BTC exchange rate for a fiat currency (fiat value of 1 BTC).
 * Uses yadio.io API (same as Plebeian Market) with 5-minute cache.
 * Returns null if currency is SATS or fetch fails.
 */
export async function getExchangeRate(currency: CurrencyCode): Promise<number | null> {
	if (!browser) return null;
	if (currency === 'SATS') return null;

	const cacheKey = currency.toLowerCase();

	// Try cache first
	if (isCacheValid() && rateCache.rates.has(cacheKey)) {
		return rateCache.rates.get(cacheKey)!;
	}

	// Fetch all rates from yadio.io
	const success = await fetchAllRates();
	if (success && rateCache.rates.has(cacheKey)) {
		return rateCache.rates.get(cacheKey)!;
	}

	// Fallback: try getalby for this specific currency
	try {
		const { getFiatValue } = await import('@getalby/lightning-tools');
		const referenceSats = 100_000_000;
		const fiatValue = await getFiatValue({
			satoshi: referenceSats,
			currency: cacheKey
		});

		rateCache.rates.set(cacheKey, fiatValue);
		rateCache.lastFetched = Date.now();
		return fiatValue;
	} catch (error) {
		console.error(`[Currency] Fallback rate fetch also failed for ${currency}:`, error);
		return null;
	}
}

/**
 * Convert a price in any supported currency to satoshis.
 * - If currency is SATS, returns the price directly (rounded).
 * - If fiat, converts using current BTC exchange rate.
 * Returns null if conversion fails (rate unavailable).
 */
export async function convertToSats(
	price: number,
	currency: CurrencyCode
): Promise<number | null> {
	if (currency === 'SATS') return Math.round(price);

	const btcRate = await getExchangeRate(currency);
	if (!btcRate || btcRate === 0) return null;

	return Math.round((price / btcRate) * 100_000_000);
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

	try {
		conversionLoading.set(true);
		conversionError.set(null);

		const rate = await getExchangeRate(code);
		if (!rate) return null;

		return (satoshis * rate) / 100_000_000;
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
