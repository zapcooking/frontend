import { writable, type Writable } from 'svelte/store';
import { browser } from '$app/environment';

export type CurrencyCode =
  | 'SATS'
  | 'USD'
  | 'EUR'
  | 'GBP'
  | 'JPY'
  | 'CAD'
  | 'AUD'
  | 'CHF'
  | 'CNY'
  | 'BRL';

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
const PREFERRED_FIAT_KEY = 'zapcooking_preferred_fiat';

function getInitialCurrency(): CurrencyCode {
  if (!browser) return 'USD';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && SUPPORTED_CURRENCIES.some((c) => c.code === stored)) {
    return stored as CurrencyCode;
  }
  return 'USD';
}

function getPreferredFiat(): CurrencyCode {
  if (!browser) return 'USD';
  const stored = localStorage.getItem(PREFERRED_FIAT_KEY);
  if (
    stored &&
    stored !== 'SATS' &&
    SUPPORTED_CURRENCIES.some((c) => c.code === stored)
  ) {
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
  /**
   * One-tap cycle between SATS and the user's last-selected fiat.
   * - From a fiat → SATS (remembering which fiat to come back to).
   * - From SATS → the remembered fiat (defaults to USD on first use).
   * The remembered "preferred fiat" is also updated whenever the user
   * picks a fiat via setCurrency, so the cycle target tracks the
   * full picker.
   */
  cycleSatsFiat: () => void;
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
      // Track the most recent fiat selection so the SATS↔fiat cycle
      // returns to whatever the user last explicitly picked.
      if (currency !== 'SATS') {
        localStorage.setItem(PREFERRED_FIAT_KEY, currency);
      }
      set(currency);
    },

    getCurrency(): Currency {
      return getCurrencyByCode(currentCurrency);
    },

    cycleSatsFiat() {
      if (!browser) return;
      const target: CurrencyCode =
        currentCurrency === 'SATS' ? getPreferredFiat() : 'SATS';
      currentCurrency = target;
      localStorage.setItem(STORAGE_KEY, target);
      set(target);
    }
  };
}

export const displayCurrency = createCurrencyStore();
