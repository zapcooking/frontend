/**
 * POST /api/vault-sync/challenge → { challenge, expiresAt }
 *
 * Stateless HMAC challenge issuance for vault-sync assertions (see
 * $lib/server/vaultSync/challenge.server.ts). Rate-limited per IP.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { issueChallenge } from '$lib/server/vaultSync/challenge.server';
import { getEnv } from '$lib/server/vaultSync/common.server';
import { checkPerIpRateLimit } from '$lib/ipRateLimit.server';

export const POST: RequestHandler = async ({ platform, getClientAddress }) => {
  const env = getEnv(platform);
  if (!env) return json({ error: 'not_configured' }, { status: 503 });

  const limited = await checkPerIpRateLimit(env.kv, {
    ip: getClientAddress(),
    scope: 'vault-sync-challenge',
    perHour: 30,
    perDay: 100
  });
  if (limited.limited) return json(limited.body, { status: 429 });

  return json(await issueChallenge(env.secret));
};
