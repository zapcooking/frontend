/**
 * Saved Recipe Packs — a per-user NIP-51 bookmark set (kind 30003)
 * tracking which kind:30004 Recipe Packs the current user has saved.
 *
 * Stored as a single replaceable event with d-tag
 * `zapcooking-saved-packs`. Each saved pack appears as an `a` tag in
 * the standard `30004:<pubkey>:<dTag>` format. We keep this separate
 * from the main cookbook list (which holds kind:30023 recipes) so the
 * two concepts don't bleed into each other.
 */

import { writable, derived, get } from 'svelte/store';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import { ndk, userPublickey } from '$lib/nostr';
import { addClientTagToEvent } from '$lib/nip89';
import { RECIPE_PACK_KIND } from '$lib/recipePack';

const SAVED_PACKS_DTAG = 'zapcooking-saved-packs';
const SAVED_PACKS_KIND = 30003;

interface SavedPacksState {
	loaded: boolean;
	loading: boolean;
	saved: string[]; // a-tags, e.g. "30004:pubkey:dTag"
	event: NDKEvent | null; // the underlying NIP-51 event (for replace-on-publish)
}

function packATag(packEvent: NDKEvent): string | null {
	const dTag = packEvent.tags?.find((t) => t[0] === 'd')?.[1];
	if (!dTag || !packEvent.pubkey) return null;
	return `${packEvent.kind ?? RECIPE_PACK_KIND}:${packEvent.pubkey}:${dTag}`;
}

function createSavedPacksStore() {
	const { subscribe, set, update } = writable<SavedPacksState>({
		loaded: false,
		loading: false,
		saved: [],
		event: null
	});

	let lastLoadedPubkey: string | null = null;

	async function load(force: boolean = false): Promise<void> {
		const pubkey = get(userPublickey);
		const ndkInstance = get(ndk);
		if (!pubkey || !ndkInstance) {
			set({ loaded: true, loading: false, saved: [], event: null });
			lastLoadedPubkey = null;
			return;
		}
		if (!force && lastLoadedPubkey === pubkey) return;

		// When the load is for a *different* pubkey than the one we last
		// hydrated, drop the previous account's saved/event before kicking
		// off the fetch. Without this the previous user's bookmark state
		// would briefly bleed into the new session — and if the fetch
		// fails, the catch path would leave it in place permanently.
		const isPubkeyChange = lastLoadedPubkey !== null && lastLoadedPubkey !== pubkey;
		if (isPubkeyChange) {
			set({ loaded: false, loading: true, saved: [], event: null });
		} else {
			update((s) => ({ ...s, loading: true }));
		}

		try {
			const evt = await ndkInstance.fetchEvent({
				kinds: [SAVED_PACKS_KIND],
				authors: [pubkey],
				'#d': [SAVED_PACKS_DTAG]
			});
			// Re-check the active pubkey at resolution — a fast user switch
			// could have happened during the await; if so, drop this result.
			if (get(userPublickey) !== pubkey) return;

			const aTags = evt
				? evt.tags.filter((t) => t[0] === 'a' && typeof t[1] === 'string').map((t) => t[1])
				: [];
			set({ loaded: true, loading: false, saved: aTags, event: evt || null });
			lastLoadedPubkey = pubkey;
		} catch (err) {
			console.warn('[savedPacks] load failed', err);
			// On error after a pubkey change, the optimistic clear above
			// stays in effect — we never let the previous account's data
			// linger. For a same-pubkey reload error, keep whatever was
			// cached from the last successful load.
			update((s) => ({ ...s, loading: false, loaded: true }));
		}
	}

	/** Build (and publish) the replaceable bookmark-set event with `nextSaved`. */
	async function publish(nextSaved: string[], existing: NDKEvent | null): Promise<NDKEvent | null> {
		const ndkInstance = get(ndk);
		const pubkey = get(userPublickey);
		if (!ndkInstance || !pubkey) return null;

		const event = new NDKEvent(ndkInstance);
		event.kind = SAVED_PACKS_KIND;
		const tags: string[][] = [
			['d', SAVED_PACKS_DTAG],
			['title', 'Saved Recipe Packs'],
			['t', 'recipe-pack'],
			['t', 'zap-cooking']
		];
		// Carry forward any non-a/non-control tags from the existing event so
		// we don't accidentally strip future fields (e.g. an image tag a user
		// added in another client). Cheap forward-compat.
		if (existing?.tags) {
			for (const t of existing.tags) {
				if (!t[0]) continue;
				if (['d', 'title', 't', 'a', 'client'].includes(t[0])) continue;
				tags.push([...t]);
			}
		}
		for (const aTag of nextSaved) tags.push(['a', aTag]);
		event.tags = tags;

		addClientTagToEvent(event);
		await event.publish();
		return event;
	}

	async function save(packEvent: NDKEvent): Promise<boolean> {
		const aTag = packATag(packEvent);
		if (!aTag) return false;
		await load();
		const state = get({ subscribe });
		if (state.saved.includes(aTag)) return true;
		const next = [...state.saved, aTag];
		// Optimistic
		update((s) => ({ ...s, saved: next }));
		try {
			const evt = await publish(next, state.event);
			if (evt) update((s) => ({ ...s, event: evt }));
			return true;
		} catch (err) {
			console.error('[savedPacks] save failed', err);
			update((s) => ({ ...s, saved: state.saved }));
			return false;
		}
	}

	async function unsave(packEvent: NDKEvent): Promise<boolean> {
		const aTag = packATag(packEvent);
		if (!aTag) return false;
		await load();
		const state = get({ subscribe });
		if (!state.saved.includes(aTag)) return true;
		const next = state.saved.filter((a) => a !== aTag);
		update((s) => ({ ...s, saved: next }));
		try {
			const evt = await publish(next, state.event);
			if (evt) update((s) => ({ ...s, event: evt }));
			return true;
		} catch (err) {
			console.error('[savedPacks] unsave failed', err);
			update((s) => ({ ...s, saved: state.saved }));
			return false;
		}
	}

	function isSaved(packEvent: NDKEvent | null | undefined): boolean {
		if (!packEvent) return false;
		const aTag = packATag(packEvent);
		if (!aTag) return false;
		return get({ subscribe }).saved.includes(aTag);
	}

	function reset() {
		set({ loaded: false, loading: false, saved: [], event: null });
		lastLoadedPubkey = null;
	}

	return { subscribe, load, save, unsave, isSaved, reset };
}

export const savedPacksStore = createSavedPacksStore();
export const savedPackATags = derived(savedPacksStore, ($s) => $s.saved);
export const savedPacksLoaded = derived(savedPacksStore, ($s) => $s.loaded);

// Auto-reload when the signed-in user changes — `load()` early-returns
// if the pubkey hasn't actually moved, so this is cheap.
if (typeof window !== 'undefined') {
	let lastPk = '';
	userPublickey.subscribe((pk) => {
		if (pk === lastPk) return;
		lastPk = pk;
		if (pk) {
			savedPacksStore.load();
		} else {
			savedPacksStore.reset();
		}
	});
}
