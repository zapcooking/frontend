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

export function openWallet(view: WalletView = 'main'): void {
  walletModalView.set(view);
  walletModalOpen.set(true);
}

export function closeWallet(): void {
  walletModalOpen.set(false);
  walletModalView.set('main');
}

export function setWalletView(view: WalletView): void {
  walletModalView.set(view);
}

export function isWalletModalOpen(): boolean {
  return get(walletModalOpen);
}
