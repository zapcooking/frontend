import { get } from 'svelte/store';
import { ndk } from '$lib/nostr';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import { outboxRelaySet } from '$lib/outboxPublish';
import { addClientTagToEvent } from '$lib/nip89';

/**
 * NIP-89 handler headlight for Zap Cooking.
 *
 * Our events carry a `client` tag pointing at a `31990:<pubkey>:zap-cooking`
 * handler address — but until now nothing published the kind-31990 event
 * that address refers to, so NIP-89-aware clients rendering our shared
 * naddr embeds could show the name only from the tag. Publishing the
 * headlight (name, logo, about, web action, supported kinds) lets those
 * clients brand the embed with our logo and an "open in Zap Cooking"
 * action, per spec. The picture is the white ZAP.COOKING wordmark — this
 * handler exists primarily so OTHER apps can identify and mark our shared
 * naddr embeds.
 *
 * One replaceable event per pubkey, one publish attempt per session —
 * a failure (signer denied, relays down) stays quiet and retries on the
 * next login, never blocking the login path.
 */

const HANDLER_D = 'zap-cooking';
const LOGO_URL = 'https://zap.cooking/zapcooking-text-dark.svg';
const HANDLER_ABOUT =
	'Share recipes with photos, cook along with the community, and zap cooks in bitcoin.';

let attempted = false;

export async function ensureHandlerHeadlight(): Promise<void> {
	if (attempted) return;
	const ndkInstance = get(ndk);
	if (!ndkInstance) return;
	attempted = true; // one attempt per session, success or not

	try {
		const event = new NDKEvent(ndkInstance);
		event.kind = 31990;
		event.tags = [
			['d', HANDLER_D],
			['name', 'Zap Cooking'],
			['picture', LOGO_URL],
			['about', HANDLER_ABOUT],
			['web', 'https://zap.cooking'],
			// Kinds this handler can open: recipes/articles (longform) and polls.
			['k', '30023'],
			['k', '1068']
		];
		addClientTagToEvent(event);
		await event.publish(await outboxRelaySet(event, 'list'));
	} catch (error) {
		console.warn('[NIP-89] handler headlight publish failed:', error);
	}
}
