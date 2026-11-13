import { json, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { checkMembership, normalizeMemberPubkey } from '$lib/membershipApi.server';
import { normalizeTier } from '$lib/membership/tier';
import type { ThemeUnlockStatus } from '$lib/themeUnlocks';
import { localAllowlistPubkeys, readSavedUnlocks, saveUnlocks, verifiedUnlocks } from '$lib/themeUnlocks.server';

/**
 * `THEME_UNLOCK_LOCAL_ADMINS` (npubs or hex, comma-separated) grants every
 * theme with no pantry check — but only while the app runs in dev mode
 * (`import.meta.env.DEV` is false in the production build), so the list can
 * never reach production regardless of what is in .env.local.
 */
const localAdmins = import.meta.env.DEV
  ? localAllowlistPubkeys(String(env.THEME_UNLOCK_LOCAL_ADMINS || ''))
  : new Set<string>();

/** Most receipts the client may hand over at once (it only sends fresh ones). */
const MAX_PROVIDED_RECEIPTS = 20;

/**
 * Founders (any membership status) and active members get every theme. An
 * unreachable pantry is not "no membership": the caller still gets its zap
 * unlocks and can ask again later.
 */
async function membershipUnlock(
  pubkey: string,
  platform: App.Platform | undefined
): Promise<Pick<ThemeUnlockStatus, 'all' | 'reason'>> {
  const enabled = String(platform?.env?.MEMBERSHIP_ENABLED || env.MEMBERSHIP_ENABLED || '').toLowerCase();
  const secret = platform?.env?.RELAY_API_SECRET || env.RELAY_API_SECRET;
  if (enabled !== 'true' || !secret) return { all: false };
  const check = await checkMembership(pubkey, secret);
  if (check.state === 'unknown' || !check.found) return { all: false };
  if (normalizeTier(check.member.tier, check.member.payment_id, 'member') === 'founders') {
    return { all: true, reason: 'founder' };
  }
  return check.state === 'active' ? { all: true, reason: 'member' } : { all: false };
}

async function status(
  pubkey: string,
  platform: App.Platform | undefined,
  provided?: readonly unknown[]
): Promise<ThemeUnlockStatus> {
  // Dev-only allowlist short-circuits before the pantry is asked at all.
  if (localAdmins.has(pubkey)) {
    return { all: true, reason: 'founder', unlocked: [] };
  }
  const kv = platform?.env?.GATED_CONTENT;
  const [membership, saved, verified] = await Promise.all([
    membershipUnlock(pubkey, platform),
    readSavedUnlocks(kv, pubkey),
    verifiedUnlocks(pubkey, provided).catch((err) => {
      console.warn('[api/themes/unlocks] receipt check failed', err);
      return [] as string[];
    })
  ]);
  const unlocked = await saveUnlocks(kv, pubkey, saved, verified);
  return { ...membership, unlocked };
}

/** GET ?pubkey=<hex>: the pubkey's unlocks, checking its receipts on public relays. */
export const GET: RequestHandler = async ({ url, platform }) => {
  const pubkey = normalizeMemberPubkey(url.searchParams.get('pubkey'));
  if (!pubkey) return json({ error: 'pubkey must be 64 hex characters' }, { status: 400 });
  return json(await status(pubkey, platform), { headers: { 'cache-control': 'no-store' } });
};

/**
 * POST { pubkey, receipts }: verify receipts the client just saw on its own
 * relays. A receipt only ever unlocks a theme for the user who signed the zap
 * request inside it, so anyone may submit one.
 */
export const POST: RequestHandler = async ({ request, platform }) => {
  let body: { pubkey?: unknown; receipts?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON' }, { status: 400 });
  }
  const pubkey = normalizeMemberPubkey(body.pubkey);
  if (!pubkey) return json({ error: 'pubkey must be 64 hex characters' }, { status: 400 });
  if (!Array.isArray(body.receipts) || body.receipts.length > MAX_PROVIDED_RECEIPTS) {
    return json({ error: `receipts must be an array of at most ${MAX_PROVIDED_RECEIPTS}` }, { status: 400 });
  }
  return json(await status(pubkey, platform, body.receipts), { headers: { 'cache-control': 'no-store' } });
};
