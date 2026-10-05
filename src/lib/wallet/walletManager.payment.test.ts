import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * sendPayment reports what the wallet actually did: sent only when the
 * payment completed (Breez status, or a real NWC / WebLN preimage).
 */

const PRE = 'cd'.repeat(32);

const m = vi.hoisted(() => ({
  wallet: null as null | { id: string; kind: number; data: string; name: string; active: boolean },
  sparkReady: false,
  stored: true,
  restoring: false,
  sendZap: vi.fn(),
  payNwcInvoice: vi.fn(),
  payWeblnInvoice: vi.fn(),
  weblnConnected: false,
  nwcConnectedTo: true
}));

vi.mock('$lib/nostr', async () => {
  const { writable } = await import('svelte/store');
  return {
    ndkReady: Promise.resolve(),
    userPublickey: writable('a'.repeat(64)),
    ndk: writable(null)
  };
});
vi.mock('./walletStore', async () => {
  const { writable, derived } = await import('svelte/store');
  const wallets = writable<any[]>([]);
  return {
    wallets,
    activeWallet: derived(wallets, () => m.wallet),
    walletBalance: writable(null),
    walletLoading: writable(false),
    walletLastSync: writable(null),
    walletsDecrypted: writable(true),
    walletRestoring: { subscribe: (f: (v: boolean) => void) => (f(m.restoring), () => {}) },
    addWallet: vi.fn(),
    removeWallet: vi.fn(),
    setActiveWallet: vi.fn(),
    getActiveWallet: () => m.wallet
  };
});
vi.mock('./nwc', () => ({
  connectNwc: vi.fn(),
  disconnectNwc: vi.fn(),
  getNwcBalance: vi.fn(async () => 0),
  payNwcInvoice: m.payNwcInvoice,
  payNwcLightningAddress: vi.fn(),
  isLightningAddress: () => false,
  createNwcInvoice: vi.fn(),
  lookupNwcInvoice: vi.fn(),
  isNwcConnected: () => true,
  isNwcConnectedTo: () => m.nwcConnectedTo,
  getNwcDisplayName: () => 'nwc',
  getNwcInfo: vi.fn(),
  listNwcTransactions: vi.fn(async () => [])
}));
vi.mock('./webln', () => ({
  connectWebln: vi.fn(),
  disconnectWebln: vi.fn(),
  getWeblnBalance: vi.fn(async () => 0),
  payWeblnInvoice: m.payWeblnInvoice,
  isWeblnAvailable: () => false,
  isWeblnConnected: () => m.weblnConnected,
  getWeblnDisplayName: () => 'webln'
}));
vi.mock('$lib/spark', async () => {
  const { writable } = await import('svelte/store');
  return {
    walletBalance: writable(0),
    walletInitialized: { subscribe: (f: (v: boolean) => void) => (f(m.sparkReady), () => {}) },
    lightningAddress: writable(null),
    connectWallet: vi.fn(async () => true),
    disconnectWallet: vi.fn(),
    listPayments: vi.fn(async () => []),
    refreshBalance: vi.fn(async () => {}),
    receivePayment: vi.fn(),
    recentSparkPayments: writable([]),
    sendZap: m.sendZap
  };
});
vi.mock('$lib/spark/storage', () => ({ hasStoredMnemonic: () => m.stored }));

const spark = { id: 's', kind: 4, data: 'spark-id', name: 'Breez Spark', active: true };
const nwc = { id: 'n', kind: 3, data: 'nostr+walletconnect://x', name: 'NWC', active: true };

beforeEach(() => {
  vi.stubEnv('VITE_BREEZ_API_KEY', 'test-key');
  m.wallet = spark;
  m.sparkReady = true;
  m.stored = true;
  m.restoring = false;
  m.weblnConnected = false;
  m.nwcConnectedTo = true;
  m.sendZap.mockReset();
  m.payNwcInvoice.mockReset();
  m.payWeblnInvoice.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

async function pay() {
  const { sendPayment } = await import('./walletManager');
  return sendPayment('lnbc1...', { amount: 21 });
}

describe('Breez (Spark)', () => {
  it('completed → sent, with the preimage from the HTLC details', async () => {
    m.sendZap.mockResolvedValue({
      payment: {
        status: 'completed',
        details: { type: 'lightning', htlcDetails: { preimage: PRE } }
      }
    });
    expect(await pay()).toEqual({ success: true, status: 'completed', preimage: PRE });
  });
  it('still pending after the completion wait → pending, never sent', async () => {
    m.sendZap.mockResolvedValue({ payment: { status: 'pending' } });
    const r = await pay();
    expect(r).toMatchObject({
      success: false,
      status: 'pending',
      error: 'Payment still pending, check your wallet'
    });
  });
  it('failed → a clear error', async () => {
    m.sendZap.mockResolvedValue({ payment: { status: 'failed' } });
    expect(await pay()).toMatchObject({ success: false, status: 'failed' });
  });
  it('the SDK throwing → failed with its message; a timeout → pending', async () => {
    m.sendZap.mockRejectedValue(new Error('insufficient funds'));
    expect(await pay()).toMatchObject({ status: 'failed', error: 'insufficient funds' });
    m.sendZap.mockRejectedValue(new Error('request timed out'));
    expect((await pay()).status).toBe('pending');
  });
  it('no Breez seed on this site (a preview) → "No wallet connected" at once, nothing attempted', async () => {
    m.sparkReady = false;
    m.stored = false;
    expect(await pay()).toEqual({
      success: false,
      status: 'unavailable',
      error: 'No wallet connected'
    });
    expect(m.sendZap).not.toHaveBeenCalled();
  });
  it('a seed still being restored after login is connectable, not missing', async () => {
    const { walletAvailability } = await import('./walletManager');
    m.sparkReady = false;
    m.stored = false;
    m.restoring = true;
    expect(walletAvailability()).toBe('connectable');
  });
});

describe('NWC', () => {
  beforeEach(() => {
    m.wallet = nwc;
  });
  it('a real preimage → sent', async () => {
    m.payNwcInvoice.mockResolvedValue({ preimage: PRE });
    expect(await pay()).toMatchObject({ success: true, preimage: PRE });
  });
  it('an answer without a preimage → pending, not sent', async () => {
    m.payNwcInvoice.mockResolvedValue({ preimage: undefined });
    expect((await pay()).status).toBe('pending');
  });
  it('a request timeout → pending (it may still pay), never failed', async () => {
    m.payNwcInvoice.mockRejectedValue(new Error('NWC request timeout'));
    expect((await pay()).status).toBe('pending');
  });
  it('a wallet error → failed', async () => {
    m.payNwcInvoice.mockRejectedValue(new Error('INSUFFICIENT_BALANCE'));
    expect((await pay()).status).toBe('failed');
  });
});

describe('WebLN / Alby (no wallet entry)', () => {
  beforeEach(() => {
    m.wallet = null;
    m.weblnConnected = true;
  });
  it('a preimage → sent; none → pending; rejection → failed', async () => {
    m.payWeblnInvoice.mockResolvedValue({ preimage: PRE });
    expect((await pay()).status).toBe('completed');
    m.payWeblnInvoice.mockResolvedValue({});
    expect((await pay()).status).toBe('pending');
    m.payWeblnInvoice.mockRejectedValue(new Error('User rejected'));
    expect((await pay()).status).toBe('failed');
  });
  it('no wallet at all → unavailable', async () => {
    m.weblnConnected = false;
    expect((await pay()).status).toBe('unavailable');
  });
});
