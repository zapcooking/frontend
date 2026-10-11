import { describe, it, expect, vi } from 'vitest';

const A = 'a'.repeat(64);

const { verifyNip05Claims } = vi.hoisted(() => ({
	verifyNip05Claims: vi.fn(async (checks: { pubkey: string }[]) => checks.map((c) => c.pubkey))
}));
vi.mock('$lib/reads/nip05Verify.server', () => ({ NIP05_MAX_CHECKS: 50, verifyNip05Claims }));

import { POST } from './+server';

const call = (body: string) =>
	POST({ request: new Request('http://x/api/reads/nip05', { method: 'POST', body }) } as unknown as Parameters<typeof POST>[0]);

describe('POST /api/reads/nip05', () => {
	it('answers {verified} for valid checks', async () => {
		const res = await call(JSON.stringify({ checks: [{ pubkey: A, nip05: 'bob@example.com' }] }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ verified: [A] });
	});

	const bad: [string, string][] = [
		['bad JSON', '{'],
		['no checks', '{}'],
		['too many checks', JSON.stringify({ checks: Array(51).fill({ pubkey: A, nip05: 'b@example.com' }) })],
		['a non-hex pubkey', JSON.stringify({ checks: [{ pubkey: 'npub1', nip05: 'b@example.com' }] })],
		['an upper-case pubkey', JSON.stringify({ checks: [{ pubkey: A.toUpperCase(), nip05: 'b@example.com' }] })],
		['a non-string nip05', JSON.stringify({ checks: [{ pubkey: A, nip05: 5 }] })]
	];
	for (const [label, body] of bad) {
		it(`400 on ${label}`, async () => {
			verifyNip05Claims.mockClear();
			expect((await call(body)).status).toBe(400);
			expect(verifyNip05Claims).not.toHaveBeenCalled();
		});
	}

	it('413 on an oversized body', async () => {
		expect((await call('x'.repeat(33 * 1024))).status).toBe(413);
	});

	it('accepts exactly 50 checks', async () => {
		const res = await call(JSON.stringify({ checks: Array(50).fill({ pubkey: A, nip05: 'b@example.com' }) }));
		expect(res.status).toBe(200);
	});
});
