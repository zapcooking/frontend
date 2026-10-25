/**
 * PUT /api/vault-sync — upload or update a vault-sync blob.
 *
 * Assertion-gated, with one exception. First upload (no KV entry) is
 * TOFU-hardened: the assertion is verified against the SUBMITTED SPKI, so
 * even registration proves live possession of the credential's private
 * key. Updates verify against the STORED SPKI — an entry's public key is
 * never overwritten once confirmed.
 *
 * The exception (PR B, one-prompt signup): a FIRST upload may instead carry
 * the registration (create()) response over a server challenge. That can't
 * prove key possession (passkeys use "none" attestation), so the entry is
 * stored UNCONFIRMED with a short TTL. The first verified assertion — fetch,
 * refresh, or an assertion-backed upload — confirms it. An unconfirmed
 * entry may be replaced by an assertion-backed upload (TOFU against the
 * submitted SPKI), which fixes an entry whose registered key never verifies.
 * A registration never touches an existing entry.
 *
 * Privacy (R2 ruling): KV is keyed by sha256(credentialId) only; the
 * pubkey↔credentialId linkage exists only inside the opaque value; request
 * bodies and blob contents are never logged (pinned by test).
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  getEnv,
  uniform404,
  sha256Hex,
  checkAssertion,
  isAssertionBody,
  checkRegistration,
  isRegistrationBody
} from '$lib/server/vaultSync/common.server';
import { b64urlToBytes } from '$lib/server/vaultSync/webauthn.server';
import {
  validateBlob,
  MAX_BLOB_BYTES,
  ENTRY_TTL_S,
  UNCONFIRMED_TTL_S,
  type VaultSyncEntry
} from '$lib/server/vaultSync/blob.server';
import { checkPerIpRateLimit } from '$lib/ipRateLimit.server';

export const PUT: RequestHandler = async ({ request, platform, getClientAddress }) => {
  const env = getEnv(platform);
  if (!env) return json({ error: 'not_configured' }, { status: 503 });

  const limited = await checkPerIpRateLimit(env.kv, {
    ip: getClientAddress(),
    scope: 'vault-sync-upload',
    perHour: 10,
    perDay: 40
  });
  if (limited.limited) return json(limited.body, { status: 429 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, { status: 400 });
  }
  const viaAssertion = isAssertionBody(body?.assertion);
  const viaRegistration = !viaAssertion && isRegistrationBody(body?.registration);
  if (typeof body?.blob !== 'string' || (!viaAssertion && !viaRegistration)) {
    return json({ error: 'bad_request' }, { status: 400 });
  }
  // Size gate before any crypto — cheap rejection for oversized payloads.
  if (new TextEncoder().encode(body.blob).length > MAX_BLOB_BYTES) {
    return json({ error: 'too_large' }, { status: 413 });
  }

  const submittedKey = typeof body.spki === 'string' && (body.alg === -7 || body.alg === -257);

  try {
    const credentialId: string = (viaAssertion ? body.assertion : body.registration).credentialId;
    const kvKey = await sha256Hex(b64urlToBytes(credentialId));
    const existing = (await env.kv.get(kvKey, 'json')) as VaultSyncEntry | null;

    if (viaRegistration) {
      // Registration only ever creates an entry, unconfirmed.
      if (existing) return uniform404();
      if (!submittedKey) return json({ error: 'bad_request' }, { status: 400 });
      const verified = await checkRegistration(env, body.registration);
      validateBlob(body.blob, credentialId);
      const entry: VaultSyncEntry = {
        version: 1,
        blob: body.blob,
        credentialPublicKey: body.spki,
        alg: body.alg,
        signCount: verified.signCount,
        updatedAt: Date.now(),
        unconfirmed: true
      };
      await env.kv.put(kvKey, JSON.stringify(entry), { expirationTtl: UNCONFIRMED_TTL_S });
      return json({ ok: true });
    }

    let spki: string;
    let alg: number;
    if (existing && !(existing.unconfirmed && submittedKey)) {
      // Update: stored key wins; submitted spki (if any) is ignored. (An
      // unconfirmed entry without a submitted key verifies against its
      // stored one — which confirms it.)
      spki = existing.credentialPublicKey;
      alg = existing.alg;
    } else {
      // TOFU first upload, or replacing an UNCONFIRMED entry: SPKI + alg
      // required, assertion must verify against exactly what is submitted.
      if (!submittedKey) {
        return json({ error: 'bad_request' }, { status: 400 });
      }
      spki = body.spki;
      alg = body.alg;
    }

    const verified = await checkAssertion(env, body.assertion, spki, alg);
    validateBlob(body.blob, credentialId);

    // A verified assertion: the stored entry is confirmed.
    const entry: VaultSyncEntry = {
      version: 1,
      blob: body.blob,
      credentialPublicKey: spki,
      alg,
      signCount: verified.signCount,
      updatedAt: Date.now()
    };
    await env.kv.put(kvKey, JSON.stringify(entry), { expirationTtl: ENTRY_TTL_S });
    return json({ ok: true });
  } catch {
    // Auth-shaped or shape-validation failure — uniform, no detail, no logs.
    return uniform404();
  }
};
