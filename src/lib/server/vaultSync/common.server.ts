/**
 * Shared plumbing for the vault-sync routes: uniform failure response,
 * assertion body decoding, KV key derivation.
 */

import { json } from '@sveltejs/kit';
import { b64urlToBytes, verifyAssertion, type VerifiedAssertion } from './webauthn.server';
import { redeemChallenge } from './challenge.server';

/**
 * Every auth-shaped failure returns EXACTLY this (pinned by tests): an
 * attacker must not be able to distinguish "no such blob" from "bad
 * signature" from "expired challenge" (no oracle — Gate 2 ruling).
 */
export function uniform404() {
  return json({ error: 'not_found' }, { status: 404 });
}

export type VaultSyncKV = {
  get(key: string, type?: 'text' | 'json'): Promise<string | unknown | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
};

export interface VaultSyncEnv {
  kv: VaultSyncKV;
  secret: string;
}

/** Missing bindings are a server misconfiguration, not an auth failure. */
export function getEnv(platform: App.Platform | undefined): VaultSyncEnv | null {
  const kv = platform?.env?.VAULT_SYNC;
  const secret = platform?.env?.VAULT_SYNC_CHALLENGE_SECRET;
  if (!kv || !secret) return null;
  return { kv: kv as VaultSyncKV, secret };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  return Array.from(digest)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Wire shape of an assertion in request bodies (all base64url). */
export interface AssertionBody {
  credentialId: string;
  signature: string;
  authenticatorData: string;
  clientDataJSON: string;
}

export function isAssertionBody(a: any): a is AssertionBody {
  return (
    !!a &&
    typeof a.credentialId === 'string' &&
    typeof a.signature === 'string' &&
    typeof a.authenticatorData === 'string' &&
    typeof a.clientDataJSON === 'string'
  );
}

/**
 * Full assertion check: challenge extraction + redemption, then WebAuthn
 * verification against the given SPKI. Throws on any failure — callers
 * catch and return uniform404().
 */
export async function checkAssertion(
  env: VaultSyncEnv,
  assertion: AssertionBody,
  spkiB64url: string,
  alg: number
): Promise<VerifiedAssertion> {
  const clientDataJSON = b64urlToBytes(assertion.clientDataJSON);
  // The challenge lives inside clientDataJSON; redeem it BEFORE signature
  // work so a replayed challenge is rejected as cheaply as possible.
  let challenge: string;
  try {
    challenge = JSON.parse(new TextDecoder().decode(clientDataJSON)).challenge;
  } catch {
    throw new Error('clientDataJSON unparseable');
  }
  if (typeof challenge !== 'string') throw new Error('no challenge in clientDataJSON');
  await redeemChallenge(env.kv, env.secret, challenge);

  return verifyAssertion(
    {
      signature: b64urlToBytes(assertion.signature),
      authenticatorData: b64urlToBytes(assertion.authenticatorData),
      clientDataJSON
    },
    b64urlToBytes(spkiB64url),
    alg,
    challenge
  );
}
