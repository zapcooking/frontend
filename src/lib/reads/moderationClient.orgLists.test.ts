import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';

vi.mock('$app/environment', () => ({ browser: true }));

const SPAMMER = '9'.repeat(64);
const AUTHOR = 'c'.repeat(64);

const article = (pubkey: string, d: string) => ({
	id: '1'.repeat(64),
	pubkey,
	kind: 30023,
	content: 'Sourdough, slowly. '.repeat(40),
	tags: [['d', d], ['title', 'Bread'], ['t', 'food']]
});

async function load(response: () => Promise<Response>) {
	vi.resetModules();
	vi.stubGlobal('fetch', vi.fn(response));
	const client = await import('./moderationClient');
	const { mergeReadsLists } = await import('./moderation');
	return { client, mergeReadsLists };
}

async function settle(client: typeof import('./moderationClient')) {
	client.ensureReadsModerationLoaded();
	await vi.waitFor(() => expect(get(client.readsModerationReady)).toBe(true));
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('All reads and the org lists (client)', () => {
	it('blocks a feed-block author and a feed-hidden coordinate once the overlay loads', async () => {
		const { orgModerationAsReadsLists, parseOrgModeration } = await import('./orgLists');
		const org = orgModerationAsReadsLists(
			parseOrgModeration(
				{ pubkey: '', kind: 30000, created_at: 1, tags: [['p', SPAMMER]] },
				{ pubkey: '', kind: 30000, created_at: 1, tags: [['a', `30023:${AUTHOR}:hidden`]] }
			)
		);
		const body = JSON.stringify({ ...org, denylist: [] });
		const { client } = await load(async () => new Response(body, { status: 200 }));
		expect(get(client.readsModerationReady)).toBe(false);
		await settle(client);
		expect(client.isBlockedFromReads(article(SPAMMER, 'pizza'))).toBe(true);
		expect(client.isBlockedFromReads(article(AUTHOR, 'hidden'))).toBe(true);
		expect(client.isBlockedFromReads(article(AUTHOR, 'fine'))).toBe(false);
	});

	it('is ready even when the overlay request fails (seed lists still apply)', async () => {
		const { client } = await load(async () => {
			throw new Error('offline');
		});
		await settle(client);
		expect(client.isBlockedFromReads(article(SPAMMER, 'pizza'))).toBe(false);
	});
});
