import type { PageServerLoad } from './$types';
import { nip19 } from 'nostr-tools';

interface ProfileMetadata {
	name?: string;
	display_name?: string;
	picture?: string;
	about?: string;
}

const RELAYS = [
	'wss://relay.primal.net',
	'wss://relay.damus.io',
	'wss://nos.lol'
];

function fetchProfileFromRelay(relayUrl: string, pubkey: string): Promise<ProfileMetadata | null> {
	if (typeof WebSocket === 'undefined') {
		return Promise.resolve(null);
	}

	return new Promise((resolve) => {
		let ws: WebSocket | null = null;
		let resolved = false;

		const cleanup = () => {
			if (ws && ws.readyState === WebSocket.OPEN) {
				try { ws.close(); } catch { /* ignore */ }
			}
		};

		const safeResolve = (value: ProfileMetadata | null) => {
			if (!resolved) {
				resolved = true;
				cleanup();
				resolve(value);
			}
		};

		const timeout = setTimeout(() => {
			safeResolve(null);
		}, 3000);

		try {
			ws = new WebSocket(relayUrl);
		} catch {
			clearTimeout(timeout);
			safeResolve(null);
			return;
		}

		const subId = `og-kitchen-${Date.now()}`;

		ws.onopen = () => {
			if (!ws || resolved) return;
			try {
				ws.send(JSON.stringify([
					'REQ',
					subId,
					{ kinds: [0], authors: [pubkey], limit: 1 }
				]));
			} catch {
				clearTimeout(timeout);
				safeResolve(null);
			}
		};

		ws.onmessage = (event) => {
			if (!ws || resolved) return;
			try {
				const msg = JSON.parse(event.data);
				if (msg[0] === 'EVENT' && msg[1] === subId && msg[2]) {
					const evt = msg[2];
					try {
						const profile = JSON.parse(evt.content);
						clearTimeout(timeout);
						safeResolve({
							name: profile.name || undefined,
							display_name: profile.display_name || undefined,
							picture: profile.picture || undefined,
							about: profile.about || undefined
						});
					} catch {
						clearTimeout(timeout);
						safeResolve(null);
					}
				} else if (msg[0] === 'EOSE' && msg[1] === subId) {
					clearTimeout(timeout);
					safeResolve(null);
				}
			} catch {
				// Parse error, ignore
			}
		};

		ws.onerror = () => {
			clearTimeout(timeout);
			safeResolve(null);
		};

		ws.onclose = () => {
			clearTimeout(timeout);
			if (!resolved) {
				safeResolve(null);
			}
		};
	});
}

async function fetchProfile(pubkey: string): Promise<ProfileMetadata | null> {
	const results = await Promise.all(
		RELAYS.map(relay => fetchProfileFromRelay(relay, pubkey))
	);
	return results.find(r => r !== null) || null;
}

function cleanBio(about: string): string {
	let text = about
		.replace(/nostr:[a-z0-9]+/gi, '')
		.replace(/https?:\/\/[^\s]+/gi, '')
		.replace(/\s+/g, ' ')
		.trim();

	if (text.length > 155) {
		const truncated = text.slice(0, 155);
		const lastSpace = truncated.lastIndexOf(' ');
		return (lastSpace > 80 ? truncated.slice(0, lastSpace) : truncated) + '...';
	}

	return text;
}

export const prerender = false;

export const load: PageServerLoad = async ({ params }) => {
	const npub = params.npub;
	if (!npub) return { ogMeta: null };

	let pubkey = '';

	try {
		if (npub.startsWith('npub1')) {
			const decoded = nip19.decode(npub);
			if (decoded.type === 'npub') pubkey = decoded.data as string;
		} else if (/^[0-9a-f]{64}$/.test(npub)) {
			pubkey = npub;
		}
	} catch {
		return { ogMeta: null };
	}

	if (!pubkey) return { ogMeta: null };

	if (typeof WebSocket === 'undefined') {
		return {
			ogMeta: {
				title: 'Store - zap.cooking Marketplace',
				description: 'A store on the zap.cooking marketplace.',
				image: 'https://zap.cooking/social-share.png'
			}
		};
	}

	try {
		const profilePromise = fetchProfile(pubkey);
		const profileTimeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 5000));
		const profile = await Promise.race([profilePromise, profileTimeout]);

		const displayName = profile?.display_name || profile?.name || null;
		const title = displayName ? `${displayName}'s Store - zap.cooking` : 'Store - zap.cooking Marketplace';

		let description = 'A store on the zap.cooking marketplace.';
		if (profile?.about) {
			const cleaned = cleanBio(profile.about);
			if (cleaned) description = cleaned;
		}

		const image = profile?.picture || 'https://zap.cooking/social-share.png';

		return {
			ogMeta: { title, description, image }
		};
	} catch (e) {
		console.error('[OG Meta] Kitchen profile error:', e);
		return { ogMeta: null };
	}
};
