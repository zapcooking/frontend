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
 */

import { env } from '$env/dynamic/private';
import type { BrantaClientOptions, BrantaServerBaseUrl, DestinationType } from '@branta-ops/branta';
import { BrantaService, type Destination, type Payment } from '@branta-ops/branta/v2';

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
export function getBrantaConfig(platform?: any): BrantaClientOptions | null {
  const apiKey = platform?.env?.BRANTA_API_KEY || env.BRANTA_API_KEY;

  if (!apiKey) {
    return null;
  }

  const raw = platform?.env?.BRANTA_ENVIRONMENT || env.BRANTA_ENVIRONMENT;
  const baseUrl: BrantaServerBaseUrl =
    raw === 'Staging' || raw === 'Localhost' ? raw : 'Production';

  return { defaultApiKey: apiKey, baseUrl, privacy: 'strict' };
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
 * @param paymentString - The Bitcoin address, Lightning invoice, or Lightning address
 * @param options - Optional configuration (ttl, description, metadata)
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
    // Always register with zk encryption enabled so the destination value
    // is encrypted at rest in Branta. Callers must persist the returned
    // secret/encryptedDestination to verify later.
    const destination: Destination = {
      value: paymentString.trim(),
      isZk: true
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

    // Payment.metadata is a stringified JSON blob per the API spec.
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
  platform?: any
): Promise<PaymentWithVerifyUrl | null> {
  const config = getBrantaConfig(platform);
  if (!config || !paymentString?.trim()) return null;

  try {
    const brantaService = new BrantaService(config);
    const result = await brantaService.getPayments(paymentString.trim(), encryptionKey);
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
  const config = getBrantaConfig(platform);
  if (!config || !qrText?.trim()) return null;

  try {
    const brantaService = new BrantaService(config);
    const result = await brantaService.getPaymentsByQrCode(qrText.trim());
    const payment = result.payments[0];
    return payment ? { ...payment, verifyUrl: result.verifyUrl } : null;
  } catch (error) {
    console.warn('[Branta] getPaymentInfoByQRCode failed:', error);
    return null;
  }
}
