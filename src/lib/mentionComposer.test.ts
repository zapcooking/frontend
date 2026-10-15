import { describe, expect, it, vi } from 'vitest';

// The composer module pulls in the NDK singleton and profile services at
// import time; none of them are needed to assert the trigger regex.
vi.mock('$lib/nostr', () => ({ ndk: { subscribe: vi.fn() } }));
vi.mock('$lib/profileSearchService', () => ({ searchProfiles: vi.fn().mockResolvedValue([]) }));
vi.mock('$lib/sanitize', () => ({ sanitizeHTML: (s: string) => s }));

import { MENTION_TRIGGER_REGEX } from './mentionComposer';

/**
 * The mention autocomplete may only open when the @ sits at a word
 * boundary. Typing an email or Lightning address (daniel@breez.tips) must
 * not pop suggestions just because the domain names a profile — picking
 * one used to splice an npub into the address.
 */
describe('MENTION_TRIGGER_REGEX', () => {
	it('opens on a mention at the start of the text', () => {
		expect('@breez'.match(MENTION_TRIGGER_REGEX)?.[1]).toBe('breez');
	});

	it('opens after whitespace or punctuation', () => {
		expect('hey @breez'.match(MENTION_TRIGGER_REGEX)?.[1]).toBe('breez');
		expect('(@breez'.match(MENTION_TRIGGER_REGEX)?.[1]).toBe('breez');
		expect('line one\n@breez'.match(MENTION_TRIGGER_REGEX)?.[1]).toBe('breez');
	});

	it('stays closed while typing an email or Lightning address', () => {
		expect('daniel@breez'.match(MENTION_TRIGGER_REGEX)).toBeNull();
		expect('daniel@breez.tips'.match(MENTION_TRIGGER_REGEX)).toBeNull();
	});

	it('treats accented letters as word characters before the @', () => {
		expect('jürgen@breez'.match(MENTION_TRIGGER_REGEX)).toBeNull();
	});
});
