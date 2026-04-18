/**
 * Product Payment Controller
 *
 * Shared state machine + actions for marketplace product modals. Encapsulates:
 *  - Resolving a seller's lightning address (from product or profile lud16)
 *  - Computing sats amount from product price/currency
 *  - Running the instant-buy flow (in-app wallet OR external lightning launcher)
 *  - Copy-to-clipboard for the lightning address
 *  - Payment lifecycle state (idle → loading → success | error)
 *
 * One controller instance per modal. State is isolated; two modals that import
 * this service do not share anything at runtime.
 *
 * Usage from a Svelte component:
 *
 *   const payment = createProductPaymentController();
 *   const { paymentSats, paymentState, paymentError, ... } = payment;
 *
 *   // IMPORTANT: drive re-sync reactively. This `$:` is what keeps the
 *   // controller's internal state aligned with prop changes — sats are
 *   // recomputed when product changes, lightning address is resolved when
 *   // the modal opens, and state is cleared when the modal closes.
 *   $: payment.sync(product, open);
 *
 *   // User actions:
 *   on:click={() => payment.handlePayment(product, { onSuccess })}
 *   on:click={() => payment.copyLightning()}
 *   on:click={() => payment.reset()}   // after error, to return to idle
 */

import { writable, derived, get, type Readable } from 'svelte/store';
import type { Product } from './types';
import { convertToSats } from '$lib/currencyConversion';
import { getInvoiceFromLightningAddress } from './products';
import { activeWallet } from '$lib/wallet';
import { sendPayment } from '$lib/wallet/walletManager';
import { lightningService } from '$lib/lightningService';

export type PaymentState = 'idle' | 'loading' | 'success' | 'error';

export interface PaymentCallbacks {
  /** Fired once the in-app wallet reports a successful payment. */
  onSuccess?: () => void;
  /** Fired just before the external-wallet launcher opens — modal should close. */
  onExternalLaunch?: () => void;
  /** Fired when the external launcher reports the invoice was paid — modal can reopen. */
  onExternalPaid?: () => void;
  /** Fired when the external launcher is cancelled — modal can reopen. */
  onExternalCancelled?: () => void;
}

export interface ProductPaymentController {
  readonly paymentSats: Readable<number | null>;
  readonly resolvedLightningAddress: Readable<string>;
  readonly resolvingLightning: Readable<boolean>;
  readonly paymentState: Readable<PaymentState>;
  readonly paymentError: Readable<string>;
  readonly copiedLightning: Readable<boolean>;
  readonly hasInAppWallet: Readable<boolean>;

  /**
   * Drive this reactively from a Svelte component:
   *   $: controller.sync(product, open);
   *
   * The `$:` label is what causes re-invocation whenever `product` or `open`
   * changes — the controller itself has no hooks into the component's
   * reactivity graph. Behaviour:
   *  - Recomputes `paymentSats` based on the product's price/currency.
   *  - When `open && product`, resolves the seller's lightning address. There
   *    is no caching; resolution fires on every such invocation (matching the
   *    pre-refactor behaviour of the two modals).
   *  - On close (transition true → false), resets paymentState + paymentError.
   */
  sync(product: Product | null, open: boolean): void;

  /**
   * Runs the instant-buy flow. Uses the in-app wallet if available, otherwise
   * hands off to `lightningService.launchPayment` (external wallet/modal).
   *
   * Sets paymentState to 'loading' → 'success' | 'error'. Callers can hook
   * into the transitions via `callbacks`.
   */
  handlePayment(product: Product, callbacks?: PaymentCallbacks): Promise<void>;

  /** Copies the resolved lightning address to clipboard; falls back to `lightning:` URL. */
  copyLightning(): Promise<void>;

  /** Returns paymentState to 'idle' and clears paymentError. Used after "Try Again". */
  reset(): void;
}

export function createProductPaymentController(): ProductPaymentController {
  const paymentSats = writable<number | null>(null);
  const resolvedLightningAddress = writable<string>('');
  const resolvingLightning = writable<boolean>(false);
  const paymentState = writable<PaymentState>('idle');
  const paymentError = writable<string>('');
  const copiedLightning = writable<boolean>(false);

  const hasInAppWallet = derived(
    activeWallet,
    ($activeWallet) => !!$activeWallet && ($activeWallet.kind === 3 || $activeWallet.kind === 4)
  );

  let lastOpen = false;

  function recomputeSats(product: Product | null, open: boolean) {
    if (open && product && product.price > 0) {
      if (product.currency === 'SATS') {
        paymentSats.set(Math.round(product.price));
      } else {
        paymentSats.set(null);
        convertToSats(product.price, product.currency).then((s) => {
          paymentSats.set(s);
        });
      }
    } else {
      paymentSats.set(null);
    }
  }

  async function resolveLightningAddress(product: Product) {
    if (product.lightningAddress) {
      resolvedLightningAddress.set(product.lightningAddress);
      return;
    }
    resolvingLightning.set(true);
    try {
      const ndkModule = await import('$lib/nostr');
      const ndkInstance = get(ndkModule.ndk);
      const user = ndkInstance.getUser({ pubkey: product.pubkey });
      const profile = await user.fetchProfile();
      resolvedLightningAddress.set(profile?.lud16 || '');
    } catch {
      resolvedLightningAddress.set('');
    } finally {
      resolvingLightning.set(false);
    }
  }

  function sync(product: Product | null, open: boolean): void {
    recomputeSats(product, open);

    if (open && product) {
      resolveLightningAddress(product);
    }

    if (!open && lastOpen) {
      paymentState.set('idle');
      paymentError.set('');
    }

    lastOpen = open;
  }

  async function handlePayment(
    product: Product,
    callbacks: PaymentCallbacks = {}
  ): Promise<void> {
    const lightningAddr = get(resolvedLightningAddress);
    if (!lightningAddr) {
      paymentError.set('No lightning address available for this seller');
      paymentState.set('error');
      return;
    }
    if (!product?.price) {
      paymentError.set('Product has no price set');
      paymentState.set('error');
      return;
    }

    paymentState.set('loading');
    paymentError.set('');

    try {
      let amountSats: number;
      const cached = get(paymentSats);
      if (cached) {
        amountSats = cached;
      } else {
        const converted = await convertToSats(product.price, product.currency);
        if (!converted) throw new Error('Unable to convert price to sats.');
        amountSats = converted;
      }

      const { invoice, verify } = await getInvoiceFromLightningAddress(
        lightningAddr,
        amountSats
      );

      if (get(hasInAppWallet)) {
        const result = await sendPayment(invoice, {
          amount: amountSats,
          description: `Purchase: ${product.title}`,
          pubkey: product.pubkey
        });

        if (result.success) {
          paymentState.set('success');
          callbacks.onSuccess?.();
        } else {
          throw new Error(result.error || 'Payment failed');
        }
      } else {
        callbacks.onExternalLaunch?.();
        await lightningService.launchPayment({
          invoice,
          verify,
          onPaid: () => {
            paymentState.set('success');
            callbacks.onExternalPaid?.();
          },
          onCancelled: () => {
            paymentState.set('idle');
            callbacks.onExternalCancelled?.();
          }
        });
      }
    } catch (e) {
      paymentError.set(e instanceof Error ? e.message : 'Payment failed');
      paymentState.set('error');
    }
  }

  async function copyLightning(): Promise<void> {
    const addr = get(resolvedLightningAddress);
    if (!addr) return;
    try {
      await navigator.clipboard.writeText(addr);
      copiedLightning.set(true);
      setTimeout(() => copiedLightning.set(false), 2000);
    } catch {
      window.open(`lightning:${addr}`, '_blank');
    }
  }

  function reset(): void {
    paymentState.set('idle');
    paymentError.set('');
  }

  return {
    paymentSats: { subscribe: paymentSats.subscribe },
    resolvedLightningAddress: { subscribe: resolvedLightningAddress.subscribe },
    resolvingLightning: { subscribe: resolvingLightning.subscribe },
    paymentState: { subscribe: paymentState.subscribe },
    paymentError: { subscribe: paymentError.subscribe },
    copiedLightning: { subscribe: copiedLightning.subscribe },
    hasInAppWallet,
    sync,
    handlePayment,
    copyLightning,
    reset
  };
}
