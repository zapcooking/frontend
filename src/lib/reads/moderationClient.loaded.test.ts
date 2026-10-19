import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$app/environment', () => ({ browser: true }));

const LISTS = JSON.stringify({
	blockedPubkeys: [],
	blockedEventIds: [],
	blockedNaddrs: [],
	denylist: []
});

async function load(responses: Array<() => Promise<Response>>) {
	vi.resetModules();
	const fetchFn = vi.fn();
	for (const r of responses) fetchFn.mockImplementationOnce(r);
	vi.stubGlobal('fetch', fetchFn);
	const client = await import('./moderationClient');
	return { client, fetchFn };
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('readsModerationAvailable: the curated hides are really loaded', () => {
	it('is false after a failed overlay (503 or network), though the settled signal is set', async () => {
		for (const fail of [
			async () => new Response('down', { status: 503 }),
			async () => {
				throw new Error('offline');
			}
		]) {
			const { client } = await load([fail]);
			expect(await client.readsModerationAvailable()).toBe(false);
			// Existing consumers keep their meaning: settled, loaded or not.
			expect(get(client.readsModerationReady)).toBe(true);
			expect(get(client.readsModerationLoaded)).toBe(false);
		}
	});

	it('is true once an overlay arrives', async () => {
		const { client } = await load([async () => new Response(LISTS, { status: 200 })]);
		expect(await client.readsModerationAvailable()).toBe(true);
		expect(get(client.readsModerationLoaded)).toBe(true);
	});

	it('tries a failed overlay again on the next call', async () => {
		const { client, fetchFn } = await load([
			async () => new Response('down', { status: 503 }),
			async () => new Response(LISTS, { status: 200 })
		]);
		expect(await client.readsModerationAvailable()).toBe(false);
		expect(await client.readsModerationAvailable()).toBe(true);
		expect(fetchFn).toHaveBeenCalledTimes(2);
	});
});
