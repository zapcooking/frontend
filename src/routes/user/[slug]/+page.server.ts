import type { PageServerLoad } from './$types';
import { nip19 } from 'nostr-tools';

interface ProfileMetadata {
	name?: string;
	display_name?: string;
	picture?: string;
	about?: string;
	nip05?: string;
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

		const subId = `og-profile-${Date.now()}`;

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
							about: profile.about || undefined,
							nip05: profile.nip05 || undefined
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
		// Strip nostr: references
		.replace(/nostr:[a-z0-9]+/gi, '')
		// Strip URLs
		.replace(/https?:\/\/[^\s]+/gi, '')
		// Collapse whitespace
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
	const slug = params.slug;
	if (!slug) return { ogMeta: null };

	let pubkey = '';

	try {
		if (slug.startsWith('npub1')) {
			const decoded = nip19.decode(slug);
			if (decoded.type === 'npub') pubkey = decoded.data as string;
		} else if (slug.startsWith('nprofile1')) {
			const decoded = nip19.decode(slug);
			if (decoded.type === 'nprofile') pubkey = (decoded.data as { pubkey: string }).pubkey;
		} else if (/^[0-9a-f]{64}$/.test(slug)) {
			pubkey = slug;
		}
	} catch {
		return { ogMeta: null };
	}

	if (!pubkey) return { ogMeta: null };

	if (typeof WebSocket === 'undefined') {
		return {
			ogMeta: {
				title: 'User Profile - zap.cooking',
				description: 'A user on zap.cooking - Food. Friends. Freedom.',
				image: 'https://zap.cooking/social-share.png'
			}
		};
	}

	try {
		const profilePromise = fetchProfile(pubkey);
		const profileTimeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 5000));
		const profile = await Promise.race([profilePromise, profileTimeout]);

		const displayName = profile?.display_name || profile?.name || null;
		const title = displayName ? `${displayName} on zap.cooking` : 'User Profile - zap.cooking';

		let description = 'A user on zap.cooking - Food. Friends. Freedom.';
		if (profile?.about) {
			const cleaned = cleanBio(profile.about);
			if (cleaned) description = cleaned;
		}

		const image = profile?.picture || 'https://zap.cooking/social-share.png';

		return {
			ogMeta: { title, description, image }
		};
	} catch (e) {
		console.error('[OG Meta] User profile error:', e);
		return { ogMeta: null };
	}
};
