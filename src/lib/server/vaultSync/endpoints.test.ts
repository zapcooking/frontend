import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fixture from '../../../test/fixtures/vault-sync-v1.json';
import { issueChallenge } from './challenge.server';
import { b64urlToBytes } from './webauthn.server';
import { POST as challengePOST } from '../../../routes/api/vault-sync/challenge/+server';
import { PUT as uploadPUT } from '../../../routes/api/vault-sync/+server';
import {
  POST as fetchPOST,
  DELETE as deleteDELETE
} from '../../../routes/api/vault-sync/[credentialIdHash]/+server';

/**
 * Endpoint tests against the real route handlers with a map-backed KV stub.
 * Assertions are minted at RUNTIME over fresh challenges (the fixture's
 * canned challenge is time-fixed and would be expired here) using the
 * fixture's test-only private key — signatures verify against the same
 * SPKI a real client would register, and the blob is the frozen vault-v1
 * record verbatim.
 */

const SECRET = fixture.secret;
const CRED_ID = fixture.credentialIdB64url;
const AUTH_DATA = b64urlToBytes(fixture.authenticatorDataB64url);

let store: Map<string, { value: string; ttl?: number }>;
function makeKv() {
  return {
    get: async (k: string, type?: string) => {
      const e = store.get(k);
      if (!e) return null;
      return type === 'json' ? JSON.parse(e.value) : e.value;
    },
    put: async (k: string, value: string, options?: { expirationTtl?: number }) => {
      store.set(k, { value, ttl: options?.expirationTtl });
    },
    delete: async (k: string) => void store.delete(k)
  };
}

let kv: ReturnType<typeof makeKv>;
let platform: any;
const event = (request: Request, params: Record<string, string> = {}) =>
  ({ request, platform, params, getClientAddress: () => '203.0.113.5' }) as any;

async function credentialIdHash(credIdB64url = CRED_ID): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', b64urlToBytes(credIdB64url) as BufferSource)
  );
  return Array.from(digest)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function rawToDer(raw: Uint8Array): Uint8Array {
  const encodeInt = (bytes: Uint8Array): Uint8Array => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    let body = bytes.slice(i);
    if (body[0] & 0x80) body = new Uint8Array([0, ...body]);
    return new Uint8Array([0x02, body.length, ...body]);
  };
  const r = encodeInt(raw.slice(0, 32));
  const s = encodeInt(raw.slice(32));
  return new Uint8Array([0x30, r.length + s.length, ...r, ...s]);
}

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Mint a fresh, valid assertion (or a broken variant) at runtime. */
async function mintAssertion(
  opts: { wrongKey?: boolean; challenge?: string; credentialId?: string } = {}
) {
  const challenge = opts.challenge ?? (await issueChallenge(SECRET)).challenge;
  const jwk = (opts.wrongKey ? fixture.wrongPrivateJwk : fixture.privateJwk) as JsonWebKey;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const cdj = new TextEncoder().encode(
    JSON.stringify({ type: 'webauthn.get', challenge, origin: fixture.origin })
  );
  const signed = new Uint8Array(AUTH_DATA.length + 32);
  signed.set(AUTH_DATA, 0);
  signed.set(
    new Uint8Array(await crypto.subtle.digest('SHA-256', cdj as BufferSource)),
    AUTH_DATA.length
  );
  const raw = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signed as BufferSource)
  );
  return {
    credentialId: opts.credentialId ?? CRED_ID,
    signature: b64url(rawToDer(raw)),
    authenticatorData: fixture.authenticatorDataB64url,
    clientDataJSON: b64url(cdj)
  };
}

function putRequest(body: unknown): Request {
  return new Request('https://zap.cooking/api/vault-sync', {
    method: 'PUT',
    body: JSON.stringify(body)
  });
}

async function uploadFixtureBlob() {
  const res = await uploadPUT(
    event(
      putRequest({
        blob: fixture.blob,
        spki: fixture.spkiB64url,
        alg: fixture.alg,
        assertion: await mintAssertion()
      })
    )
  );
  expect(res.status).toBe(200);
}

beforeEach(() => {
  store = new Map();
  kv = makeKv();
  platform = { env: { VAULT_SYNC: kv, VAULT_SYNC_CHALLENGE_SECRET: SECRET } };
});

describe('POST /api/vault-sync/challenge', () => {
  it('issues a redeemable challenge', async () => {
    const res = await challengePOST(event(new Request('https://zap.cooking', { method: 'POST' })));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.challenge).toBe('string');
    expect(body.expiresAt).toBeGreaterThan(Date.now());
  });

  it('503 when bindings are missing', async () => {
    platform = { env: {} };
    const res = await challengePOST(event(new Request('https://zap.cooking', { method: 'POST' })));
    expect(res.status).toBe(503);
  });
});

describe('PUT /api/vault-sync (upload)', () => {
  it('TOFU first upload: stores entry keyed by sha256(credentialId) with TTL', async () => {
    await uploadFixtureBlob();
    const key = await credentialIdHash();
    const entry = store.get(key);
    expect(entry).toBeDefined();
    const parsed = JSON.parse(entry!.value);
    expect(parsed.blob).toBe(fixture.blob);
    expect(parsed.credentialPublicKey).toBe(fixture.spkiB64url);
    expect(parsed.alg).toBe(-7);
    expect(entry!.ttl).toBe(370 * 24 * 60 * 60);
  });

  it('first upload without spki/alg → 400', async () => {
    const res = await uploadPUT(
      event(putRequest({ blob: fixture.blob, assertion: await mintAssertion() }))
    );
    expect(res.status).toBe(400);
  });

  it('first upload with a wrong-key assertion → uniform 404 (TOFU is possession-proving)', async () => {
    const res = await uploadPUT(
      event(
        putRequest({
          blob: fixture.blob,
          spki: fixture.spkiB64url,
          alg: fixture.alg,
          assertion: await mintAssertion({ wrongKey: true })
        })
      )
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(store.get(await credentialIdHash())).toBeUndefined();
  });

  it('update verifies against the STORED key — wrong key cannot overwrite', async () => {
    await uploadFixtureBlob();
    const res = await uploadPUT(
      event(
        putRequest({
          blob: fixture.blob,
          // Attacker submits their own spki on update; it must be ignored
          // and the assertion checked against the stored key.
          spki: 'attacker-key',
          alg: -7,
          assertion: await mintAssertion({ wrongKey: true })
        })
      )
    );
    expect(res.status).toBe(404);
    const stored = JSON.parse(store.get(await credentialIdHash())!.value);
    expect(stored.credentialPublicKey).toBe(fixture.spkiB64url);
  });

  it('oversized blob → 413 before any crypto', async () => {
    const res = await uploadPUT(
      event(
        putRequest({
          blob: 'x'.repeat(4097),
          spki: fixture.spkiB64url,
          alg: fixture.alg,
          assertion: await mintAssertion()
        })
      )
    );
    expect(res.status).toBe(413);
  });

  it('malformed JSON body → 400', async () => {
    const res = await uploadPUT(
      event(
        new Request('https://zap.cooking/api/vault-sync', { method: 'PUT', body: 'not-json' })
      )
    );
    expect(res.status).toBe(400);
  });

  it('blob whose keys[] lacks the asserting credential → uniform 404', async () => {
    const record = JSON.parse(fixture.blob);
    record.keys[0].credentialId = 'c29tZW9uZS1lbHNl';
    const res = await uploadPUT(
      event(
        putRequest({
          blob: JSON.stringify(record),
          spki: fixture.spkiB64url,
          alg: fixture.alg,
          assertion: await mintAssertion()
        })
      )
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('reused challenge → uniform 404 (tombstone)', async () => {
    const { challenge } = await issueChallenge(SECRET);
    const first = await uploadPUT(
      event(
        putRequest({
          blob: fixture.blob,
          spki: fixture.spkiB64url,
          alg: fixture.alg,
          assertion: await mintAssertion({ challenge })
        })
      )
    );
    expect(first.status).toBe(200);
    const replay = await uploadPUT(
      event(
        putRequest({
          blob: fixture.blob,
          spki: fixture.spkiB64url,
          alg: fixture.alg,
          assertion: await mintAssertion({ challenge })
        })
      )
    );
    expect(replay.status).toBe(404);
  });
});

describe('POST /api/vault-sync/:hash (fetch)', () => {
  it('happy path: returns the blob and refreshes the TTL + signCount', async () => {
    await uploadFixtureBlob();
    const key = await credentialIdHash();
    store.get(key)!.ttl = 1; // stomp so the refresh is observable

    const res = await fetchPOST(
      event(
        new Request('https://zap.cooking', {
          method: 'POST',
          body: JSON.stringify({ assertion: await mintAssertion() })
        }),
        { credentialIdHash: key }
      )
    );
    expect(res.status).toBe(200);
    expect((await res.json()).blob).toBe(fixture.blob);
    expect(store.get(key)!.ttl).toBe(370 * 24 * 60 * 60);
  });

  it('absent entry → uniform 404', async () => {
    const res = await fetchPOST(
      event(
        new Request('https://zap.cooking', {
          method: 'POST',
          body: JSON.stringify({ assertion: await mintAssertion() })
        }),
        { credentialIdHash: await credentialIdHash() }
      )
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('wrong-key assertion → uniform 404, blob not returned', async () => {
    await uploadFixtureBlob();
    const res = await fetchPOST(
      event(
        new Request('https://zap.cooking', {
          method: 'POST',
          body: JSON.stringify({ assertion: await mintAssertion({ wrongKey: true }) })
        }),
        { credentialIdHash: await credentialIdHash() }
      )
    );
    expect(res.status).toBe(404);
  });

  it('path hash not matching the asserting credential → uniform 404', async () => {
    await uploadFixtureBlob();
    const res = await fetchPOST(
      event(
        new Request('https://zap.cooking', {
          method: 'POST',
          body: JSON.stringify({ assertion: await mintAssertion() })
        }),
        { credentialIdHash: 'ab'.repeat(32) }
      )
    );
    expect(res.status).toBe(404);
  });

  it('uniform-404 sweep: every auth-shaped failure is byte-identical', async () => {
    await uploadFixtureBlob();
    const key = await credentialIdHash();
    const expired = (await issueChallenge(SECRET, Date.now() - 10 * 60 * 1000)).challenge;
    const cases: Array<() => Promise<Response>> = [
      // absent entry (different credential id → different hash)
      async () =>
        fetchPOST(
          event(
            new Request('https://zap.cooking', {
              method: 'POST',
              body: JSON.stringify({
                assertion: await mintAssertion({ credentialId: 'b3RoZXItY3JlZA' })
              })
            }),
            { credentialIdHash: await credentialIdHash('b3RoZXItY3JlZA') }
          )
        ),
      // wrong key
      async () =>
        fetchPOST(
          event(
            new Request('https://zap.cooking', {
              method: 'POST',
              body: JSON.stringify({ assertion: await mintAssertion({ wrongKey: true }) })
            }),
            { credentialIdHash: key }
          )
        ),
      // expired challenge
      async () =>
        fetchPOST(
          event(
            new Request('https://zap.cooking', {
              method: 'POST',
              body: JSON.stringify({ assertion: await mintAssertion({ challenge: expired }) })
            }),
            { credentialIdHash: key }
          )
        ),
      // path mismatch
      async () =>
        fetchPOST(
          event(
            new Request('https://zap.cooking', {
              method: 'POST',
              body: JSON.stringify({ assertion: await mintAssertion() })
            }),
            { credentialIdHash: 'cd'.repeat(32) }
          )
        )
    ];
    for (const run of cases) {
      const res = await run();
      expect(res.status).toBe(404);
      expect(await res.text()).toBe(JSON.stringify({ error: 'not_found' }));
    }
  });
});

describe('DELETE /api/vault-sync/:hash', () => {
  it('verified assertion deletes the entry', async () => {
    await uploadFixtureBlob();
    const key = await credentialIdHash();
    const res = await deleteDELETE(
      event(
        new Request('https://zap.cooking', {
          method: 'DELETE',
          body: JSON.stringify({ assertion: await mintAssertion() })
        }),
        { credentialIdHash: key }
      )
    );
    expect(res.status).toBe(200);
    expect(store.get(key)).toBeUndefined();
  });

  it('absent entry → uniform 404 (no existence oracle; client treats as already-gone)', async () => {
    const res = await deleteDELETE(
      event(
        new Request('https://zap.cooking', {
          method: 'DELETE',
          body: JSON.stringify({ assertion: await mintAssertion() })
        }),
        { credentialIdHash: await credentialIdHash() }
      )
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('wrong-key assertion cannot delete', async () => {
    await uploadFixtureBlob();
    const key = await credentialIdHash();
    const res = await deleteDELETE(
      event(
        new Request('https://zap.cooking', {
          method: 'DELETE',
          body: JSON.stringify({ assertion: await mintAssertion({ wrongKey: true }) })
        }),
        { credentialIdHash: key }
      )
    );
    expect(res.status).toBe(404);
    expect(store.get(key)).toBeDefined();
  });
});

// ── Registration-authorized first upload (PR B, one-prompt signup) ──

/**
 * A create() response's wire form: authenticatorData with the AT flag and
 * attested credential data (aaguid | idLength | id | COSE key), and a
 * webauthn.create clientDataJSON over a fresh server challenge.
 */
async function mintRegistration(
  opts: {
    type?: string;
    challenge?: string;
    credentialId?: string;
    attestedCredentialId?: string;
    flags?: number;
    rpIdHashFrom?: Uint8Array;
  } = {}
) {
  const challenge = opts.challenge ?? (await issueChallenge(SECRET)).challenge;
  const claimed = opts.credentialId ?? CRED_ID;
  const attested = b64urlToBytes(opts.attestedCredentialId ?? claimed);
  const head = (opts.rpIdHashFrom ?? AUTH_DATA).slice(0, 32);
  const authData = new Uint8Array([
    ...head,
    opts.flags ?? 0x45, // UP | UV | AT
    0,
    0,
    0,
    0, // signCount
    ...new Uint8Array(16), // aaguid
    attested.length >> 8,
    attested.length & 0xff,
    ...attested,
    0xa5,
    0x01,
    0x02 // start of a COSE key (not parsed server-side)
  ]);
  const cdj = new TextEncoder().encode(
    JSON.stringify({ type: opts.type ?? 'webauthn.create', challenge, origin: fixture.origin })
  );
  return {
    credentialId: claimed,
    authenticatorData: b64url(authData),
    clientDataJSON: b64url(cdj)
  };
}

async function registrationUpload(registration: unknown, spki = fixture.spkiB64url) {
  return uploadPUT(event(putRequest({ blob: fixture.blob, spki, alg: fixture.alg, registration })));
}

const storedEntry = async () => {
  const e = store.get(await credentialIdHash());
  return e ? { ...JSON.parse(e.value), ttl: e.ttl } : null;
};

describe('PUT /api/vault-sync (registration-authorized first upload)', () => {
  it('stores the entry UNCONFIRMED with the short TTL', async () => {
    const res = await registrationUpload(await mintRegistration());
    expect(res.status).toBe(200);
    const entry = await storedEntry();
    expect(entry.unconfirmed).toBe(true);
    expect(entry.credentialPublicKey).toBe(fixture.spkiB64url);
    expect(entry.blob).toBe(fixture.blob);
    expect(entry.ttl).toBe(30 * 24 * 60 * 60);
  });

  it('never touches an existing entry (confirmed or not)', async () => {
    await uploadFixtureBlob();
    const before = store.get(await credentialIdHash());
    const res = await registrationUpload(await mintRegistration());
    expect(res.status).toBe(404);
    expect(store.get(await credentialIdHash())).toEqual(before);

    store.clear();
    await registrationUpload(await mintRegistration());
    const unconfirmed = store.get(await credentialIdHash());
    expect((await registrationUpload(await mintRegistration())).status).toBe(404);
    expect(store.get(await credentialIdHash())).toEqual(unconfirmed);
  });

  it('requires spki/alg (400) and rejects every bad registration with the uniform 404', async () => {
    const noKey = await uploadPUT(
      event(putRequest({ blob: fixture.blob, registration: await mintRegistration() }))
    );
    expect(noKey.status).toBe(400);

    const used = (await issueChallenge(SECRET)).challenge;
    expect((await registrationUpload(await mintRegistration({ challenge: used }))).status).toBe(
      200
    );
    store.delete(await credentialIdHash()); // keep the challenge's single-use tombstone
    const cases: Array<[string, Promise<unknown>]> = [
      ['an assertion clientData type', mintRegistration({ type: 'webauthn.get' })],
      ['a reused challenge', mintRegistration({ challenge: used })],
      ['a forged challenge', mintRegistration({ challenge: 'AAAA' })],
      [
        'a different attested credential',
        mintRegistration({ attestedCredentialId: 'AAAAAAAAAAAAAAAAAAAAAA' })
      ],
      ['no UV', mintRegistration({ flags: 0x41 })],
      ['no AT (no attested credential data)', mintRegistration({ flags: 0x05 })],
      ['another rp id', mintRegistration({ rpIdHashFrom: new Uint8Array(32) })]
    ];
    for (const [label, reg] of cases) {
      const res = await registrationUpload(await reg);
      expect(res.status, label).toBe(404);
      expect(await res.json(), label).toEqual({ error: 'not_found' });
    }
    expect(store.has(await credentialIdHash())).toBe(false); // nothing stored
  });

  it('the first real assertion (fetch) confirms it: flag gone, full TTL', async () => {
    await registrationUpload(await mintRegistration());
    const res = await fetchPOST(
      event(
        new Request('https://zap.cooking/api/vault-sync/x', {
          method: 'POST',
          body: JSON.stringify({ assertion: await mintAssertion() })
        }),
        { credentialIdHash: await credentialIdHash() }
      )
    );
    expect(res.status).toBe(200);
    expect((await res.json()).blob).toBe(fixture.blob);
    const entry = await storedEntry();
    expect(entry.unconfirmed).toBeUndefined();
    expect(entry.ttl).toBe(370 * 24 * 60 * 60);
  });

  it('an assertion-backed upload replaces an unconfirmed entry whose registered key never verifies', async () => {
    // Registered with a key the credential doesn't actually sign with.
    const bogusSpki = fixture.spkiB64url.slice(0, -4) + 'AAAA';
    await registrationUpload(await mintRegistration(), bogusSpki);
    expect((await storedEntry()).credentialPublicKey).toBe(bogusSpki);

    const res = await uploadPUT(
      event(
        putRequest({
          blob: fixture.blob,
          spki: fixture.spkiB64url,
          alg: fixture.alg,
          assertion: await mintAssertion()
        })
      )
    );
    expect(res.status).toBe(200);
    const entry = await storedEntry();
    expect(entry.credentialPublicKey).toBe(fixture.spkiB64url);
    expect(entry.unconfirmed).toBeUndefined();
    expect(entry.ttl).toBe(370 * 24 * 60 * 60);
  });

  it('a confirmed entry still keeps its stored key against a submitted one', async () => {
    await registrationUpload(await mintRegistration());
    await fetchPOST(
      event(
        new Request('https://zap.cooking/api/vault-sync/x', {
          method: 'POST',
          body: JSON.stringify({ assertion: await mintAssertion() })
        }),
        { credentialIdHash: await credentialIdHash() }
      )
    ); // confirmed now
    const res = await uploadPUT(
      event(
        putRequest({
          blob: fixture.blob,
          spki: fixture.spkiB64url.slice(0, -4) + 'AAAA',
          alg: fixture.alg,
          assertion: await mintAssertion({ wrongKey: true })
        })
      )
    );
    expect(res.status).toBe(404);
    expect((await storedEntry()).credentialPublicKey).toBe(fixture.spkiB64url);
  });
});

describe('rate limiting', () => {
  it('fetch trips the per-hour bucket at 20', async () => {
    let last: Response | null = null;
    for (let i = 0; i < 21; i++) {
      last = await fetchPOST(
        event(new Request('https://zap.cooking', { method: 'POST', body: 'x' }), {
          credentialIdHash: 'ab'.repeat(32)
        })
      );
    }
    expect(last!.status).toBe(429);
    expect((await last!.json()).error).toBe('rate_limited');
  });
});

describe('never-log (R2)', () => {
  const spies: Array<ReturnType<typeof vi.spyOn>> = [];
  let captured: string[];

  beforeEach(() => {
    captured = [];
    for (const method of ['log', 'warn', 'error', 'info', 'debug'] as const) {
      spies.push(
        vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
          captured.push(args.map((a) => String(a)).join(' '));
        })
      );
    }
  });

  afterEach(() => {
    spies.forEach((s) => s.mockRestore());
    spies.length = 0;
  });

  it('no endpoint logs blob contents on success or failure', async () => {
    await uploadFixtureBlob();
    const key = await credentialIdHash();
    await fetchPOST(
      event(
        new Request('https://zap.cooking', {
          method: 'POST',
          body: JSON.stringify({ assertion: await mintAssertion() })
        }),
        { credentialIdHash: key }
      )
    );
    // Failures too — catch blocks must not console.error the body.
    await uploadPUT(
      event(
        putRequest({
          blob: fixture.blob,
          spki: fixture.spkiB64url,
          alg: fixture.alg,
          assertion: await mintAssertion({ wrongKey: true })
        })
      )
    );

    const ciphertextFragment = JSON.parse(fixture.blob).nsecCiphertext.slice(0, 24);
    const all = captured.join('\n');
    expect(all).not.toContain('nsecCiphertext');
    expect(all).not.toContain(ciphertextFragment);
    expect(all).not.toContain(fixture.blob.slice(0, 40));
  });
});
