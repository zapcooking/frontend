import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';

/**
 * Wallet setup is offered at a signed-in member's first ⚡ tap, once, and
 * never while a remembered wallet is still being restored. The offer opens
 * the wallet picker and hands control back when the picker closes.
 */

vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('./walletStore', async () => {
  const { writable } = await import('svelte/store');
  return {
    walletConnected: writable(false),
    wallets: writable([]),
    walletRestoring: writable(false),
    walletSetupCheckPending: writable(false)
  };
});
vi.mock('./webln', async () => {
  const { writable } = await import('svelte/store');
  return { weblnConnected: writable(false) };
});
vi.mock('./bitcoinConnect', async () => {
  const { writable } = await import('svelte/store');
  return {
    bitcoinConnectEnabled: writable(false),
    bitcoinConnectWalletInfo: writable({ connected: false })
  };
});

const store = await import('./walletStore');
const webln = await import('./webln');
const bc = await import('./bitcoinConnect');
const modal = await import('./walletModalStore');
const prompt = await import('./zapWalletPrompt');

const base = { signedIn: true, hasWallet: false, checkPending: false, seen: false };

const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.set(k, v),
  removeItem: (k: string) => void storage.delete(k),
  clear: () => storage.clear()
});

beforeEach(() => {
  localStorage.clear();
  modal.closeWallet();
  (store.walletConnected as unknown as { set: (v: boolean) => void }).set(false);
  store.wallets.set([]);
  store.walletRestoring.set(false);
  store.walletSetupCheckPending.set(false);
  webln.weblnConnected.set(false);
  bc.bitcoinConnectEnabled.set(false);
  bc.bitcoinConnectWalletInfo.set({ connected: false } as never);
});

describe('shouldOfferWalletAtZap', () => {
  it('offers to a signed-in member with no wallet who has not seen it', () => {
    expect(prompt.shouldOfferWalletAtZap(base)).toBe(true);
  });

  const blockers: Array<[string, Partial<typeof base>]> = [
    ['signed out', { signedIn: false }],
    ['has a wallet', { hasWallet: true }],
    ['wallet restore pending', { checkPending: true }],
    ['already offered', { seen: true }]
  ];
  for (const [label, patch] of blockers) {
    it(`does not offer when ${label}`, () => {
      expect(prompt.shouldOfferWalletAtZap({ ...base, ...patch })).toBe(false);
    });
  }
});

describe('hasAnyWallet', () => {
  it('is false with nothing connected', () => {
    expect(get(prompt.hasAnyWallet)).toBe(false);
  });

  it('counts an in-app wallet, WebLN, a connected Bitcoin Connect, or a stored wallet', () => {
    (store.walletConnected as unknown as { set: (v: boolean) => void }).set(true);
    expect(get(prompt.hasAnyWallet)).toBe(true);
    (store.walletConnected as unknown as { set: (v: boolean) => void }).set(false);

    webln.weblnConnected.set(true);
    expect(get(prompt.hasAnyWallet)).toBe(true);
    webln.weblnConnected.set(false);

    bc.bitcoinConnectEnabled.set(true);
    expect(get(prompt.hasAnyWallet)).toBe(false);
    bc.bitcoinConnectWalletInfo.set({ connected: true } as never);
    expect(get(prompt.hasAnyWallet)).toBe(true);
    bc.bitcoinConnectEnabled.set(false);

    store.wallets.set([{ id: 1, kind: 4, name: 'Spark', active: false, data: 'spark' }] as never);
    expect(get(prompt.hasAnyWallet)).toBe(true);
  });
});

describe('walletCheckPending', () => {
  it('is pending while a wallet restores or the setup check is open', () => {
    expect(get(prompt.walletCheckPending)).toBe(false);
    store.walletRestoring.set(true);
    expect(get(prompt.walletCheckPending)).toBe(true);
    store.walletRestoring.set(false);
    store.walletSetupCheckPending.set(true);
    expect(get(prompt.walletCheckPending)).toBe(true);
  });
});

describe('offerWalletSetup', () => {
  it('opens the setup view, marks the offer seen, and resolves when the picker closes', async () => {
    expect(prompt.zapWalletPromptSeen()).toBe(false);
    let done = false;
    const p = prompt.offerWalletSetup().then(() => (done = true));

    expect(get(modal.walletModalOpen)).toBe(true);
    expect(get(modal.walletModalView)).toBe('setup');
    // Stacks above whatever dialog the zap sheet was opened from.
    expect(get(modal.walletModalElevated)).toBe(true);
    expect(prompt.zapWalletPromptSeen()).toBe(true);

    await Promise.resolve();
    expect(done).toBe(false);

    modal.closeWallet();
    await p;
    expect(done).toBe(true);
    expect(get(modal.walletModalElevated)).toBe(false);
  });

  it('resolves only once even if the picker opens and closes again', async () => {
    const resolved = vi.fn();
    const p = prompt.offerWalletSetup().then(resolved);
    modal.closeWallet();
    await p;
    modal.openWallet('setup');
    modal.closeWallet();
    await Promise.resolve();
    expect(resolved).toHaveBeenCalledTimes(1);
  });
});

describe('openWallet', () => {
  it('opens at the normal level unless asked to stack above other dialogs', () => {
    modal.openWallet('setup', { elevated: true });
    modal.openWallet('main');
    expect(get(modal.walletModalElevated)).toBe(false);
  });
});
