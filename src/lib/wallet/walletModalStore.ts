import { writable, get } from 'svelte/store';

export type WalletView =
  | 'main'
  | 'send'
  | 'receive'
  | 'history'
  | 'lightning-address'
  | 'backup'
  | 'setup';

export const walletModalOpen = writable(false);
export const walletModalView = writable<WalletView>('main');
/**
 * Opened from inside another flow (the zap sheet), which may itself sit in
 * an open dialog: the modal then stacks above other dialogs on mobile too,
 * instead of dropping below the header and bottom nav.
 */
export const walletModalElevated = writable(false);
/**
 * A dialog stacked on top of the wallet modal (see stackedDialog) is open:
 * the modal keeps its content but stops trapping Tab and handling Escape.
 */
export const walletModalSuspended = writable(false);

export function openWallet(view: WalletView = 'main', opts: { elevated?: boolean } = {}): void {
  walletModalView.set(view);
  walletModalElevated.set(opts.elevated ?? false);
  walletModalOpen.set(true);
}

export function closeWallet(): void {
  walletModalOpen.set(false);
  walletModalView.set('main');
  walletModalElevated.set(false);
}

export function setWalletView(view: WalletView): void {
  walletModalView.set(view);
}

export function isWalletModalOpen(): boolean {
  return get(walletModalOpen);
}
