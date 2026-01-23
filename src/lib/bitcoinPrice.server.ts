/**
 * Bitcoin Price Service
 * 
 * Fetches current Bitcoin price from market API and calculates discounted rates.
 * 
 * Uses CoinGecko API (free tier, no API key required)
 * Alternative: Can be configured to use other APIs via environment variables
 */

import { env } from '$env/dynamic/private';

interface BitcoinPriceResponse {
	price: number;
	discountedPrice: number;
	discountPercent: number;
	timestamp: number;
}

// Cache for 1 minute to avoid excessive API calls
const CACHE_DURATION = 60 * 1000; // 1 minute
let priceCache: { price: number; timestamp: number } | null = null;

/**
 * Fetch current Bitcoin price in USD from CoinGecko
 * 
 * @param platform - Optional platform context for Cloudflare Workers
 * @returns Bitcoin price in USD
 */
export async function getBitcoinPrice(platform?: any): Promise<number> {
	// Check cache first
	if (priceCache && Date.now() - priceCache.timestamp < CACHE_DURATION) {
		return priceCache.price;
	}

	try {
		// Use CoinGecko API (free, no API key required)
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

		// Update cache
		priceCache = {
			price,
			timestamp: Date.now(),
		};

		return price;
	} catch (error) {
		console.error('[BitcoinPrice] Error fetching price:', error);
		
		// If cache exists, use it even if expired
		if (priceCache) {
			console.warn('[BitcoinPrice] Using cached price due to API error');
			return priceCache.price;
		}
		
		throw new Error(
			`Failed to fetch Bitcoin price: ${error instanceof Error ? error.message : 'Unknown error'}`
		);
	}
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
 * Convert USD amount to satoshis using discounted Bitcoin price
 * 
 * @param usdAmount - Amount in USD
 * @param discountPercent - Discount percentage (default: 5%)
 * @param platform - Optional platform context for Cloudflare Workers
 * @returns Amount in satoshis
 */
export async function convertUsdToSats(
	usdAmount: number,
	discountPercent: number = 5,
	platform?: any
): Promise<number> {
	const { discountedPrice } = await getDiscountedBitcoinPrice(discountPercent, platform);
	
	// Convert USD to BTC, then to satoshis
	// 1 BTC = 100,000,000 satoshis
	const btcAmount = usdAmount / discountedPrice;
	const sats = Math.round(btcAmount * 100_000_000);
	
	return sats;
}

/**
 * Convert USD amount to BTC using discounted Bitcoin price
 * 
 * @param usdAmount - Amount in USD
 * @param discountPercent - Discount percentage (default: 5%)
 * @param platform - Optional platform context for Cloudflare Workers
 * @returns Amount in BTC (as string for precision)
 */
export async function convertUsdToBtc(
	usdAmount: number,
	discountPercent: number = 5,
	platform?: any
): Promise<string> {
	const { discountedPrice } = await getDiscountedBitcoinPrice(discountPercent, platform);
	
	// Convert USD to BTC
	const btcAmount = usdAmount / discountedPrice;
	
	// Return as string to preserve precision
	return btcAmount.toFixed(8);
}
