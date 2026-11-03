/**
 * Raw-WebSocket relay reads: the /explore landing data (in the Worker) and
 * the curated Reads tab (in the browser).
 *
 * No NDK and no nostr-tools relay class: nostr-tools' AbstractRelay needs
 * MessageChannel, which workerd lacks, so it stops after the first frame
 * (see recipePackOg.server.ts for the single-event version of this). In the
 * browser this also keeps reads anonymous: an AUTH challenge is ignored, so
 * no signer is ever prompted. Every read has a hard timeout and resolves with
 * whatever arrived; nothing here throws.
 */

export interface NostrEvent {
	id: string;
	pubkey: string;
	created_at: number;
	kind: number;
	tags: string[][];
	content: string;
	sig: string;
}

export type Filter = Record<string, unknown>;

export interface CollectResult {
	/** Events per subscription key, in arrival order. */
	events: Record<string, NostrEvent[]>;
	/** Keys that ended with EOSE (or CLOSED) before the timeout. */
	done: Record<string, boolean>;
	/** CLOSED reasons per key (e.g. `auth-required: …`). */
	closed: Record<string, string>;
}

export interface CollectOptions {
	timeoutMs: number;
	signal?: AbortSignal;
}

/** Most events kept per subscription, whatever `limit` a relay honours. */
export const MAX_EVENTS_PER_SUB = 500;

function isEventShape(e: unknown): e is NostrEvent {
	const x = e as NostrEvent;
	return (
		!!x &&
		typeof x === 'object' &&
		typeof x.id === 'string' &&
		typeof x.pubkey === 'string' &&
		typeof x.created_at === 'number' &&
		typeof x.kind === 'number' &&
		Array.isArray(x.tags) &&
		// Every tag an array of strings: downstream tag readers never see null or numbers.
		x.tags.every((t) => Array.isArray(t) && t.every((v) => typeof v === 'string')) &&
		typeof x.content === 'string' &&
		typeof x.sig === 'string'
	);
}

/** Events to keep for a filter: its own limit (when sane), never more than the cap. */
function capFor(filter: Filter): number {
	const l = filter.limit;
	return typeof l === 'number' && l > 0 ? Math.min(l, MAX_EVENTS_PER_SUB) : MAX_EVENTS_PER_SUB;
}

/**
 * One socket, one REQ per key, until every key has its EOSE/CLOSED or the
 * timeout fires. Returns what arrived either way.
 */
export function collect(
	url: string,
	subs: Record<string, Filter>,
	opts: CollectOptions
): Promise<CollectResult> {
	const keys = Object.keys(subs);
	const caps = Object.fromEntries(keys.map((k) => [k, capFor(subs[k])]));
	const result: CollectResult = { events: {}, done: {}, closed: {} };
	for (const k of keys) {
		result.events[k] = [];
		result.done[k] = false;
	}
	if (keys.length === 0 || typeof WebSocket === 'undefined' || opts.signal?.aborted) {
		return Promise.resolve(result);
	}

	return new Promise((resolve) => {
		let ws: WebSocket | null = null;
		let finished = false;
		const prefix = `l${Math.random().toString(36).slice(2, 8)}-`;
		const subIds = new Map(keys.map((k) => [prefix + k, k]));

		const finish = () => {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			opts.signal?.removeEventListener('abort', finish);
			try {
				ws?.close();
			} catch {
				/* ignore */
			}
			resolve(result);
		};
		const timer = setTimeout(finish, opts.timeoutMs);
		opts.signal?.addEventListener('abort', finish, { once: true });

		try {
			ws = new WebSocket(url);
		} catch {
			finish();
			return;
		}

		ws.onopen = () => {
			if (finished || !ws) return;
			try {
				for (const [subId, key] of subIds) ws.send(JSON.stringify(['REQ', subId, subs[key]]));
			} catch {
				finish();
			}
		};
		ws.onmessage = (msg) => {
			if (finished) return;
			let data: unknown;
			try {
				data = JSON.parse(String((msg as MessageEvent).data));
			} catch {
				return;
			}
			if (!Array.isArray(data)) return;
			const key = subIds.get(data[1] as string);
			if (!key) return; // AUTH challenges, NOTICEs, stale subs
			if (data[0] === 'EVENT' && isEventShape(data[2])) {
				// A relay that ignores `limit` can't grow memory past the cap.
				if (result.events[key].length < caps[key]) result.events[key].push(data[2]);
			} else if (data[0] === 'EOSE' || data[0] === 'CLOSED') {
				if (data[0] === 'CLOSED') result.closed[key] = String(data[2] ?? '');
				result.done[key] = true;
				if (data[0] === 'EOSE') {
					try {
						ws?.send(JSON.stringify(['CLOSE', data[1]]));
					} catch {
						/* ignore */
					}
				}
				if (keys.every((k) => result.done[k])) finish();
			}
		};
		ws.onerror = finish;
		ws.onclose = finish;
	});
}

/**
 * The same subscriptions on several relays at once; for each key the
 * first relay whose answer `accept` turns into a value wins. Resolves
 * when every key has a winner, every relay has finished, or the timeout
 * fires. Keys without a winner are absent from the result.
 */
export function raceKeyed<T>(
	urls: string[],
	subs: Record<string, Filter>,
	accept: (key: string, events: NostrEvent[]) => T | null,
	opts: CollectOptions
): Promise<Record<string, T>> {
	const keys = Object.keys(subs);
	const won: Record<string, T> = {};
	if (keys.length === 0 || urls.length === 0) return Promise.resolve(won);
	const controller = new AbortController();
	const outer = opts.signal;
	const onOuterAbort = () => controller.abort();
	outer?.addEventListener('abort', onOuterAbort, { once: true });

	return new Promise((resolve) => {
		let pending = urls.length;
		let settled = false;
		const settle = () => {
			if (settled) return;
			settled = true;
			outer?.removeEventListener('abort', onOuterAbort);
			controller.abort();
			resolve(won);
		};
		for (const url of urls) {
			collect(url, subs, { timeoutMs: opts.timeoutMs, signal: controller.signal }).then((r) => {
				if (!settled) {
					for (const k of keys) {
						if (k in won || !r.done[k]) continue;
						const v = accept(k, r.events[k]);
						if (v !== null) won[k] = v;
					}
					if (keys.every((k) => k in won)) settle();
				}
				if (--pending === 0) settle();
			});
		}
	});
}

/**
 * The same subscriptions on several relays; all events that arrive before
 * the timeout, merged per key and de-duplicated by id. For batch lookups
 * (profiles) where no single relay has everything.
 */
export async function unionKeyed(
	urls: string[],
	subs: Record<string, Filter>,
	opts: CollectOptions
): Promise<{ events: Record<string, NostrEvent[]>; anyDone: Record<string, boolean> }> {
	const results = await Promise.all(urls.map((u) => collect(u, subs, opts)));
	const events: Record<string, NostrEvent[]> = {};
	const anyDone: Record<string, boolean> = {};
	for (const k of Object.keys(subs)) {
		const seen = new Set<string>();
		events[k] = [];
		anyDone[k] = false;
		for (const r of results) {
			anyDone[k] ||= r.done[k];
			for (const e of r.events[k]) {
				if (seen.has(e.id)) continue;
				seen.add(e.id);
				events[k].push(e);
			}
		}
	}
	return { events, anyDone };
}
