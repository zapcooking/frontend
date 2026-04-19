/**
 * Ingredient-quantity scaling.
 *
 * Parses the leading numeric quantity from an ingredient line (whole,
 * decimal, fraction, mixed number, unicode fraction, or a range of the
 * same) and re-emits the line with the quantity multiplied by `scale`.
 * Lines without a parseable leading number are returned unchanged, so
 * entries like "salt to taste" or "a pinch of cinnamon" pass through
 * without damage.
 */

const UNICODE_FRACTIONS: Record<string, number> = {
	'½': 0.5,
	'⅓': 1 / 3,
	'⅔': 2 / 3,
	'¼': 0.25,
	'¾': 0.75,
	'⅕': 0.2,
	'⅖': 0.4,
	'⅗': 0.6,
	'⅘': 0.8,
	'⅙': 1 / 6,
	'⅚': 5 / 6,
	'⅛': 0.125,
	'⅜': 0.375,
	'⅝': 0.625,
	'⅞': 0.875
};

const FRACTION_CHARS = Object.keys(UNICODE_FRACTIONS).join('');

// Leading quantity pattern: mixed number, fraction, decimal, whole int,
// or single unicode fraction. Ordered most-specific-first — JS alternation
// doesn't try for longest match.
const QTY_TOKEN = `(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+\\.\\d+|\\d+|[${FRACTION_CHARS}])`;

// Whole-line pattern: leading quantity, optional range (" - quantity"),
// and the remainder. The range separator accepts hyphen, en-dash, em-dash,
// or "to" surrounded by spaces. The whitespace before the range lives
// INSIDE the optional group so backtracking restores it to `rest` when
// there is no range (otherwise "2 tbsp" would lose its space and render
// as "2tbsp" after scaling).
const QTY_RE = new RegExp(
	`^\\s*(${QTY_TOKEN})(?:\\s*(?:-|–|—|\\s+to\\s+)\\s*(${QTY_TOKEN}))?(.*)$`
);

/** Parse a quantity string (one of the accepted forms) to a number. */
function parseQuantity(raw: string): number | null {
	const s = raw.trim();
	if (!s) return null;

	// Single unicode fraction
	if (s.length === 1 && UNICODE_FRACTIONS[s] !== undefined) {
		return UNICODE_FRACTIONS[s];
	}

	// Mixed number: "1 1/2"
	const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
	if (mixed) {
		const denom = parseInt(mixed[3], 10);
		if (denom === 0) return null;
		return parseInt(mixed[1], 10) + parseInt(mixed[2], 10) / denom;
	}

	// Simple fraction: "1/2"
	const frac = s.match(/^(\d+)\/(\d+)$/);
	if (frac) {
		const denom = parseInt(frac[2], 10);
		if (denom === 0) return null;
		return parseInt(frac[1], 10) / denom;
	}

	// Decimal or whole number
	if (/^\d+(?:\.\d+)?$/.test(s)) {
		const n = parseFloat(s);
		return Number.isFinite(n) ? n : null;
	}

	return null;
}

// Common culinary fractions to match against — rendered as unicode when
// a scaled value lands within tolerance.
const NICE_FRACTIONS: Array<{ val: number; display: string }> = [
	{ val: 0.125, display: '⅛' },
	{ val: 0.25, display: '¼' },
	{ val: 1 / 3, display: '⅓' },
	{ val: 0.375, display: '⅜' },
	{ val: 0.5, display: '½' },
	{ val: 0.625, display: '⅝' },
	{ val: 2 / 3, display: '⅔' },
	{ val: 0.75, display: '¾' },
	{ val: 0.875, display: '⅞' }
];

const FRACTION_TOLERANCE = 0.015;

/** Format a scaled numeric quantity for display. */
function formatQuantity(n: number): string {
	if (!Number.isFinite(n)) return String(n);
	if (Math.abs(n) < 0.005) return '0';

	const whole = Math.floor(n);
	const frac = n - whole;

	// Exact whole (or near-whole after rounding error)
	if (frac < FRACTION_TOLERANCE) {
		return String(whole);
	}
	// Near-next-whole (e.g. 0.998 → 1)
	if (1 - frac < FRACTION_TOLERANCE) {
		return String(whole + 1);
	}

	for (const { val, display } of NICE_FRACTIONS) {
		if (Math.abs(frac - val) < FRACTION_TOLERANCE) {
			return whole === 0 ? display : `${whole} ${display}`;
		}
	}

	// Fall back to a short decimal; strip trailing zeros.
	return Number(n.toFixed(2)).toString();
}

/**
 * Scale a single ingredient line. Returns the line unchanged when it has
 * no parseable leading quantity (e.g. "salt to taste").
 */
export function scaleIngredientLine(line: string, scale: number): string {
	if (scale === 1 || !Number.isFinite(scale) || scale <= 0) return line;
	const m = line.match(QTY_RE);
	if (!m) return line;

	const first = parseQuantity(m[1]);
	if (first === null) return line;

	const second = m[2] ? parseQuantity(m[2]) : null;
	const rest = m[3] ?? '';

	const scaledFirst = formatQuantity(first * scale);
	if (second !== null) {
		const scaledSecond = formatQuantity(second * scale);
		return `${scaledFirst}–${scaledSecond}${rest}`;
	}
	return `${scaledFirst}${rest}`;
}

// Exposed for tests
export const __test = { parseQuantity, formatQuantity, QTY_RE };
