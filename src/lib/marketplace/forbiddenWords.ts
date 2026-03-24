/**
 * Forbidden Words Filter
 *
 * Prevents sellers from publishing listings with placeholder, test,
 * or obviously non-real content. Inspired by Plebeian Market's approach.
 *
 * Words are matched as whole words (case-insensitive) so "testing" is
 * caught but "contest" is not.
 */

const FORBIDDEN_WORDS = new Set([
	'test',
	'testing',
	'teststore',
	'example',
	'dummy',
	'fake',
	'demo',
	'sample',
	'trial',
	'sandbox',
	'mock',
	'placeholder',
	'lorem',
	'admin',
	'password',
	'asdf',
	'qwerty',
	'foo',
	'bar',
	'baz',
	'untitled',
	'delete me',
	'todo',
	'tbd'
]);

// Build a single regex that matches any forbidden word as a whole word
const pattern = new RegExp(
	'\\b(' +
		Array.from(FORBIDDEN_WORDS)
			.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
			.join('|') +
		')\\b',
	'i'
);

/**
 * Check if a string contains a forbidden word.
 * Returns the matched word if found, or null if clean.
 */
export function findForbiddenWord(text: string): string | null {
	if (!text) return null;
	const match = text.match(pattern);
	return match ? match[0] : null;
}

/**
 * Check multiple fields at once. Returns the first forbidden word found
 * along with which field it was in, or null if all clean.
 */
export function checkForbiddenContent(
	fields: Record<string, string>
): { word: string; field: string } | null {
	for (const [field, text] of Object.entries(fields)) {
		const word = findForbiddenWord(text);
		if (word) return { word, field };
	}
	return null;
}
