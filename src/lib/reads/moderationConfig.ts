/**
 * Seed lists for Reads NSFW/spam moderation.
 *
 * These ship in the client bundle so the known spam account is blocked on
 * first paint, without waiting for KV. Cloudflare KV (GATED_CONTENT,
 * key `reads_mod_config`) overlays this at runtime so pubkeys, event ids,
 * naddrs, and denylist terms can be updated without a redeploy — see
 * `$lib/reads/moderation.server.ts` and `/admin/reads-moderation`.
 *
 * Until an admin saves an override, this file is the source of truth.
 */

export interface ReadsModerationLists {
	blockedPubkeys: string[];
	blockedEventIds: string[];
	blockedNaddrs: string[];
	denylist: string[];
}

/** Previously hardcoded in articleUtils — merchant-list / ATR spam. */
const LEGACY_FEED_SPAM_PUBKEY =
	'73d9e19ef07e0d098fc0fc5fb75db0f854824e8b4e43905acce638ddf6469960';

/**
 * NSFW cooking-tagged longform from a spam account promoting a porn site.
 * Title: "Mila Naturist Naked House Tour and Cooking Photos"
 * (and a second article, "dasha angel", from the same key).
 */
const NSFW_SPAM_PUBKEY = '16c0ebba83c6f31931a912cef8738e59318b5879c7d931af2a9c204f6bd79992';

const MILA_EVENT_ID = 'bf283bf0f9283b30a15c121b3065aefba4b8c45c46f44f516437bb419d556a8b';
const MILA_NADDR =
	'naddr1qvzqqqr4gupzq9kqawag83hnryc6jykwlpecukf33dv8n37exxhj48pqfa4a0xvjqqkxwctvd3jhy7fdvg6xvvpev5ck2tfcv43nqtf5xdjkzttpv9snvtfe8qekvcnp8q6nqwfe8qe902e5';

const DASHA_EVENT_ID = '07def0cdb0c8b03fa2be62de5bb15b953d9671af08fe23869de9f29e95837317';
const DASHA_NADDR =
	'naddr1qvzqqqr4gupzq9kqawag83hnryc6jykwlpecukf33dv8n37exxhj48pqfa4a0xvjqqkxwctvd3jhy7fdxd3rvc3hx43ngtf5xdskgtf5vcmnsttpxqerzttpx5ur2dp3vsex2epkxv56h064';

/**
 * NSFW / spam terms scanned against title, summary, first ~500 chars of
 * body, and hashtag tags. Whole-word / phrase match after normalization
 * (see `normalizeForScan`). "foodporn" is a legitimate food hashtag and
 * does not match `porn`.
 */
export const DEFAULT_READS_DENYLIST: readonly string[] = [
	'nudity',
	'nude',
	'naked',
	'naturist',
	'nudist',
	'porn',
	'porno',
	'xxx',
	'nsfw',
	'escort',
	'onlyfans',
	'only fans',
	'fansly',
	'big ass',
	'camgirl',
	'stripper',
	'erotic',
	'uncensored',
	'milf',
	'pornhub',
	'xvideos',
	'xhamster'
];

export const DEFAULT_READS_MODERATION: ReadsModerationLists = {
	blockedPubkeys: [NSFW_SPAM_PUBKEY, LEGACY_FEED_SPAM_PUBKEY],
	blockedEventIds: [MILA_EVENT_ID, DASHA_EVENT_ID],
	blockedNaddrs: [MILA_NADDR, DASHA_NADDR],
	denylist: [...DEFAULT_READS_DENYLIST]
};
