import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrantaEnvironment, DestinationType } from '@branta-ops/branta';
import { env } from '$env/dynamic/private';
import {
  getBrantaConfig,
  getPaymentInfo,
  getPaymentInfoByQRCode,
  registerPayment,
  type RegisterPaymentResult
} from '$lib/brantaService.server';
import { POST as registerPost } from './register/+server';
import { POST as verifyPost } from './verify/+server';

const mocks = vi.hoisted(() => ({ checkPerIpRateLimit: vi.fn() }));
vi.mock('$lib/ipRateLimit.server', () => ({ checkPerIpRateLimit: mocks.checkPerIpRateLimit }));

const ADDRESS = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const OTHER_ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
const INVOICE = 'lnbc1testinvoice';
const PLATFORM = { env: { BRANTA_API_KEY: 'test-api-key', BRANTA_ENVIRONMENT: 'Staging' } };
const fetchMock = vi.fn();

interface ApiPayment {
  destinations: {
    value: string;
    type: string;
    zk: boolean;
    zk_id: string;
    encrypted_dek?: string;
  }[];
  ttl?: number;
  metadata?: string;
}

let storedPayment: ApiPayment | undefined;

function post(
  handler: typeof registerPost | typeof verifyPost,
  body: unknown,
  platform: { env: { BRANTA_API_KEY?: string; BRANTA_ENVIRONMENT?: string } } = PLATFORM
) {
  const path = handler === registerPost ? 'register' : 'verify';
  return handler({
    request: new Request(`https://zap.cooking/api/branta/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),
    platform,
    getClientAddress: () => '203.0.113.7'
  } as never);
}

async function register(paymentString = ADDRESS) {
  const response = await post(registerPost, {
    paymentString,
    description: 'Test payment',
    metadata: { order: 'test-order' }
  });
  expect(response.status).toBe(200);
  const result: RegisterPaymentResult = await response.json();
  expect(result.success).toBe(true);
  return result;
}

beforeEach(() => {
  delete env.BRANTA_API_KEY;
  delete env.BRANTA_ENVIRONMENT;
  storedPayment = undefined;
  mocks.checkPerIpRateLimit.mockReset().mockResolvedValue({ limited: false });
  fetchMock
    .mockReset()
    .mockImplementation(async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (init?.method === 'POST') {
        storedPayment = JSON.parse(String(init.body)) as ApiPayment;
        return Response.json(storedPayment);
      }
      return Response.json(storedPayment ? [storedPayment] : []);
    });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  delete env.BRANTA_API_KEY;
  delete env.BRANTA_ENVIRONMENT;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Branta configuration', () => {
  it('degrades gracefully without an API key', async () => {
    expect(getBrantaConfig()).toBeNull();
    expect(await getPaymentInfo(INVOICE)).toBeNull();
    expect(await getPaymentInfoByQRCode(INVOICE)).toBeNull();
    expect(await registerPayment(ADDRESS, undefined, undefined, undefined, undefined)).toEqual({
      success: false,
      error: 'Branta not configured'
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  for (const [name, environment] of [
    ['Staging', BrantaEnvironment.Staging],
    ['Localhost', BrantaEnvironment.Localhost],
    ['Production', BrantaEnvironment.Production],
    ['unexpected', BrantaEnvironment.Production]
  ]) {
    it(`maps ${name} to the SDK environment`, () => {
      expect(
        getBrantaConfig({ env: { BRANTA_API_KEY: 'platform-key', BRANTA_ENVIRONMENT: name } })
      ).toEqual({ apiKey: 'platform-key', environment });
    });
  }

  it('falls back to private env and lets platform configuration override it', () => {
    env.BRANTA_API_KEY = 'fallback-key';
    env.BRANTA_ENVIRONMENT = 'Localhost';
    expect(getBrantaConfig()).toEqual({
      apiKey: 'fallback-key',
      environment: BrantaEnvironment.Localhost
    });
    expect(getBrantaConfig(PLATFORM)).toEqual({
      apiKey: 'test-api-key',
      environment: BrantaEnvironment.Staging
    });
    delete env.BRANTA_ENVIRONMENT;
    expect(getBrantaConfig()?.environment).toBe(BrantaEnvironment.Production);
  });
});

describe('Branta registration through the real SDK', () => {
  for (const [paymentString, type] of [
    [ADDRESS, DestinationType.BitcoinAddress],
    [INVOICE, DestinationType.Bolt11]
  ]) {
    it(`encrypts ${type} and its metadata before posting`, async () => {
      const result = await register(` ${paymentString} `);
      expect(storedPayment?.destinations[0]).toMatchObject({ type, zk: true });
      expect(storedPayment?.destinations[0].zk_id).toBeTruthy();
      expect(storedPayment?.destinations[0].encrypted_dek).toBeTruthy();
      expect(storedPayment?.ttl).toBe(86400);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe('https://staging.guardrail.branta.pro/v2/payments');
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-api-key' });
      expect(String(init?.body)).not.toContain(paymentString.trim());
      expect(String(init?.body)).not.toContain('test-order');
      expect(String(init?.body)).not.toContain('Test payment');
      expect(result.encryptedDestination).toBe(storedPayment?.destinations[0].value);
      expect(result.secret).toBeTruthy();
      expect(result.verifyUrl).toContain('#k-');
    });
  }

  it('preserves an explicit destination type and TTL', async () => {
    const response = await post(registerPost, {
      paymentString: ADDRESS,
      destinationType: DestinationType.BitcoinAddress,
      ttl: 120
    });
    expect(response.status).toBe(200);
    expect(storedPayment?.ttl).toBe(120);
    expect(storedPayment?.destinations[0].type).toBe(DestinationType.BitcoinAddress);
  });

  for (const destinationType of ['bolt12', 'ln_url', 'ln_address', 'tether_address', 'invalid']) {
    it(`rejects unsupported destination type ${destinationType} before calling Branta`, async () => {
      const response = await post(registerPost, { paymentString: ADDRESS, destinationType });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ success: false, error: 'invalid destinationType' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  for (const paymentString of ['', '   ', 42, null]) {
    it(`rejects invalid paymentString ${JSON.stringify(paymentString)}`, async () => {
      expect((await post(registerPost, { paymentString })).status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  it('returns a graceful registration failure when the SDK cannot encrypt a value', async () => {
    const response = await post(registerPost, { paymentString: 'test@example.com' });
    expect(response.status).toBe(500);
    expect((await response.json()).success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves timeout degradation', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('Timed out', 'AbortError'));
    const response = await post(registerPost, { paymentString: ADDRESS });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: 'Request timed out' });
  });
});

describe('Branta verification through the real SDK', () => {
  it('binds an address to its ciphertext and secret without sending either plaintext to Branta', async () => {
    const registration = await register();
    const response = await post(verifyPost, { payment: ` ${ADDRESS} `, ...registration });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.verified).toBe(true);
    expect(result.payment.destinations[0]).toMatchObject({ value: ADDRESS, isEncrypted: false });
    expect(result.payment.description).toBe('Test payment');
    expect(JSON.parse(result.payment.metadata)).toEqual({
      order: 'test-order',
      description: 'Test payment'
    });
    expect(result.payment.verifyUrl).toBe(registration.verifyUrl);
    const [url, init] = fetchMock.mock.calls[1];
    expect(String(url)).toContain(encodeURIComponent(registration.encryptedDestination!));
    expect(String(url)).not.toContain(ADDRESS);
    expect(String(url)).not.toContain(registration.secret);
    expect(init?.method).toBe('GET');
  });

  it('verifies a registered bolt11 invoice without a separate secret', async () => {
    await register(INVOICE);
    const response = await post(verifyPost, { payment: ` ${INVOICE.toUpperCase()} ` });
    const result = await response.json();
    expect(result.verified).toBe(true);
    expect(result.payment.destinations[0].value).toBe(INVOICE);
    expect(String(fetchMock.mock.calls[1][0])).not.toContain(INVOICE);
  });

  it('verifies raw QR text and gives it precedence over separate payment fields', async () => {
    const registration = await register();
    const qr = `bitcoin:${ADDRESS}?branta_id=${encodeURIComponent(registration.encryptedDestination!)}&branta_secret=${encodeURIComponent(registration.secret!)}`;
    const response = await post(verifyPost, { qr, payment: OTHER_ADDRESS, secret: 'wrong' });
    expect((await response.json()).verified).toBe(true);
  });

  it('does not allow a substituted on-chain address to verify', async () => {
    const registration = await register();
    const response = await post(verifyPost, { payment: OTHER_ADDRESS, ...registration });
    expect(await response.json()).toEqual({ verified: false });
  });

  it('does not verify a mismatched secret', async () => {
    const registration = await register();
    const response = await post(verifyPost, { ...registration, payment: ADDRESS, secret: 'wrong' });
    expect(await response.json()).toEqual({ verified: false });
  });

  it('does not verify legacy unencrypted API rows', async () => {
    const registration = await register();
    storedPayment!.destinations[0] = {
      ...storedPayment!.destinations[0],
      value: ADDRESS,
      zk: false
    };
    const response = await post(verifyPost, { payment: ADDRESS, ...registration });
    expect(await response.json()).toEqual({ verified: false });
  });

  it('does not look up a plain on-chain address', async () => {
    const response = await post(verifyPost, { payment: ADDRESS });
    expect(await response.json()).toEqual({ verified: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not verify ciphertext and secret without a payable address', async () => {
    const registration = await register();
    fetchMock.mockClear();
    const response = await post(verifyPost, {
      payment: registration.encryptedDestination,
      secret: registration.secret
    });
    expect(await response.json()).toEqual({ verified: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  for (const fields of [
    { secret: 'test-secret' },
    { encryptedDestination: 'test-ciphertext' },
    { secret: '   ', encryptedDestination: 'test-ciphertext' },
    { secret: 'test-secret', encryptedDestination: 42 }
  ]) {
    it(`does not verify incomplete encryption fields: ${JSON.stringify(fields)}`, async () => {
      const response = await post(verifyPost, { payment: ADDRESS, ...fields });
      expect(await response.json()).toEqual({ verified: false });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }

  it('does not verify QR encryption parameters without a payable instruction', async () => {
    const response = await post(verifyPost, {
      qr: 'bitcoin:?branta_id=test-ciphertext&branta_secret=test-secret'
    });
    expect(await response.json()).toEqual({ verified: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not verify a QR with an unsupported payable instruction', async () => {
    const registration = await register();
    fetchMock.mockClear();
    const response = await post(verifyPost, {
      qr: `bitcoin:${ADDRESS}?branta_id=${encodeURIComponent(registration.encryptedDestination!)}&branta_secret=${registration.secret}&bolt12=lno1test`
    });
    expect(await response.json()).toEqual({ verified: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  for (const status of [404, 503]) {
    it(`degrades to unverified for upstream status ${status}`, async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status }));
      const response = await post(verifyPost, { payment: INVOICE });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ verified: false });
    });
  }

  it('degrades to unverified for an unknown payment', async () => {
    expect(await (await post(verifyPost, { payment: INVOICE })).json()).toEqual({
      verified: false
    });
  });

  for (const error of [new Error('Offline'), new DOMException('Timed out', 'AbortError')]) {
    it(`degrades to unverified for SDK/network failures: ${error}`, async () => {
      fetchMock.mockRejectedValueOnce(error);
      const response = await post(verifyPost, { payment: INVOICE });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ verified: false });
    });
  }

  for (const body of [{}, { payment: '   ' }, { qr: 42 }, { payment: null }]) {
    it(`rejects missing payable input: ${JSON.stringify(body)}`, async () => {
      expect((await post(verifyPost, body)).status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  }
});

for (const handler of [registerPost, verifyPost]) {
  describe(`Branta ${handler === registerPost ? 'register' : 'verify'} endpoint guards`, () => {
    it('returns 503 when unconfigured', async () => {
      expect((await post(handler, {}, { env: {} })).status).toBe(503);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('preserves per-IP rate limits', async () => {
      mocks.checkPerIpRateLimit.mockResolvedValue({
        limited: true,
        body: { error: 'rate_limited' }
      });
      expect((await post(handler, {})).status).toBe(429);
      const [binding, options] = mocks.checkPerIpRateLimit.mock.calls[0];
      expect(binding).toBeUndefined();
      expect(options).toMatchObject({ ip: '203.0.113.7', perHour: 5, perDay: 20 });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
}
