/**
 * POST /api/vault-sync/:credentialIdHash → { blob }   (assertion-gated fetch)
 * DELETE /api/vault-sync/:credentialIdHash            (assertion-gated, idempotent)
 *
 * Fetch uses POST so the assertion travels in the body, never in URLs or
 * access logs. The path param must equal sha256(assertion.credentialId) —
 * an assertion can only ever address its own entry.
 *
 * Why assertion-gated at all: the blob is ciphertext, but a provider-
 * account compromise yields the synced passkey; a freely fetchable blob
 * would hand such an attacker both halves. Requiring a live verified
 * ceremony makes blob retrieval demand the same act that produces the PRF
 * (Phase 1 security-review ruling).
 *
 * On success, fetch refreshes the entry TTL by rewriting it (KV has no
 * touch primitive) — R4: entries live ~12 months past last use; expiry
 * costs sync only, never identity (next nsec login re-uploads).
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  getEnv,
  uniform404,
  sha256Hex,
  checkAssertion,
  isAssertionBody,
  type VaultSyncEnv
} from '$lib/server/vaultSync/common.server';
import { b64urlToBytes } from '$lib/server/vaultSync/webauthn.server';
import { ENTRY_TTL_S, type VaultSyncEntry } from '$lib/server/vaultSync/blob.server';
import { checkPerIpRateLimit } from '$lib/ipRateLimit.server';

interface VerifiedRequest {
  env: VaultSyncEnv;
  kvKey: string;
  entry: VaultSyncEntry;
  signCount: number;
}

/**
 * Shared verification for fetch and delete. Returns null for anything
 * auth-shaped (caller responds uniform404). Throws nothing.
 *
 * An ABSENT entry is also null: with no stored public key the assertion is
 * unverifiable, and any non-404 response for absent keys would be an
 * existence oracle — a garbage assertion would get 200 for absent hashes
 * and 404 for present ones. DELETE idempotency therefore lives client-side
 * (a 404 on DELETE means "desired state holds"); see the PR notes for the
 * rulings-conflict flag on this point.
 */
async function verifyRequest(
  request: Request,
  platform: App.Platform | undefined,
  paramHash: string
): Promise<VerifiedRequest | 'bad_request' | null> {
  const env = getEnv(platform);
  if (!env) return null;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return 'bad_request';
  }
  if (!isAssertionBody(body?.assertion)) return 'bad_request';

  try {
    const kvKey = await sha256Hex(b64urlToBytes(body.assertion.credentialId));
    // The addressed entry must be the asserting credential's own.
    if (kvKey !== paramHash.toLowerCase()) return null;

    const entry = (await env.kv.get(kvKey, 'json')) as VaultSyncEntry | null;
    if (!entry) return null;
    const verified = await checkAssertion(
      env,
      body.assertion,
      entry.credentialPublicKey,
      entry.alg
    );
    return { env, kvKey, entry, signCount: verified.signCount };
  } catch {
    return null;
  }
}

export const POST: RequestHandler = async ({ request, platform, params, getClientAddress }) => {
  const env = getEnv(platform);
  if (!env) return json({ error: 'not_configured' }, { status: 503 });

  // Fetch is the abuse target (Gate 2 addition 1) — tightest bucket.
  const limited = await checkPerIpRateLimit(env.kv, {
    ip: getClientAddress(),
    scope: 'vault-sync-fetch',
    perHour: 20,
    perDay: 60
  });
  if (limited.limited) return json(limited.body, { status: 429 });

  const result = await verifyRequest(request, platform, params.credentialIdHash);
  if (result === 'bad_request') return json({ error: 'bad_request' }, { status: 400 });
  if (!result) return uniform404();

  // TTL refresh on successful fetch (R4). Also records last-seen signCount
  // — stored only, never enforced: synced passkeys report 0 / regress by
  // design (Gate 2 addition 4).
  const refreshed: VaultSyncEntry = {
    ...result.entry,
    signCount: result.signCount,
    updatedAt: Date.now()
  };
  await result.env.kv.put(result.kvKey, JSON.stringify(refreshed), {
    expirationTtl: ENTRY_TTL_S
  });

  return json({ blob: result.entry.blob });
};

export const DELETE: RequestHandler = async ({ request, platform, params, getClientAddress }) => {
  const env = getEnv(platform);
  if (!env) return json({ error: 'not_configured' }, { status: 503 });

  const limited = await checkPerIpRateLimit(env.kv, {
    ip: getClientAddress(),
    scope: 'vault-sync-delete',
    perHour: 10,
    perDay: 30
  });
  if (limited.limited) return json(limited.body, { status: 429 });

  const result = await verifyRequest(request, platform, params.credentialIdHash);
  if (result === 'bad_request') return json({ error: 'bad_request' }, { status: 400 });
  if (!result) return uniform404();

  await result.env.kv.delete(result.kvKey);
  return json({ ok: true });
};
