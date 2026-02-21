import type { PageServerLoad } from './$types';
import { nip19 } from 'nostr-tools';
import { redirect } from '@sveltejs/kit';

// Tracking parameters to strip
const TRACKING_PARAMS = [
	'fbclid', 'gclid', 'msclkid',
	'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
	'ref', 'source'
];

interface NoteMetadata {
	content: string;
	pubkey: string;
	created_at?: number;
}

interface ProfileMetadata {
	name?: string;
	display_name?: string;
}

const RELAYS = [
	'wss://relay.primal.net',
	'wss://relay.damus.io',
	'wss://nos.lol'
];

// Image detection patterns (matching NoteContent.svelte)
const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)(\?.*)?$/i;
const IMAGE_HOSTS = [
	'image.nostr.build',
	'nostr.build',
	'imgur.com',
	'imgproxy',
	'primal.b-cdn.net',
	'media.tenor.com',
	'i.ibb.co'
];

function extractFirstImageUrl(content: string): string | null {
	const urlRegex = /https?:\/\/[^\s<>"')\]]+/gi;
	const urls = content.match(urlRegex) || [];

	for (const url of urls) {
		try {
			const urlObj = new URL(url);
			if (IMAGE_EXTENSIONS.test(urlObj.pathname)) return url;
			if (IMAGE_HOSTS.some(host => urlObj.hostname.includes(host))) return url;
		} catch {
			continue;
		}
	}
	return null;
}

function cleanNoteContent(content: string): string {
	let text = content
		// Remove nostr: mentions
		.replace(/nostr:[a-z0-9]+/gi, '')
		// Remove image/video URLs
		.replace(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|svg|bmp|avif|mp4|webm|mov)(\?[^\s]*)?/gi, '')
		// Remove remaining standalone URLs
		.replace(/https?:\/\/[^\s]+/gi, '')
		// Collapse whitespace
		.replace(/\s+/g, ' ')
		.trim();

	if (text.length > 155) {
		const truncated = text.slice(0, 155);
		const lastSpace = truncated.lastIndexOf(' ');
		const lastSentence = Math.max(
			truncated.lastIndexOf('.'),
			truncated.lastIndexOf('!'),
			truncated.lastIndexOf('?')
		);
		if (lastSentence > 80) {
			return text.slice(0, lastSentence + 1);
		}
		return (lastSpace > 80 ? truncated.slice(0, lastSpace) : truncated) + '...';
	}

	return text || 'A note shared on zap.cooking';
}

function fetchNoteFromRelay(relayUrl: string, eventId: string): Promise<NoteMetadata | null> {
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

		const safeResolve = (value: NoteMetadata | null) => {
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

		const subId = `og-note-${Date.now()}`;

		ws.onopen = () => {
			if (!ws || resolved) return;
			try {
				ws.send(JSON.stringify([
					'REQ',
					subId,
					{ ids: [eventId], limit: 1 }
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
					clearTimeout(timeout);
					safeResolve({
						content: evt.content || '',
						pubkey: evt.pubkey || '',
						created_at: evt.created_at
					});
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
							display_name: profile.display_name || undefined
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

async function fetchNoteMetadata(eventId: string): Promise<NoteMetadata | null> {
	const results = await Promise.all(
		RELAYS.map(relay => fetchNoteFromRelay(relay, eventId))
	);
	return results.find(r => r !== null) || null;
}

async function fetchProfileMetadata(pubkey: string): Promise<ProfileMetadata | null> {
	const results = await Promise.all(
		RELAYS.map(relay => fetchProfileFromRelay(relay, pubkey))
	);
	return results.find(r => r !== null) || null;
}

function makeFallbackMeta() {
	return {
		title: 'Note - zap.cooking',
		description: 'A note shared on zap.cooking - Food. Friends. Freedom.',
		image: 'https://zap.cooking/social-share.png'
	};
}

export const prerender = false;

export const load: PageServerLoad = async ({ params, url }) => {
	const nip19Id = params.nip19;

	// Strip tracking parameters
	const hasTrackingParams = TRACKING_PARAMS.some(param => url.searchParams.has(param));
	if (hasTrackingParams) {
		throw redirect(301, `/${nip19Id}`);
	}

	// Only handle note1/nevent1 identifiers for OG tags
	if (!nip19Id?.startsWith('note1') && !nip19Id?.startsWith('nevent1')) {
		return { ogMeta: null };
	}

	if (typeof WebSocket === 'undefined') {
		return { ogMeta: makeFallbackMeta() };
	}

	try {
		const decoded = nip19.decode(nip19Id);
		let eventId = '';
		let hintPubkey = '';

		if (decoded.type === 'note') {
			eventId = (decoded.data as string);
		} else if (decoded.type === 'nevent') {
			const data = decoded.data as { id: string; author?: string };
			eventId = data.id;
			hintPubkey = data.author || '';
		} else {
			return { ogMeta: null };
		}

		// Fetch note with 5s overall timeout
		const notePromise = fetchNoteMetadata(eventId);
		const noteTimeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 5000));

		let note: NoteMetadata | null;
		let profile: ProfileMetadata | null = null;

		if (hintPubkey) {
			// nevent with author hint: fetch note and profile in parallel
			const profilePromise = fetchProfileMetadata(hintPubkey);
			const profileTimeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 3000));

			const [noteResult, profileResult] = await Promise.all([
				Promise.race([notePromise, noteTimeout]),
				Promise.race([profilePromise, profileTimeout])
			]);
			note = noteResult;
			profile = profileResult;
		} else {
			// note1: fetch note first, then profile
			note = await Promise.race([notePromise, noteTimeout]);

			if (note?.pubkey) {
				try {
					const profilePromise = fetchProfileMetadata(note.pubkey);
					const profileTimeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 3000));
					profile = await Promise.race([profilePromise, profileTimeout]);
				} catch {
					// Profile fetch failed, continue without it
				}
			}
		}

		if (!note) {
			return { ogMeta: makeFallbackMeta() };
		}

		const authorName = profile?.display_name || profile?.name || null;
		const title = authorName ? `${authorName} on zap.cooking` : 'Note on zap.cooking';
		const description = cleanNoteContent(note.content);
		const image = extractFirstImageUrl(note.content) || 'https://zap.cooking/social-share.png';

		return {
			ogMeta: {
				title,
				description,
				image,
				created_at: note.created_at,
				pubkey: note.pubkey
			}
		};
	} catch (e) {
		console.error('[OG Meta] Error:', e);
		return { ogMeta: makeFallbackMeta() };
	}
};
