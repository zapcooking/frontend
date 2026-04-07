import { syllable } from 'syllable';

// Overrides for words the syllable library miscounts
const OVERRIDES: Record<string, number> = {
  poem: 2,
  poems: 2,
  poet: 2,
  poets: 2,
  poetry: 3,
  fluid: 2
};

/**
 * Count syllables in an English word using the `syllable` library
 * with overrides for known miscounts.
 */
export function countSyllables(word: string): number {
  const normalized = word.toLowerCase().trim();
  if (!normalized) return 0;
  if (normalized in OVERRIDES) return OVERRIDES[normalized];
  return Math.max(syllable(normalized), 1);
}

/**
 * Detects haiku text (5-7-5), English-only heuristic.
 * Supports both explicit 3-line format and single-line prose.
 */
export function detectHaiku(text: string): boolean {
  const stripped = text.trim();
  if (!stripped) return false;

  const allWords = stripped.split(/\s+/).filter((word) => /\p{L}/u.test(word));

  if (allWords.length === 0) return false;

  // Exact 3-line check first
  const lines = stripped
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 3) {
    const syllablesPerLine = lines.map((line) => {
      return line
        .split(/\s+/)
        .filter((word) => /\p{L}/u.test(word))
        .reduce((sum, word) => {
          const lettersOnly = Array.from(word)
            .filter((char) => /\p{L}/u.test(char))
            .join('');
          return sum + countSyllables(lettersOnly);
        }, 0);
    });

    if (
      syllablesPerLine.length === 3 &&
      syllablesPerLine[0] === 5 &&
      syllablesPerLine[1] === 7 &&
      syllablesPerLine[2] === 5
    ) {
      return true;
    }
  }

  // Prose check: total must be 17 and breakpoints at 5 and 12
  const syllables = allWords.map((word) => {
    const lettersOnly = Array.from(word)
      .filter((char) => /\p{L}/u.test(char))
      .join('');
    return countSyllables(lettersOnly);
  });

  const total = syllables.reduce((sum, s) => sum + s, 0);
  if (total !== 17) return false;

  let cumulative = 0;
  let firstBreak = false;
  let secondBreak = false;

  for (const syllableCount of syllables) {
    cumulative += syllableCount;
    if (cumulative === 5 && !firstBreak) firstBreak = true;
    else if (cumulative === 12 && firstBreak) secondBreak = true;
  }

  return firstBreak && secondBreak;
}
