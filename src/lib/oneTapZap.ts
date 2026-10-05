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
import {
  sendPayment,
  walletAvailability,
  ensurePaymentWalletReady
} from '$lib/wallet/walletManager';
import { NO_WALLET_MESSAGE, type PaymentStatus } from '$lib/wallet/paymentOutcome';
import { oneTapZapEnabled, oneTapZapAmount, defaultZapMessage } from '$lib/autoZapSettings';
import {
  optimisticZapUpdate,
  revertOptimisticZap,
  markSelfZapCompleted
} from '$lib/engagementCache';

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
  /**
   * What happened: 'completed' (sent), 'pending' (may still complete:
   * never retry), 'failed' (the payment failed: nothing sent),
   * 'unavailable' (no wallet on this site), or 'prepare' (it failed before
   * any payment: no Lightning address, LNURL down, ...).
   */
  status?: PaymentStatus | 'prepare';
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
  // Nothing usable on this site (e.g. a preview domain): say so at once.
  if (!wallet || walletAvailability() === 'none') {
    return { success: false, status: 'unavailable', error: NO_WALLET_MESSAGE };
  }

    const amount = get(oneTapZapAmount);
    const message = get(defaultZapMessage);
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

    // Track whether we've applied the optimistic update so the catch
    // block knows whether to revert. We defer the optimistic update until
    // AFTER createZap succeeds — that call is what fetches the
    // recipient's LNURL endpoint and gets back an invoice. If the
    // recipient has no lud16 / lud06, or the LNURL provider errors,
    // createZap throws BEFORE any optimistic count would be applied, so
    // the note never shows a phantom zap that never actually happened.
    let optimisticApplied = false;
    const amountMillisats = amount * 1000;

    try {
      // Connect first, so a wallet that can't connect here fails fast and
      // never shows an optimistic zap.
      if (!(await ensurePaymentWalletReady())) {
        return { success: false, status: 'unavailable', error: NO_WALLET_MESSAGE };
      }

      const zapManager = new ZapManager(ndkInstance);

    // Create the zap invoice. Throws if the recipient isn't zappable
    // (no lud16 / lud06, LNURL endpoint unreachable, etc.).
    console.log('[OneTapZap] Creating zap invoice...');
    const zapResult = await zapManager.createZap(
      recipientPubkey,
      amountMillisats, // Convert to millisats
      message, // User-configurable default zap message (empty string by default)
      eventId
    );
    console.log('[OneTapZap] Zap invoice created:', zapResult.invoice?.substring(0, 50) + '...');

    // LNURL succeeded → recipient is zappable → apply the optimistic
    // update so the UI shows immediate feedback while payment processes.
    if (eventId && currentUserPubkey) {
      optimisticZapUpdate(eventId, amountMillisats, currentUserPubkey, message || undefined);
      optimisticApplied = true;
      console.log('[OneTapZap] Optimistic update applied for event:', eventId, 'amount:', amount, 'sats');
    }

    // Send the payment
    console.log('[OneTapZap] Sending payment...');
    const paymentResult = await sendPayment(zapResult.invoice, {
      amount,
      description: message || `Zap to ${recipientPubkey.substring(0, 8)}...`,
      comment: message || undefined,
      pubkey: recipientPubkey
    });
    console.log('[OneTapZap] Payment result:', paymentResult);

    if (paymentResult.status !== 'completed') {
      // Not confirmed (failed, pending, or no wallet) — revert the
      // optimistic update: a zap only counts once the payment completed.
      if (optimisticApplied && eventId && currentUserPubkey) {
        revertOptimisticZap(eventId, amountMillisats, currentUserPubkey);
      }
      return {
        success: false,
        status: paymentResult.status,
        error: paymentResult.error || 'Payment failed'
      };
    }

    // Payment fully completed — mark the self-zap for any UI animation
    // that wants a one-shot "celebration" trigger (e.g. sparkle burst).
    if (eventId) {
      markSelfZapCompleted(eventId);
    }

    return { success: true, status: 'completed', amount };
  } catch (e) {
    // createZap threw (no lud16, LNURL down, etc.) OR something else
    // failed mid-flow. If we'd already applied the optimistic update,
    // revert it; if we hadn't, there's nothing to revert.
    if (optimisticApplied && eventId && currentUserPubkey) {
      revertOptimisticZap(eventId, amountMillisats, currentUserPubkey);
    }
    const errorMessage = e instanceof Error ? e.message : 'Unknown error';
    console.error('[OneTapZap] Failed:', errorMessage, e);
    // Before the payment (invoice step) nothing was paid; sendPayment never
    // throws, so anything caught here is a preparation failure.
    return { success: false, status: 'prepare', error: errorMessage };
  }
}
