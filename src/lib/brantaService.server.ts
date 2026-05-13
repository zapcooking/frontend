/**
 * Branta Guardrail Service
 *
 * Integration with Branta API for payment address/invoice verification.
 * Registers Lightning invoices and Bitcoin addresses so users can verify
 * they are paying the legitimate recipient.
 *
 * Environment variables:
 * - BRANTA_API_KEY: Your Branta API key
 * - BRANTA_API_BASE_URL: Base URL (defaults to https://guardrail.branta.pro)
 *
 * NOTE: This file is server-only and uses SvelteKit's $env system.
 */

import { env } from '$env/dynamic/private';
import {
  BrantaService,
  type Destination,
  type DestinationType,
  type Payment
} from '@branta-ops/branta/v2';
import type { BrantaClientOptions } from '@branta-ops/branta';

export type { Payment };

export interface RegisterPaymentResult {
  success: boolean;
  verifyLink?: string;
  secret?: string;
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

  const baseUrl =
    platform?.env?.BRANTA_API_BASE_URL || env.BRANTA_API_BASE_URL || 'https://guardrail.branta.pro';

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
 * @param ttl - Time-to-live in seconds (default 24 hours)
 * @param description - Optional description
 * @param metadata - Optional metadata
 * @param destinationType - Type of payment destination (bitcoin_address, bolt11, ln_address, etc.)
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
      value: paymentString.trim(),
      zk: true
    };

    if (destinationType !== undefined) {
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
      body.metadata = metadata as Record<string, string>;
    }

    const brantaService = new BrantaService(config);
    const result = await brantaService.addPayment(body);
    return { success: true, verifyLink: result.verifyLink, secret: result.secret };
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
  encryptionKey?: string | null,
  platform?: any
): Promise<Payment | null> {
  const config = getBrantaConfig(platform);
  if (!config || !paymentString?.trim()) return null;

  try {
    const brantaService = new BrantaService(config);
    const response = await brantaService.getPayments(paymentString.trim(), encryptionKey ?? null);
    return response[0] ?? null;
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
): Promise<Payment | null> {
  const config = getBrantaConfig(platform);
  if (!config || !qrText?.trim()) return null;

  try {
    const brantaService = new BrantaService(config);
    const response = await brantaService.getPaymentsByQRCode(qrText.trim());

    return response[0] ?? null;
  } catch (error) {
    console.warn('[Branta] getPaymentInfoByQRCode failed:', error);
    return null;
  }
}
