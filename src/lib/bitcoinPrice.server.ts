/**
 * Bitcoin Price Service
 * 
 * Fetches current Bitcoin price from market APIs and calculates discounted rates.
 * 
 * Uses multiple APIs with fallback (prioritizes Strike when configured):
 * 1. Strike API (if STRIKE_API_KEY is configured - uses same service as payments)
 * 2. Kraken API (public, no API key required)
 * 3. Coinbase API (public, no API key required)
 * 4. CoinGecko API (free tier, often rate limited)
 */

import { env } from '$env/dynamic/private';
import { getBtcUsdRate, isStrikeConfigured } from './strikeService.server';

interface BitcoinPriceResponse {
	price: number;
	discountedPrice: number;
	discountPercent: number;
	timestamp: number;
}

// Cache for 5 minutes to reduce API calls (price doesn't change that much)
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
let priceCache: { price: number; timestamp: number; source: string } | null = null;

/**
 * Fetch Bitcoin price from Strike API (requires STRIKE_API_KEY)
 */
async function fetchFromStrike(platform?: any): Promise<number> {
	if (!isStrikeConfigured(platform)) {
		throw new Error('Strike API not configured');
	}
	return await getBtcUsdRate(platform);
}

/**
 * Fetch Bitcoin price from Kraken (public API, no key required)
 */
async function fetchFromKraken(): Promise<number> {
	const apiUrl = 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD';
	
	const response = await fetch(apiUrl, {
		headers: {
			'Accept': 'application/json',
		},
	});

	if (!response.ok) {
		throw new Error(`Kraken API error: ${response.status} ${response.statusText}`);
	}

	const data = await response.json();
	
	if (data.error && data.error.length > 0) {
		throw new Error(`Kraken API error: ${data.error.join(', ')}`);
	}

	// Kraken returns price in result.XXBTZUSD.c[0] (last trade closed price)
	const tickerData = data.result?.XXBTZUSD || data.result?.XBTUSD;
	const price = tickerData?.c?.[0];

	if (!price) {
		throw new Error('Invalid price data from Kraken');
	}

	return parseFloat(price);
}

/**
 * Fetch Bitcoin price from Coinbase (public API, no key required)
 */
async function fetchFromCoinbase(): Promise<number> {
	const apiUrl = 'https://api.coinbase.com/v2/prices/BTC-USD/spot';
	
	const response = await fetch(apiUrl, {
		headers: {
			'Accept': 'application/json',
		},
	});

	if (!response.ok) {
		throw new Error(`Coinbase API error: ${response.status} ${response.statusText}`);
	}

	const data = await response.json();
	const price = data.data?.amount;

	if (!price) {
		throw new Error('Invalid price data from Coinbase');
	}

	return parseFloat(price);
}

/**
 * Fetch Bitcoin price from CoinGecko (often rate limited)
 */
async function fetchFromCoinGecko(): Promise<number> {
	const apiUrl = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd';
	
	const response = await fetch(apiUrl, {
		headers: {
			'Accept': 'application/json',
		},
	});

	if (!response.ok) {
		throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
	}

	const data = await response.json();
	const price = data.bitcoin?.usd;

	if (!price || typeof price !== 'number') {
		throw new Error('Invalid price data from CoinGecko');
	}

	return price;
}

/**
 * Fetch current Bitcoin price in USD with fallback APIs
 * 
 * @param platform - Optional platform context for Cloudflare Workers
 * @returns Bitcoin price in USD
 */
export async function getBitcoinPrice(platform?: any): Promise<number> {
	// Check cache first
	if (priceCache && Date.now() - priceCache.timestamp < CACHE_DURATION) {
		console.log(`[BitcoinPrice] Using cached price from ${priceCache.source}: $${priceCache.price}`);
		return priceCache.price;
	}

	// Build API list dynamically - Strike first if configured
	const apis: { name: string; fetch: () => Promise<number> }[] = [];
	
	// Add Strike first if configured (uses same API key as payments)
	if (isStrikeConfigured(platform)) {
		apis.push({ name: 'Strike', fetch: () => fetchFromStrike(platform) });
	}
	
	// Add public APIs as fallback
	apis.push(
		{ name: 'Kraken', fetch: fetchFromKraken },
		{ name: 'Coinbase', fetch: fetchFromCoinbase },
		{ name: 'CoinGecko', fetch: fetchFromCoinGecko },
	);

	const errors: string[] = [];

	for (const api of apis) {
		try {
			console.log(`[BitcoinPrice] Trying ${api.name}...`);
			const price = await api.fetch();
			
			// Update cache
			priceCache = {
				price,
				timestamp: Date.now(),
				source: api.name,
			};

			console.log(`[BitcoinPrice] Got price from ${api.name}: $${price}`);
			return price;
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : 'Unknown error';
			console.warn(`[BitcoinPrice] ${api.name} failed: ${errorMsg}`);
			errors.push(`${api.name}: ${errorMsg}`);
		}
	}

	// All APIs failed - try to use expired cache if available
	if (priceCache) {
		console.warn(`[BitcoinPrice] All APIs failed, using expired cache from ${priceCache.source}`);
		return priceCache.price;
	}

	// No cache available - throw error with all API failures
	throw new Error(
		`Failed to fetch Bitcoin price from all sources: ${errors.join('; ')}`
	);
}

/**
 * Get Bitcoin price with discount applied
 * 
 * @param discountPercent - Discount percentage (default: 5%)
 * @param platform - Optional platform context for Cloudflare Workers
 * @returns Price information with discount
 */
export async function getDiscountedBitcoinPrice(
	discountPercent: number = 5,
	platform?: any
): Promise<BitcoinPriceResponse> {
	const currentPrice = await getBitcoinPrice(platform);
	const discountedPrice = currentPrice * (1 - discountPercent / 100);

	return {
		price: currentPrice,
		discountedPrice,
		discountPercent,
		timestamp: Date.now(),
	};
}

/**
 * Convert USD amount to satoshis using current Bitcoin spot price
 * 
 * NOTE: The discount should be applied to the USD amount BEFORE calling this function.
 * This function converts at the current market rate.
 * 
 * @param usdAmount - Amount in USD (should already have discount applied if desired)
 * @param platform - Optional platform context for Cloudflare Workers
 * @returns Amount in satoshis
 */
export async function convertUsdToSats(
	usdAmount: number,
	_discountPercent?: number, // Deprecated - discount should be applied to USD first
	platform?: any
): Promise<number> {
	const currentPrice = await getBitcoinPrice(platform);
	
	// Convert USD to BTC, then to satoshis
	// 1 BTC = 100,000,000 satoshis
	const btcAmount = usdAmount / currentPrice;
	const sats = Math.round(btcAmount * 100_000_000);
	
	return sats;
}

/**
 * Convert USD amount to BTC using current Bitcoin spot price
 * 
 * NOTE: The discount should be applied to the USD amount BEFORE calling this function.
 * This function converts at the current market rate.
 * 
 * @param usdAmount - Amount in USD (should already have discount applied if desired)
 * @param platform - Optional platform context for Cloudflare Workers
 * @returns Amount in BTC (as string for precision)
 */
export async function convertUsdToBtc(
	usdAmount: number,
	_discountPercent?: number, // Deprecated - discount should be applied to USD first
	platform?: any
): Promise<string> {
	const currentPrice = await getBitcoinPrice(platform);
	
	// Convert USD to BTC
	const btcAmount = usdAmount / currentPrice;
	
	// Return as string to preserve precision
	return btcAmount.toFixed(8);
}
