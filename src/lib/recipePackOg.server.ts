/**
 * Server-only helpers for Recipe Pack Open Graph rendering.
 *
 * Fetches kind 30004 packs (and optionally a few referenced recipes for
 * collage / preview names) directly from relays via raw WebSocket — no
 * NDK on the server. Mirrors the pattern used in
 * `/r/[naddr]/+page.server.ts` so we get fast, dependency-free SSR for
 * OG meta and the card image generator.
 */

const RELAYS = [
	'wss://garden.zap.cooking',
	'wss://relay.primal.net',
	'wss://relay.damus.io',
	'wss://nos.lol'
];

const FETCH_TIMEOUT_MS = 3500;

export interface PackMetadata {
	title: string;
	description: string;
	image: string;
	creatorPubkey: string;
	recipeATags: string[];
	recipeCount: number;
}

export interface RecipePreview {
	id: string; // a-tag
	title: string;
	image?: string;
}

/**
 * One-shot raw-WebSocket fetch for a single replaceable event (kind +
 * pubkey + d-tag). Returns the matching event JSON or null on
 * timeout / failure / EOSE-without-event.
 */
function fetchEventFromRelay(
	relayUrl: string,
	filter: { kinds: number[]; authors: string[]; '#d': string[] }
): Promise<any | null> {
	if (typeof WebSocket === 'undefined') return Promise.resolve(null);

	return new Promise((resolve) => {
		let ws: WebSocket | null = null;
		let resolved = false;

		const cleanup = () => {
			if (ws && ws.readyState === WebSocket.OPEN) {
				try {
					ws.close();
				} catch {
					/* ignore */
				}
			}
		};
		const safeResolve = (value: any | null) => {
			if (resolved) return;
			resolved = true;
			cleanup();
			resolve(value);
		};
		const timeout = setTimeout(() => safeResolve(null), FETCH_TIMEOUT_MS);

		try {
			ws = new WebSocket(relayUrl);
		} catch {
			clearTimeout(timeout);
			safeResolve(null);
			return;
		}

		const subId = `og-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

		ws.onopen = () => {
			if (!ws || resolved) return;
			try {
				ws.send(JSON.stringify(['REQ', subId, { ...filter, limit: 1 }]));
			} catch {
				clearTimeout(timeout);
				safeResolve(null);
			}
		};

		ws.onmessage = (msgEvent) => {
			if (!ws || resolved) return;
			try {
				const msg = JSON.parse((msgEvent as MessageEvent).data);
				if (msg[0] === 'EVENT' && msg[1] === subId && msg[2]) {
					clearTimeout(timeout);
					safeResolve(msg[2]);
				} else if (msg[0] === 'EOSE' && msg[1] === subId) {
					clearTimeout(timeout);
					safeResolve(null);
				}
			} catch {
				/* parse error — wait for next */
			}
		};

		ws.onerror = () => {
			clearTimeout(timeout);
			safeResolve(null);
		};
		ws.onclose = () => {
			clearTimeout(timeout);
			if (!resolved) safeResolve(null);
		};
	});
}

/** Fetch the same filter against multiple relays in parallel; return the first hit. */
async function raceRelays(filter: {
	kinds: number[];
	authors: string[];
	'#d': string[];
}): Promise<any | null> {
	if (typeof WebSocket === 'undefined') return null;
	const results = await Promise.all(RELAYS.map((r) => fetchEventFromRelay(r, filter)));
	return results.find((r) => r !== null) || null;
}

/**
 * Fetch a Recipe Pack (kind 30004) by author + d-tag and shape the
 * result into PackMetadata. Returns null if the event can't be found.
 */
export async function fetchPackMetadata(
	pubkey: string,
	dTag: string,
	kind: number
): Promise<PackMetadata | null> {
	const evt = await raceRelays({ kinds: [kind], authors: [pubkey], '#d': [dTag] });
	if (!evt) return null;

	const tags: string[][] = Array.isArray(evt.tags) ? evt.tags : [];
	const find = (name: string) => tags.find((t) => t[0] === name)?.[1];

	const title = find('title') || find('d') || '';
	const description = find('description') || '';
	const image = find('image') || '';
	const recipeATags = tags.filter((t) => t[0] === 'a' && typeof t[1] === 'string').map((t) => t[1]);

	return {
		title,
		description,
		image,
		creatorPubkey: typeof evt.pubkey === 'string' ? evt.pubkey : pubkey,
		recipeATags,
		recipeCount: recipeATags.length
	};
}

/**
 * Fetch the first N recipes from a list of a-tags. Used to build a
 * fallback collage / preview-name list when the pack itself has no
 * cover image. Failures per-recipe are tolerated — we return whatever
 * came back.
 */
export async function fetchRecipePreviews(
	aTags: string[],
	limit: number = 4
): Promise<RecipePreview[]> {
	const targets = aTags.slice(0, limit);
	const results = await Promise.all(
		targets.map(async (aTag): Promise<RecipePreview | null> => {
			const parts = aTag.split(':');
			if (parts.length !== 3) return null;
			const [kindStr, pubkey, dTag] = parts;
			const kindNum = Number(kindStr);
			if (!Number.isFinite(kindNum) || !pubkey || !dTag) return null;
			const evt = await raceRelays({ kinds: [kindNum], authors: [pubkey], '#d': [dTag] });
			if (!evt) return null;
			const tags: string[][] = Array.isArray(evt.tags) ? evt.tags : [];
			const title = tags.find((t) => t[0] === 'title')?.[1] || dTag;
			const image = tags.find((t) => t[0] === 'image')?.[1];
			return { id: aTag, title, image };
		})
	);
	return results.filter((r): r is RecipePreview => r !== null);
}

/**
 * Fetch a NIP-01 kind:0 metadata event for a pubkey to resolve display
 * name / picture for the OG card. Returns the parsed metadata object
 * or an empty object on failure.
 */
export async function fetchProfileMetadata(
	pubkey: string
): Promise<{ name?: string; display_name?: string; picture?: string }> {
	if (typeof WebSocket === 'undefined') return {};
	// NIP-01 kind 0 is non-replaceable but unique per pubkey — fetch by pubkey + kind only.
	const filter = { kinds: [0], authors: [pubkey] } as any;
	const evt = await Promise.race(
		RELAYS.map(
			(r) =>
				new Promise<any | null>((resolve) => {
					let ws: WebSocket | null = null;
					let resolved = false;
					const safe = (v: any | null) => {
						if (resolved) return;
						resolved = true;
						try {
							ws?.close();
						} catch {
							/* ignore */
						}
						resolve(v);
					};
					const t = setTimeout(() => safe(null), FETCH_TIMEOUT_MS);
					try {
						ws = new WebSocket(r);
					} catch {
						clearTimeout(t);
						safe(null);
						return;
					}
					const subId = `og-p-${Date.now()}`;
					ws.onopen = () => {
						try {
							ws?.send(JSON.stringify(['REQ', subId, { ...filter, limit: 1 }]));
						} catch {
							clearTimeout(t);
							safe(null);
						}
					};
					ws.onmessage = (m) => {
						try {
							const msg = JSON.parse((m as MessageEvent).data);
							if (msg[0] === 'EVENT' && msg[1] === subId && msg[2]) {
								clearTimeout(t);
								safe(msg[2]);
							} else if (msg[0] === 'EOSE' && msg[1] === subId) {
								clearTimeout(t);
								safe(null);
							}
						} catch {
							/* ignore */
						}
					};
					ws.onerror = () => {
						clearTimeout(t);
						safe(null);
					};
					ws.onclose = () => {
						clearTimeout(t);
						if (!resolved) safe(null);
					};
				})
		)
	);
	if (!evt?.content) return {};
	try {
		const parsed = JSON.parse(evt.content);
		return {
			name: typeof parsed.name === 'string' ? parsed.name : undefined,
			display_name: typeof parsed.display_name === 'string' ? parsed.display_name : undefined,
			picture: typeof parsed.picture === 'string' ? parsed.picture : undefined
		};
	} catch {
		return {};
	}
}
