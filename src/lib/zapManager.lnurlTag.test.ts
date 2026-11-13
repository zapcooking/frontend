import { describe, it, expect, vi, afterEach } from 'vitest';
import NDK, { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk';
import { bech32 } from 'bech32';

// zapManager pulls in app-wide modules that need SvelteKit's $app aliases;
// none of them are exercised by the invoice step under test.
vi.mock('./authManager', () => ({ AuthManager: class {}, getAuthManager: () => ({}) }));
vi.mock('./profileResolver', () => ({ resolveProfileByPubkey: async () => null }));

import { ZapManager, type LNURLPayRequest } from './zapManager';

const RECIPIENT = '669ebbcccf409ee0467a33660ae88fd17e5379e646e41d7c236ff4963f3c36b6';
const PAY_URL = 'https://lightning-goats.com/.well-known/lnurlp/herd';
const CALLBACK = 'https://lightning-goats.com/lnurlp/herd/callback';

function payRequest(extra: Partial<LNURLPayRequest> = {}): LNURLPayRequest {
  return {
    callback: CALLBACK,
    minSendable: 1000,
    maxSendable: 1_000_000_000,
    metadata: '[]',
    nostrPubkey: RECIPIENT,
    allowsNostr: true,
    ...extra
  };
}

async function sentZapRequest(pay: LNURLPayRequest) {
  const ndk = new NDK({ signer: NDKPrivateKeySigner.generate() });
  const manager = new ZapManager(ndk);
  const zapRequest = await manager.createZapRequest({
    pubkey: RECIPIENT,
    amount: 21000,
    relays: ['wss://relay.damus.io']
  });

  let sentUrl = '';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      sentUrl = input;
      return new Response(JSON.stringify({ pr: 'lnbc210n1test' }), { status: 200 });
    })
  );
  await manager.getZapInvoice(pay, zapRequest, 21000);

  const proxied = new URL(sentUrl, 'http://localhost');
  const callback = new URL(proxied.searchParams.get('url')!);
  return JSON.parse(callback.searchParams.get('nostr')!) as { tags: string[][] };
}

describe('zap request lnurl tag', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is the bech32-encoded LNURL-pay URL, not the callback', async () => {
    const event = await sentZapRequest(payRequest({ payUrl: PAY_URL }));
    const tag = event.tags.find((t) => t[0] === 'lnurl');
    expect(tag).toBeDefined();
    const decoded = bech32.decode(tag![1], 2000);
    expect(decoded.prefix).toBe('lnurl');
    expect(new TextDecoder().decode(Uint8Array.from(bech32.fromWords(decoded.words)))).toBe(PAY_URL);
  });

  it('is dropped when the pay URL is unknown', async () => {
    const event = await sentZapRequest(payRequest());
    expect(event.tags.some((t) => t[0] === 'lnurl')).toBe(false);
  });
});
