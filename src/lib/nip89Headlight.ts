import { CLIENT_TAG_IDENTIFIER } from './consts';
import { HANDLER_D } from './nip89';

/**
 * NIP-89 handler headlight for Zap Cooking: the kind-31990 event that the
 * address in our `client` tags (ZAP_COOKING_HANDLER_ADDRESS) refers to.
 * NIP-89-aware clients rendering our shared embeds read it to show the
 * Zap Cooking name and logo and an "open in Zap Cooking" action.
 *
 * Published ONCE, by the org account (ORG_PUBKEY), not by users: run
 * `npx tsx scripts/nip89-handler-event.ts` and sign the printed event with
 * the org key. Re-publish after changing anything here (it's replaceable,
 * d=zap-cooking).
 *
 * Per NIP-89 the app metadata is kind-0-style JSON in `content`; without
 * it, clients fall back to the publisher's profile. Each `web` tag is a
 * URL template whose `<bech32>` the client fills with the entity it opens.
 */

const LOGO_URL = 'https://zap.cooking/zapcooking-text-dark.svg';
const HANDLER_ABOUT =
	'Share recipes with photos, cook along with the community, and zap cooks in bitcoin.';

export interface HandlerHeadlight {
	kind: 31990;
	content: string;
	tags: string[][];
}

export function buildHandlerHeadlight(): HandlerHeadlight {
	return {
		kind: 31990,
		content: JSON.stringify({
			name: CLIENT_TAG_IDENTIFIER,
			display_name: CLIENT_TAG_IDENTIFIER,
			picture: LOGO_URL,
			about: HANDLER_ABOUT,
			website: 'https://zap.cooking'
		}),
		tags: [
			['d', HANDLER_D],
			// Recipes and articles (longform, addressable): /recipe/<naddr>.
			['web', 'https://zap.cooking/recipe/<bech32>', 'naddr'],
			// Polls (regular events): the root event route renders them.
			['web', 'https://zap.cooking/<bech32>', 'nevent'],
			['k', '30023'],
			['k', '1068']
		]
	};
}
