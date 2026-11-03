import { browser } from '$app/environment';
import { derived } from 'svelte/store';
import { walletConnected, wallets, walletRestoring, walletSetupCheckPending } from './walletStore';
import { weblnConnected } from './webln';
import { bitcoinConnectEnabled, bitcoinConnectWalletInfo } from './bitcoinConnect';
import { openWallet, walletModalOpen } from './walletModalStore';

/**
 * Wallet setup is offered once, at a signed-in member's first ⚡ tap,
 * inside the zap flow: the zap sheet steps aside, the wallet picker
 * opens, and the sheet comes back when the picker closes. It replaced
 * the welcome modal that opened by itself after sign-in. The sidebar's
 * "Set up a Wallet" entry stays for everyone who wants it sooner.
 */

const SEEN_KEY = 'zapcooking_wallet_zap_prompt_seen';

/** Any wallet the zap sheet can pay with (same answer as SidebarWallet). */
export const hasAnyWallet = derived(
  [walletConnected, weblnConnected, bitcoinConnectEnabled, bitcoinConnectWalletInfo, wallets],
  ([$connected, $webln, $bcEnabled, $bcInfo, $wallets]) =>
    $connected || $webln || ($bcEnabled && $bcInfo.connected) || $wallets.length > 0
);

/** A remembered or still-encrypted wallet is on its way back: not "no wallet" yet. */
export const walletCheckPending = derived(
  [walletRestoring, walletSetupCheckPending],
  ([$restoring, $pending]) => $restoring || $pending
);

export interface ZapWalletPromptInput {
  signedIn: boolean;
  hasWallet: boolean;
  checkPending: boolean;
  seen: boolean;
}

export function shouldOfferWalletAtZap(input: ZapWalletPromptInput): boolean {
  return input.signedIn && !input.hasWallet && !input.checkPending && !input.seen;
}

export function zapWalletPromptSeen(): boolean {
  if (!browser) return true;
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markZapWalletPromptSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Storage blocked: the offer may come back on a later zap, which is harmless.
  }
}

/** Open wallet setup and resolve once the wallet modal closes again. */
export function offerWalletSetup(): Promise<void> {
  markZapWalletPromptSeen();
  openWallet('setup', { elevated: true });
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    unsubscribe = walletModalOpen.subscribe((isOpen) => {
      if (isOpen || settled) return;
      settled = true;
      resolve();
      // subscribe() runs synchronously: the handle may not be assigned yet.
      queueMicrotask(() => unsubscribe?.());
    });
  });
}
