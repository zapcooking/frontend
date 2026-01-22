/**
 * One-Tap Zap Service
 *
 * Provides functionality to send zaps instantly without opening the ZapModal.
 * Used when one-tap zaps are enabled and user has an in-app wallet.
 */

import { get } from 'svelte/store';
import { browser } from '$app/environment';
import { NDKEvent, NDKUser } from '@nostr-dev-kit/ndk';
import { ndk, userPublickey } from '$lib/nostr';
import { ZapManager } from '$lib/zapManager';
import { activeWallet } from '$lib/wallet';
import { sendPayment } from '$lib/wallet/walletManager';
import { oneTapZapEnabled, oneTapZapAmount } from '$lib/autoZapSettings';
import { optimisticZapUpdate } from '$lib/engagementCache';

/**
 * Check if one-tap zap is available (enabled + has in-app wallet)
 */
export function canOneTapZap(): boolean {
  if (!browser) return false;

  const wallet = get(activeWallet);
  const enabled = get(oneTapZapEnabled);

  // Must have one-tap enabled and an in-app wallet (Spark kind=4 or NWC kind=3)
  return enabled && wallet !== null && (wallet.kind === 3 || wallet.kind === 4);
}

/**
 * Get the one-tap zap amount
 */
export function getOneTapAmount(): number {
  return get(oneTapZapAmount);
}

export interface OneTapZapResult {
  success: boolean;
  amount?: number;
  error?: string;
}

/**
 * Send a one-tap zap to an event or user
 *
 * @param target - NDKEvent or NDKUser to zap
 * @returns Result with success status and amount or error
 */
export async function sendOneTapZap(target: NDKEvent | NDKUser): Promise<OneTapZapResult> {
  console.log('[OneTapZap] sendOneTapZap called with target:', target);

  if (!browser) {
    console.log('[OneTapZap] Not in browser');
    return { success: false, error: 'Not in browser' };
  }

  if (!canOneTapZap()) {
    console.log('[OneTapZap] canOneTapZap returned false');
    return { success: false, error: 'One-tap zap not available' };
  }

  const ndkInstance = get(ndk);
  if (!ndkInstance) {
    console.log('[OneTapZap] NDK not initialized');
    return { success: false, error: 'NDK not initialized' };
  }

  const wallet = get(activeWallet);
  if (!wallet) {
    console.log('[OneTapZap] No wallet connected');
    return { success: false, error: 'No wallet connected' };
  }

    const amount = get(oneTapZapAmount);
    const currentUserPubkey = get(userPublickey);
    console.log('[OneTapZap] Amount:', amount, 'sats, Wallet kind:', wallet.kind);

    // Determine recipient pubkey and event ID
    let recipientPubkey: string;
    let eventId: string | undefined;

    if (target instanceof NDKUser) {
      recipientPubkey = target.pubkey;
      eventId = undefined;
      console.log('[OneTapZap] Target is NDKUser, pubkey:', recipientPubkey);
    } else if (target && target.author) {
      recipientPubkey = target.author?.hexpubkey || target.pubkey;
      eventId = target.id;
      console.log('[OneTapZap] Target is NDKEvent, pubkey:', recipientPubkey, 'eventId:', eventId);
    } else {
      console.log('[OneTapZap] Invalid target');
      return { success: false, error: 'Invalid target for zap' };
    }

    // Optimistically update the zap count immediately (before payment starts)
    // This provides instant visual feedback while payment processes in background
    if (eventId && currentUserPubkey) {
      optimisticZapUpdate(eventId, amount * 1000, currentUserPubkey);
      console.log('[OneTapZap] Optimistic update applied for event:', eventId, 'amount:', amount, 'sats');
    }

    try {
      const zapManager = new ZapManager(ndkInstance);

    // Create the zap invoice
    console.log('[OneTapZap] Creating zap invoice...');
    const zapResult = await zapManager.createZap(
      recipientPubkey,
      amount * 1000, // Convert to millisats
      '', // No message for one-tap zaps
      eventId
    );
    console.log('[OneTapZap] Zap invoice created:', zapResult.invoice?.substring(0, 50) + '...');

    // Send the payment
    console.log('[OneTapZap] Sending payment...');
    const paymentResult = await sendPayment(zapResult.invoice, {
      amount,
      description: `Zap to ${recipientPubkey.substring(0, 8)}...`,
      pubkey: recipientPubkey
    });
    console.log('[OneTapZap] Payment result:', paymentResult);

    if (!paymentResult.success) {
      return { success: false, error: paymentResult.error || 'Payment failed' };
    }

    return { success: true, amount };
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : 'Unknown error';
    console.error('[OneTapZap] Failed:', errorMessage, e);
    return { success: false, error: errorMessage };
  }
}
