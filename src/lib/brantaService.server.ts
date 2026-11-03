/**
 * Branta Guardrail Service
 *
 * Integration with Branta API for payment address/invoice verification.
 * Registers Lightning invoices and Bitcoin addresses so users can verify
 * they are paying the legitimate recipient.
 *
 * Environment variables:
 * - BRANTA_API_KEY: Your Branta API key
 * - BRANTA_ENVIRONMENT: Server environment — one of "Production" (default),
 *   "Staging", or "Localhost". The SDK resolves the actual base URL.
 *
 * NOTE: This file is server-only and uses SvelteKit's $env system.
 *
 * Branta SDK 4 exports its service and models from the package root.
 * Registration always encrypts destinations; verification only returns
 * payments cryptographically bound to the supplied payable instruction.
 */

import { env } from '$env/dynamic/private';
import {
  BrantaEnvironment,
  BrantaService,
  VerifyStatus,
  type BrantaServiceOptions,
  type DestinationType,
  type Destination,
  type Payment
} from '@branta-ops/branta';

export type { Payment };
export type PaymentWithVerifyUrl = Payment & { verifyUrl?: string };

export interface RegisterPaymentResult {
  success: boolean;
  verifyUrl?: string;
  secret?: string;
  encryptedDestination?: string;
  error?: string;
}

/**
 * Get Branta API configuration from environment variables
 * Returns null if not configured (allows graceful degradation)
 */
export function getBrantaConfig(platform?: any): BrantaServiceOptions | null {
  const apiKey = platform?.env?.BRANTA_API_KEY || env.BRANTA_API_KEY;

  if (!apiKey) {
    return null;
  }

  const raw = platform?.env?.BRANTA_ENVIRONMENT || env.BRANTA_ENVIRONMENT;
  const environment =
    raw === 'Staging'
      ? BrantaEnvironment.Staging
      : raw === 'Localhost'
        ? BrantaEnvironment.Localhost
        : BrantaEnvironment.Production;

  return { apiKey, environment };
}

/**
 * Check if Branta is configured
 */
export function isBrantaConfigured(platform?: any): boolean {
  return getBrantaConfig(platform) !== null;
}


/**
 * Register a payment address/invoice with Branta
 *
 * @param paymentString - The Bitcoin address or Lightning invoice
 * @param ttl - Optional time-to-live in seconds
 * @param description - Optional human-readable description
 * @param metadata - Optional metadata object serialized as JSON
 * @param destinationType - Optional explicit destination type
 * @param platform - Optional platform object for Cloudflare Workers
 */
export async function registerPayment(
  paymentString: string,
  ttl: number | undefined,
  description: string | undefined,
  metadata: object | undefined,
  destinationType: DestinationType | undefined,
  platform?: any
): Promise<RegisterPaymentResult> {
  const config = getBrantaConfig(platform);

  if (config === null) {
    return { success: false, error: 'Branta not configured' };
  }

  try {
    const destination: Destination = {
      value: paymentString.trim()
    };

    if (destinationType) {
      destination.type = destinationType;
    }

    const body: Payment = {
      destinations: [destination],
      ttl: ttl || 86400 // Default 24 hours
    };

    if (description) {
      body.description = description;
    }

    if (metadata) {
      body.metadata = JSON.stringify(metadata);
    }

    const brantaService = new BrantaService(config);

    const result = await brantaService.addPayment(body);

    return {
      success: true,
      verifyUrl: result.verifyUrl,
      secret: result.secret,
      encryptedDestination: result.payment.destinations[0]?.value
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn('[Branta] Registration request timed out');
      return { success: false, error: 'Request timed out' };
    }

    console.warn('[Branta] Registration failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Get payment info for an address/invoice from Branta
 */
export async function getPaymentInfo(
  paymentString: string,
  encryptionKey?: string,
  platform?: any,
  encryptedDestination?: string
): Promise<PaymentWithVerifyUrl | null> {
  const config = getBrantaConfig(platform);
  if (!config || !paymentString?.trim()) return null;

  try {
    let input = paymentString.trim();
    if (encryptedDestination || encryptionKey) {
      if (!encryptedDestination?.trim() || !encryptionKey?.trim()) return null;
      input = `bitcoin:${encodeURIComponent(input)}?branta_id=${encodeURIComponent(encryptedDestination.trim())}&branta_secret=${encodeURIComponent(encryptionKey)}`;
    }
    const brantaService = new BrantaService(config);
    const result = await brantaService.verify(input);
    if (result.status !== VerifyStatus.Match) return null;
    const payment = result.payments[0];
    return payment ? { ...payment, verifyUrl: result.verifyUrl } : null;
  } catch (error) {
    console.warn('[Branta] getPaymentInfo failed:', error);
    return null;
  }
}

/**
 * Get payment info from a raw QR code string using Branta
 */
export async function getPaymentInfoByQRCode(
  qrText: string,
  platform?: any
): Promise<PaymentWithVerifyUrl | null> {
  return getPaymentInfo(qrText, undefined, platform);
}
