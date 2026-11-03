import { describe, it, expect } from 'vitest';
import { isPublicHostname, nip05Url, parseNip05, pubkeysForName } from './nip05Verify';

const PK = 'a'.repeat(64);

describe('parseNip05', () => {
	it('splits name@domain, lower-cased', () => {
		expect(parseNip05(' GoBrrr@Example.COM ')).toEqual({ name: 'gobrrr', domain: 'example.com' });
	});

	it('a bare domain is the "_" name', () => {
		expect(parseNip05('example.com')).toEqual({ name: '_', domain: 'example.com' });
	});

	it('uses the last @ (so the local part can never smuggle a host)', () => {
		expect(parseNip05('a@b@example.com')).toBeNull();
	});

	const bad: [string, unknown][] = [
		['not a string', 42],
		['empty', ''],
		['bad name characters', 'bob smith@example.com'],
		['IP literal', 'bob@127.0.0.1'],
		['IPv6 literal', 'bob@[::1]'],
		['localhost', 'bob@localhost'],
		['a port', 'bob@example.com:8080'],
		['a path', 'bob@example.com/x'],
		['reserved suffix', 'bob@printer.local'],
		['onion', 'bob@abc.onion'],
		['numeric TLD', 'bob@10.0.0.1'],
		['too long', 'a@' + 'x'.repeat(320) + '.com']
	];
	for (const [label, raw] of bad) {
		it(`rejects ${label}`, () => {
			expect(parseNip05(raw)).toBeNull();
		});
	}
});

describe('isPublicHostname', () => {
	it('accepts ordinary hosts, rejects malformed labels', () => {
		expect(isPublicHostname('nostrplebs.com')).toBe(true);
		expect(isPublicHostname('a.b-c.example.co')).toBe(true);
		expect(isPublicHostname('-bad.com')).toBe(false);
		expect(isPublicHostname('bad-.com')).toBe(false);
		expect(isPublicHostname('com')).toBe(false);
		expect(isPublicHostname('x.' + 'y'.repeat(64) + '.com')).toBe(false);
	});
});

describe('nip05Url', () => {
	it('is the https well-known path with the name as a query', () => {
		expect(nip05Url({ name: '_', domain: 'example.com' })).toBe('https://example.com/.well-known/nostr.json?name=_');
	});
});

describe('pubkeysForName', () => {
	it('matches the name in any letter case', () => {
		expect(pubkeysForName({ names: { GoBrrr: PK } }, 'gobrrr')).toEqual([PK]);
	});

	it('lower-cases the key it returns', () => {
		expect(pubkeysForName({ names: { bob: PK.toUpperCase() } }, 'bob')).toEqual([PK]);
	});

	it('ignores other names and non-hex values', () => {
		expect(pubkeysForName({ names: { alice: PK, bob: 'npub1xyz' } }, 'bob')).toEqual([]);
	});

	it('no names object → []', () => {
		for (const body of [null, 'x', {}, { names: [] }, { names: 'bob' }]) expect(pubkeysForName(body, 'bob')).toEqual([]);
	});
});
