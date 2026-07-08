import { describe, it, expect, beforeEach } from 'vitest';
import fixture from '../../../test/fixtures/vault-sync-v1.json';
import {
  verifyAssertion,
  parseAuthenticatorData,
  derToRawEcdsa,
  isAllowedOrigin,
  b64urlToBytes,
  bytesToB64url
} from './webauthn.server';
import { issueChallenge, redeemChallenge, CHALLENGE_TTL_MS } from './challenge.server';

/**
 * Vector suite for the dependency-free WebAuthn verifier and the HMAC
 * challenge module. All canned vectors come from vault-sync-v1.json
 * (generated once; the assertion is over a challenge issued by the real
 * challenge module at fixed time fixture.issuedAtMs).
 */

const SPKI = b64urlToBytes(fixture.spkiB64url);
const AUTH_DATA = b64urlToBytes(fixture.authenticatorDataB64url);
const CDJ = b64urlToBytes(fixture.clientDataJSONB64url);

function assertionInput(overrides: Partial<Record<'signature' | 'authenticatorData' | 'clientDataJSON', Uint8Array>> = {}) {
  return {
    signature: overrides.signature ?? b64urlToBytes(fixture.signatureB64url),
    authenticatorData: overrides.authenticatorData ?? AUTH_DATA,
    clientDataJSON: overrides.clientDataJSON ?? CDJ
  };
}

describe('verifyAssertion', () => {
  it('accepts the canned valid assertion and reports signCount', async () => {
    const result = await verifyAssertion(assertionInput(), SPKI, fixture.alg, fixture.challenge);
    expect(result.signCount).toBe(0);
  });

  it('rejects a signature from the wrong key', async () => {
    await expect(
      verifyAssertion(
        assertionInput({ signature: b64urlToBytes(fixture.wrongKeySignatureB64url) }),
        SPKI,
        fixture.alg,
        fixture.challenge
      )
    ).rejects.toThrow();
  });

  it('rejects a tampered signature', async () => {
    await expect(
      verifyAssertion(
        assertionInput({ signature: b64urlToBytes(fixture.tamperedSignatureB64url) }),
        SPKI,
        fixture.alg,
        fixture.challenge
      )
    ).rejects.toThrow();
  });

  it('rejects a challenge mismatch', async () => {
    await expect(
      verifyAssertion(assertionInput(), SPKI, fixture.alg, 'different-challenge')
    ).rejects.toThrow(/challenge/);
  });

  it('rejects when the UV flag is clear (validly signed)', async () => {
    await expect(
      verifyAssertion(
        assertionInput({
          authenticatorData: b64urlToBytes(fixture.authenticatorDataNoUvB64url),
          signature: b64urlToBytes(fixture.signatureNoUvB64url)
        }),
        SPKI,
        fixture.alg,
        fixture.challenge
      )
    ).rejects.toThrow(/UV/);
  });

  it('rejects a wrong rpIdHash', async () => {
    const badAuthData = AUTH_DATA.slice();
    badAuthData[0] ^= 0xff;
    await expect(
      verifyAssertion(
        assertionInput({ authenticatorData: badAuthData }),
        SPKI,
        fixture.alg,
        fixture.challenge
      )
    ).rejects.toThrow(/rpIdHash/);
  });

  it('rejects a disallowed origin (validly structured clientDataJSON)', async () => {
    const cdj = JSON.parse(new TextDecoder().decode(CDJ));
    cdj.origin = 'https://evil.example';
    await expect(
      verifyAssertion(
        assertionInput({ clientDataJSON: new TextEncoder().encode(JSON.stringify(cdj)) }),
        SPKI,
        fixture.alg,
        fixture.challenge
      )
    ).rejects.toThrow(/origin/);
  });

  it('rejects a webauthn.create clientData type', async () => {
    const cdj = JSON.parse(new TextDecoder().decode(CDJ));
    cdj.type = 'webauthn.create';
    await expect(
      verifyAssertion(
        assertionInput({ clientDataJSON: new TextEncoder().encode(JSON.stringify(cdj)) }),
        SPKI,
        fixture.alg,
        fixture.challenge
      )
    ).rejects.toThrow(/type/);
  });

  it('rejects an unsupported algorithm', async () => {
    await expect(
      verifyAssertion(assertionInput(), SPKI, -8, fixture.challenge)
    ).rejects.toThrow(/algorithm/);
  });
});

describe('parseAuthenticatorData', () => {
  it('parses rpIdHash, flags and signCount', () => {
    const parsed = parseAuthenticatorData(AUTH_DATA);
    expect(parsed.userPresent).toBe(true);
    expect(parsed.userVerified).toBe(true);
    expect(parsed.signCount).toBe(0);
    expect(parsed.rpIdHash).toHaveLength(32);
  });

  it('reads a big-endian signCount', () => {
    const data = AUTH_DATA.slice();
    data[33] = 0x00;
    data[34] = 0x01;
    data[35] = 0x02;
    data[36] = 0x03;
    expect(parseAuthenticatorData(data).signCount).toBe(0x010203);
  });

  it('rejects short input', () => {
    expect(() => parseAuthenticatorData(new Uint8Array(36))).toThrow(/short/);
  });
});

describe('derToRawEcdsa', () => {
  it('round-trips the fixture signature to 64 raw bytes', () => {
    const raw = derToRawEcdsa(b64urlToBytes(fixture.signatureB64url));
    expect(raw).toHaveLength(64);
  });

  it('handles integers with leading-zero sign bytes', () => {
    // r = 0x00||0xFF...(32), s = 0x01...(31 bytes → left-padded)
    const r = new Uint8Array(33);
    r[0] = 0x00;
    r.fill(0xff, 1);
    const s = new Uint8Array(31).fill(0x01);
    const der = new Uint8Array([
      0x30, 2 + 33 + 2 + 31,
      0x02, 33, ...r,
      0x02, 31, ...s
    ]);
    const raw = derToRawEcdsa(der);
    expect(raw[0]).toBe(0xff); // sign byte stripped
    expect(raw[32]).toBe(0x00); // s left-padded
    expect(raw[33]).toBe(0x01);
  });

  it('rejects trailing bytes and non-sequences', () => {
    const valid = b64urlToBytes(fixture.signatureB64url);
    expect(() => derToRawEcdsa(new Uint8Array([...valid, 0x00]))).toThrow();
    expect(() => derToRawEcdsa(new Uint8Array([0x31, 0x00]))).toThrow(/sequence/);
  });
});

describe('isAllowedOrigin', () => {
  it('allows production and subdomains, https only', () => {
    expect(isAllowedOrigin('https://zap.cooking')).toBe(true);
    expect(isAllowedOrigin('https://staging.zap.cooking')).toBe(true);
    expect(isAllowedOrigin('http://zap.cooking')).toBe(false);
    expect(isAllowedOrigin('https://feat-x.frontend-hvd.pages.dev')).toBe(false);
    expect(isAllowedOrigin('https://zap.cooking.evil.example')).toBe(false);
    expect(isAllowedOrigin('not a url')).toBe(false);
  });
});

describe('challenge module', () => {
  let store: Map<string, string>;
  const kv = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v)
  };

  beforeEach(() => {
    store = new Map();
  });

  it('issues and redeems within the TTL', async () => {
    await expect(
      redeemChallenge(kv, fixture.secret, fixture.challenge, fixture.issuedAtMs + 1000)
    ).resolves.toBeUndefined();
  });

  it('rejects a stale challenge', async () => {
    await expect(
      redeemChallenge(kv, fixture.secret, fixture.challenge, fixture.issuedAtMs + CHALLENGE_TTL_MS + 1)
    ).rejects.toThrow(/expired/);
  });

  it('rejects reuse (tombstone)', async () => {
    await redeemChallenge(kv, fixture.secret, fixture.challenge, fixture.issuedAtMs + 1000);
    await expect(
      redeemChallenge(kv, fixture.secret, fixture.challenge, fixture.issuedAtMs + 2000)
    ).rejects.toThrow(/redeemed/);
  });

  it('rejects a challenge minted under a different secret', async () => {
    const { challenge } = await issueChallenge('other-secret', fixture.issuedAtMs);
    await expect(
      redeemChallenge(kv, fixture.secret, challenge, fixture.issuedAtMs + 1000)
    ).rejects.toThrow(/MAC/);
  });

  it('rejects malformed challenges', async () => {
    await expect(redeemChallenge(kv, fixture.secret, 'AAAA', Date.now())).rejects.toThrow();
    await expect(redeemChallenge(kv, fixture.secret, '!!!', Date.now())).rejects.toThrow();
  });

  it('fresh challenges verify end-to-end with a runtime-signed assertion', async () => {
    // Proves the fixture privateJwk matches the fixture SPKI and that the
    // whole pipeline works for challenges minted NOW (endpoint tests rely
    // on this).
    const { challenge } = await issueChallenge(fixture.secret);
    const key = await crypto.subtle.importKey(
      'jwk',
      fixture.privateJwk as JsonWebKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    );
    const cdj = new TextEncoder().encode(
      JSON.stringify({ type: 'webauthn.get', challenge, origin: fixture.origin })
    );
    const signed = new Uint8Array(AUTH_DATA.length + 32);
    signed.set(AUTH_DATA, 0);
    signed.set(
      new Uint8Array(await crypto.subtle.digest('SHA-256', cdj as BufferSource)),
      AUTH_DATA.length
    );
    const rawSig = new Uint8Array(
      await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signed as BufferSource)
    );
    // raw → DER (mirror of the generator's helper)
    const encodeInt = (bytes: Uint8Array): Uint8Array => {
      let i = 0;
      while (i < bytes.length - 1 && bytes[i] === 0) i++;
      let body = bytes.slice(i);
      if (body[0] & 0x80) body = new Uint8Array([0, ...body]);
      return new Uint8Array([0x02, body.length, ...body]);
    };
    const r = encodeInt(rawSig.slice(0, 32));
    const s = encodeInt(rawSig.slice(32));
    const der = new Uint8Array([0x30, r.length + s.length, ...r, ...s]);

    await expect(
      verifyAssertion(
        { signature: der, authenticatorData: AUTH_DATA, clientDataJSON: cdj },
        SPKI,
        fixture.alg,
        challenge
      )
    ).resolves.toEqual({ signCount: 0 });
    expect(bytesToB64url(b64urlToBytes(fixture.credentialIdB64url))).toBe(
      fixture.credentialIdB64url
    );
  });
});
