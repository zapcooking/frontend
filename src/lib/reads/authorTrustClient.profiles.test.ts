import { describe, it, expect, vi } from 'vitest';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';

const { unionKeyed } = vi.hoisted(() => ({ unionKeyed: vi.fn() }));
vi.mock('$lib/relayCollect', () => ({ unionKeyed }));
vi.mock('$app/environment', () => ({ browser: true }));

import { browserTrustDeps } from './authorTrustClient';

// Through JSON, as off the wire: finalizeEvent marks its result verified, and a spread would copy that mark.
const profile = (sk: Uint8Array, nip05: string, created_at: number) =>
	JSON.parse(JSON.stringify(finalizeEvent({ kind: 0, created_at, tags: [], content: JSON.stringify({ nip05 }) }, sk)));

describe('browserTrustDeps.nip05Claims', () => {
	it('ignores profiles whose signature does not check out', async () => {
		const sk = generateSecretKey();
		const real = profile(sk, 'bob@real.example', 100);
		// A relay rewrites a newer copy to point at its own domain: the id and sig no longer match.
		const forged = { ...profile(sk, 'bob@real.example', 200), content: JSON.stringify({ nip05: 'bob@evil.example' }) };
		unionKeyed.mockResolvedValueOnce({ events: { p0: [real, forged] }, anyDone: { p0: true } });
		const claims = await browserTrustDeps.nip05Claims([real.pubkey]);
		expect(claims?.get(real.pubkey)).toBe('bob@real.example');
	});
});
