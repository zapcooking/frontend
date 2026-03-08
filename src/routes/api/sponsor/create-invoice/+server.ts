/**
 * Create Lightning Invoice for Sponsor Placement
 *
 * POST /api/sponsor/create-invoice
 *
 * Body:
 * {
 *   title: string,          // 1-80 chars
 *   description: string,    // 0-200 chars
 *   imageUrl: string,       // valid URL
 *   linkUrl: string,        // valid URL
 *   buyerPubkey: string,    // hex pubkey of buyer
 *   tier: 'headline' | 'kitchen_card',
 *   durationKey: '24h' | '3d' | '7d' | '14d' | '30d',
 * }
 *
 * Returns:
 * {
 *   sponsorId: string,
 *   invoice: string,
 *   paymentHash: string,
 *   receiveRequestId: string,
 *   invoiceExpiresAt: number,
 *   amountSats: number,
 * }
 */

import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createInvoice as createStrikeInvoice } from '$lib/strikeService.server';
import {
  storeSponsor,
  SPONSOR_PRICING,
  type SponsorTier,
  type SponsorDurationKey,
  type SponsorRecord,
} from '$lib/sponsorStore.server';

const HEX64_RE = /^[0-9a-fA-F]{64}$/;
const VALID_TIERS: SponsorTier[] = ['headline', 'kitchen_card'];
const VALID_DURATIONS: SponsorDurationKey[] = ['24h', '3d', '7d', '14d', '30d'];

function isValidUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export const POST: RequestHandler = async ({ request, platform }) => {
  try {
    const body = await request.json();
    const { title, description, imageUrl, linkUrl, buyerPubkey, tier, durationKey } = body;

    // ── Validation ──────────────────────────────────────────────
    if (!title || typeof title !== 'string' || title.length < 1 || title.length > 80) {
      return json({ error: 'Title is required (1-80 characters)' }, { status: 400 });
    }

    if (description && (typeof description !== 'string' || description.length > 200)) {
      return json({ error: 'Description must be 200 characters or less' }, { status: 400 });
    }

    if (!imageUrl || typeof imageUrl !== 'string' || !isValidUrl(imageUrl)) {
      return json({ error: 'A valid image URL is required' }, { status: 400 });
    }

    if (!linkUrl || typeof linkUrl !== 'string' || !isValidUrl(linkUrl)) {
      return json({ error: 'A valid link URL is required' }, { status: 400 });
    }

    if (!buyerPubkey || !HEX64_RE.test(buyerPubkey)) {
      return json({ error: 'Invalid buyerPubkey format' }, { status: 400 });
    }

    if (!tier || !VALID_TIERS.includes(tier as SponsorTier)) {
      return json({ error: 'Invalid tier. Must be "headline" or "kitchen_card"' }, { status: 400 });
    }

    if (!durationKey || !VALID_DURATIONS.includes(durationKey as SponsorDurationKey)) {
      return json({ error: 'Invalid durationKey. Must be "24h", "3d", "7d", "14d", or "30d"' }, { status: 400 });
    }

    const pricing = SPONSOR_PRICING[tier as SponsorTier][durationKey as SponsorDurationKey];
    // Launch promo: 69% off all placements
    const amountSats = Math.floor(pricing.sats * 0.31);

    // Convert sats → BTC string for Strike API
    const btcAmount = (amountSats / 100_000_000).toFixed(8);
    const invoiceDescription = `zap.cooking Sponsor: "${title}" — ${tier === 'headline' ? 'Headline Banner' : 'Kitchen Card'} (${pricing.label})`;

    // ── Create invoice via Strike API ───────────────────────────
    console.log('[Sponsor] Creating invoice via Strike API...', { amountSats, tier, durationKey });
    const strikeResponse = await createStrikeInvoice(btcAmount, 'BTC', invoiceDescription, platform);

    const bolt11Data = (strikeResponse as any).bolt11;
    const invoice = bolt11Data?.invoice || strikeResponse.invoice;

    if (!invoice) {
      throw new Error('Strike API did not return a BOLT11 invoice');
    }

    const paymentHash = bolt11Data?.paymentHash || strikeResponse.paymentHash || '';
    const receiveRequestId = strikeResponse.receiveRequestId;

    let invoiceExpiresAt: number; // invoice expiry in unix seconds (not sponsor duration)
    const expiresString = bolt11Data?.expires || strikeResponse.expires;
    if (expiresString) {
      invoiceExpiresAt = Math.floor(new Date(expiresString).getTime() / 1000);
    } else {
      invoiceExpiresAt = Math.floor(Date.now() / 1000) + 3600;
    }

    // ── Store pending sponsor record ──────────────────────────────
    const sponsorId = crypto.randomUUID();
    const kv = platform?.env?.GATED_CONTENT ?? null;

    if (!kv && env.NODE_ENV === 'production') {
      console.error('[Sponsor] GATED_CONTENT KV binding is missing in production');
      return json({ error: 'Service temporarily unavailable' }, { status: 503 });
    }

    const sponsor: SponsorRecord = {
      id: sponsorId,
      title,
      description: description || '',
      imageUrl,
      linkUrl,
      buyerPubkey,
      tier: tier as SponsorTier,
      durationKey: durationKey as SponsorDurationKey,
      amountSats,
      receiveRequestId,
      paymentHash,
      status: 'pending',
      createdAt: Date.now(),
      activatedAt: null,
      expiresAt: null,
    };

    await storeSponsor(kv, sponsor);

    console.log('[Sponsor] Invoice created:', {
      sponsorId,
      receiveRequestId,
      amountSats,
      tier,
      durationKey,
    });

    return json({
      sponsorId,
      invoice,
      paymentHash,
      receiveRequestId,
      invoiceExpiresAt,
      amountSats,
    });
  } catch (error: any) {
    console.error('[Sponsor] Error creating invoice:', error);

    let errorMessage = 'Failed to create Lightning invoice';
    if (error.message?.includes('STRIKE_API_KEY')) {
      errorMessage = 'Lightning payment service is not configured.';
    } else if (error.message?.includes('Strike API error')) {
      errorMessage = 'Lightning payment service error. Please try again.';
    } else if (error.message) {
      errorMessage = error.message;
    }

    return json({ error: errorMessage }, { status: 500 });
  }
};
