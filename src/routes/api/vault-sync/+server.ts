/**
 * PUT /api/vault-sync — upload or update a vault-sync blob.
 *
 * Assertion-gated, with one exception. An assertion-backed first upload (no
 * KV entry) is TOFU-hardened: the assertion is verified against the
 * SUBMITTED SPKI, so even the first upload proves live possession of the
 * credential's private key. Updates verify against the STORED SPKI — a
 * confirmed entry's public key is never overwritten.
 *
 * The exception (PR B, one-prompt signup): a FIRST upload may instead carry
 * the registration (create()) response over a server challenge, because no
 * assertion exists yet. This is NOT authentication: passkeys use "none"
 * attestation, so every field checked (challenge, origin, rpIdHash, flags,
 * attested credential id) is unsigned, and anyone can forge a passing
 * registration with no authenticator and no keypair — only a fresh
 * challenge. The entry is therefore stored UNCONFIRMED with a short TTL,
 * registration uploads get their own tighter per-IP bucket (the only real
 * control on volume), and a registration never touches an existing entry.
 *
 * Only an assertion that verifies against an entry's STORED key confirms
 * it (fetch, refresh, or an upload). An assertion-backed upload with a
 * different, submitted key may REPLACE an unconfirmed entry — that fixes
 * one whose registered key never verifies — but the replacement stays
 * unconfirmed (short TTL) until an assertion verifies against it. Someone
 * who knows the credential id can still replace an unconfirmed entry and
 * then confirm it with their own key: the protection there is that
 * credential ids never leave the client except to this server.
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
  checkAssertionAgainst,
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
      const registerLimited = await checkPerIpRateLimit(env.kv, {
        ip: getClientAddress(),
        scope: 'vault-sync-register',
        perHour: 5,
        perDay: 20
      });
      if (registerLimited.limited) return json(registerLimited.body, { status: 429 });
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
      return json({ ok: true, unconfirmed: true });
    }

    // Candidate keys, in order. Confirmed entry: its stored key only (a
    // submitted spki is ignored). Unconfirmed entry: its stored key (which
    // confirms it), then a submitted replacement. No entry: TOFU against the
    // submitted key, which must be present.
    const candidates: Array<{ spki: string; alg: number }> = [];
    if (existing) {
      candidates.push({ spki: existing.credentialPublicKey, alg: existing.alg });
      if (existing.unconfirmed && submittedKey) candidates.push({ spki: body.spki, alg: body.alg });
    } else {
      if (!submittedKey) return json({ error: 'bad_request' }, { status: 400 });
      candidates.push({ spki: body.spki, alg: body.alg });
    }

    const { verified, index } = await checkAssertionAgainst(env, body.assertion, candidates);
    validateBlob(body.blob, credentialId);

    // Replacing an unconfirmed entry's key (index 1) keeps it unconfirmed:
    // only an assertion verifying against the STORED key confirms.
    const unconfirmed = !!existing && index === 1;
    const entry: VaultSyncEntry = {
      version: 1,
      blob: body.blob,
      credentialPublicKey: candidates[index].spki,
      alg: candidates[index].alg,
      signCount: verified.signCount,
      updatedAt: Date.now(),
      ...(unconfirmed ? { unconfirmed: true as const } : {})
    };
    await env.kv.put(kvKey, JSON.stringify(entry), {
      expirationTtl: unconfirmed ? UNCONFIRMED_TTL_S : ENTRY_TTL_S
    });
    return json({ ok: true, unconfirmed });
  } catch {
    // Auth-shaped or shape-validation failure — uniform, no detail, no logs.
    return uniform404();
  }
};
