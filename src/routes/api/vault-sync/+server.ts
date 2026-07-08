/**
 * PUT /api/vault-sync — upload or update a vault-sync blob.
 *
 * SINGLE upload path, always assertion-gated (Gate 2 ruling: no
 * assertion-less PUT variant). First upload (no KV entry) is
 * TOFU-hardened: the assertion is verified against the SUBMITTED SPKI, so
 * even registration proves live possession of the credential's private
 * key. Updates verify against the STORED SPKI — an entry's public key is
 * never overwritten.
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
  isAssertionBody
} from '$lib/server/vaultSync/common.server';
import { b64urlToBytes } from '$lib/server/vaultSync/webauthn.server';
import {
  validateBlob,
  MAX_BLOB_BYTES,
  ENTRY_TTL_S,
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
  if (typeof body?.blob !== 'string' || !isAssertionBody(body?.assertion)) {
    return json({ error: 'bad_request' }, { status: 400 });
  }
  // Size gate before any crypto — cheap rejection for oversized payloads.
  if (new TextEncoder().encode(body.blob).length > MAX_BLOB_BYTES) {
    return json({ error: 'too_large' }, { status: 413 });
  }

  try {
    const credentialId: string = body.assertion.credentialId;
    const kvKey = await sha256Hex(b64urlToBytes(credentialId));
    const existing = (await env.kv.get(kvKey, 'json')) as VaultSyncEntry | null;

    let spki: string;
    let alg: number;
    if (existing) {
      // Update: stored key wins; submitted spki (if any) is ignored.
      spki = existing.credentialPublicKey;
      alg = existing.alg;
    } else {
      // TOFU first upload: SPKI + alg required, assertion must verify
      // against exactly what is being registered.
      if (typeof body.spki !== 'string' || (body.alg !== -7 && body.alg !== -257)) {
        return json({ error: 'bad_request' }, { status: 400 });
      }
      spki = body.spki;
      alg = body.alg;
    }

    const verified = await checkAssertion(env, body.assertion, spki, alg);
    validateBlob(body.blob, credentialId);

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
