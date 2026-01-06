import { writable, type Writable } from 'svelte/store';
import { browser } from '$app/environment';

export type CurrencyCode = 'SATS' | 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CAD' | 'AUD' | 'CHF' | 'CNY' | 'BRL';

export interface Currency {
	code: CurrencyCode;
	name: string;
	symbol: string;
	locale: string;
}

export const SUPPORTED_CURRENCIES: Currency[] = [
	{ code: 'SATS', name: 'Satoshis', symbol: '', locale: 'en-US' },
	{ code: 'USD', name: 'US Dollar', symbol: '$', locale: 'en-US' },
	{ code: 'EUR', name: 'Euro', symbol: '€', locale: 'de-DE' },
	{ code: 'GBP', name: 'British Pound', symbol: '£', locale: 'en-GB' },
	{ code: 'JPY', name: 'Japanese Yen', symbol: '¥', locale: 'ja-JP' },
	{ code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', locale: 'en-CA' },
	{ code: 'AUD', name: 'Australian Dollar', symbol: 'A$', locale: 'en-AU' },
	{ code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', locale: 'de-CH' },
	{ code: 'CNY', name: 'Chinese Yuan', symbol: '¥', locale: 'zh-CN' },
	{ code: 'BRL', name: 'Brazilian Real', symbol: 'R$', locale: 'pt-BR' }
];

const STORAGE_KEY = 'zapcooking_display_currency';

function getInitialCurrency(): CurrencyCode {
	if (!browser) return 'USD';
	const stored = localStorage.getItem(STORAGE_KEY);
	if (stored && SUPPORTED_CURRENCIES.some((c) => c.code === stored)) {
		return stored as CurrencyCode;
	}
	return 'USD';
}

export function getCurrencyByCode(code: CurrencyCode): Currency {
	return SUPPORTED_CURRENCIES.find((c) => c.code === code) || SUPPORTED_CURRENCIES[1]; // Default to USD
}

interface CurrencyStore {
	subscribe: (run: (value: CurrencyCode) => void) => () => void;
	initialize: () => void;
	setCurrency: (currency: CurrencyCode) => void;
	getCurrency: () => Currency;
}

function createCurrencyStore(): CurrencyStore {
	const { subscribe, set } = writable<CurrencyCode>(getInitialCurrency());

	let currentCurrency: CurrencyCode = getInitialCurrency();

	return {
		subscribe,

		initialize() {
			if (!browser) return;
			currentCurrency = getInitialCurrency();
			set(currentCurrency);
		},

		setCurrency(currency: CurrencyCode) {
			if (!browser) return;
			currentCurrency = currency;
			localStorage.setItem(STORAGE_KEY, currency);
			set(currency);
		},

		getCurrency(): Currency {
			return getCurrencyByCode(currentCurrency);
		}
	};
}

export const displayCurrency = createCurrencyStore();
