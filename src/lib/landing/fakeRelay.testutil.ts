/**
 * A fake WebSocket + in-memory relays for the landing data tests. Honours
 * ids/kinds/authors/#d/#t/since/until/limit and `search: "topic:<slug>"`
 * (matched against a `["topic", slug]` tag), newest first, so results are
 * as thin or as full as a real relay's would be.
 */

import type { NostrEvent } from '$lib/relayCollect';

export type RelayMode = 'ok' | 'down' | 'hang' | 'closed';

export interface FakeRelay {
	events: NostrEvent[];
	mode: RelayMode;
	/** Filters received, in order. */
	reqs: Record<string, unknown>[];
	/** ms before EOSE. */
	delayMs?: number;
	/** Send every match, ignoring the filter's limit (a misbehaving relay). */
	ignoreLimit?: boolean;
}

export const relays = new Map<string, FakeRelay>();

export function relay(url: string, events: NostrEvent[] = [], mode: RelayMode = 'ok'): FakeRelay {
	const r: FakeRelay = { events, mode, reqs: [] };
	relays.set(url, r);
	return r;
}

function matches(e: NostrEvent, f: Record<string, unknown>): boolean {
	const arr = (k: string) => f[k] as unknown[] | undefined;
	if (arr('ids') && !arr('ids')!.includes(e.id)) return false;
	if (arr('kinds') && !arr('kinds')!.includes(e.kind)) return false;
	if (arr('authors') && !arr('authors')!.includes(e.pubkey)) return false;
	for (const k of Object.keys(f)) {
		if (!k.startsWith('#')) continue;
		const vals = f[k] as string[];
		if (!e.tags.some((t) => t[0] === k.slice(1) && vals.includes(t[1]))) return false;
	}
	if (typeof f.since === 'number' && e.created_at < f.since) return false;
	if (typeof f.until === 'number' && e.created_at > f.until) return false;
	if (typeof f.search === 'string') {
		const m = /topic:([a-z0-9-]+)/.exec(f.search);
		if (m && !e.tags.some((t) => t[0] === 'topic' && t[1] === m[1])) return false;
	}
	return true;
}

export function query(events: NostrEvent[], f: Record<string, unknown>): NostrEvent[] {
	const out = events.filter((e) => matches(e, f)).sort((a, b) => b.created_at - a.created_at);
	return typeof f.limit === 'number' ? out.slice(0, f.limit) : out;
}

export class FakeWebSocket {
	static OPEN = 1;
	static CONNECTING = 0;
	readyState = 0;
	onopen: (() => void) | null = null;
	onmessage: ((m: { data: string }) => void) | null = null;
	onerror: (() => void) | null = null;
	onclose: (() => void) | null = null;
	private closed = false;
	private relay: FakeRelay | undefined;

	constructor(url: string) {
		this.relay = relays.get(url);
		setTimeout(() => {
			if (!this.relay || this.relay.mode === 'down') {
				this.onerror?.();
				return;
			}
			this.readyState = 1;
			this.onopen?.();
		}, 0);
	}

	send(raw: string) {
		const msg = JSON.parse(raw) as unknown[];
		const r = this.relay!;
		if (msg[0] !== 'REQ' || r.mode === 'hang') return;
		const subId = msg[1] as string;
		const filter = msg[2] as Record<string, unknown>;
		r.reqs.push(filter);
		const reply = () => {
			if (this.closed) return;
			if (r.mode === 'closed') {
				this.onmessage?.({ data: JSON.stringify(['CLOSED', subId, 'auth-required: test']) });
				return;
			}
			const { limit: _limit, ...unlimited } = filter;
			for (const e of query(r.events, r.ignoreLimit ? unlimited : filter)) {
				this.onmessage?.({ data: JSON.stringify(['EVENT', subId, e]) });
			}
			this.onmessage?.({ data: JSON.stringify(['EOSE', subId]) });
		};
		setTimeout(reply, r.delayMs ?? 0);
	}

	close() {
		this.closed = true;
		this.readyState = 3;
	}
}

let n = 0;
/** An event with a fake id; `sig: 'valid'` passes the tests' verify. */
export function ev(partial: Partial<NostrEvent> & Pick<NostrEvent, 'kind' | 'pubkey'>): NostrEvent {
	n += 1;
	return {
		id: partial.id ?? n.toString(16).padStart(64, '0'),
		created_at: partial.created_at ?? 1_800_000_000,
		tags: partial.tags ?? [],
		content: partial.content ?? '',
		sig: partial.sig ?? 'valid',
		...partial
	};
}

export const testVerify = (e: NostrEvent) => e.sig === 'valid';

export const pk = (c: string) => c.repeat(64).slice(0, 64);
