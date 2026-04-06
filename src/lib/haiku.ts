const EXACT_SYLLABLE_OVERRIDES: Record<string, number> = {
  liked: 1
};

/**
 * Count syllables in an English word using a vowel-group heuristic.
 * Not perfect, but useful for detecting likely 5-7-5 structure.
 */
export function countSyllables(word: string): number {
  const normalized = word.toLowerCase().trim();
  if (!normalized) return 0;
  if (normalized in EXACT_SYLLABLE_OVERRIDES) return EXACT_SYLLABLE_OVERRIDES[normalized];
  if (normalized.length <= 2) return 1;

  const vowels = 'aeiouy';
  let count = 0;
  let prevVowel = false;

  for (const char of normalized) {
    const isVowel = vowels.includes(char);
    if (isVowel && !prevVowel) count += 1;
    prevVowel = isVowel;
  }

  // Silent trailing e (e.g. "make", "rice")
  if (normalized.endsWith('e') && count > 1) count -= 1;

  // Plural -es is often silent (e.g. "leaves", "waves") but pronounced as
  // a syllable after sibilants (e.g. "roses", "changes", "boxes").
  if (
    normalized.endsWith('es') &&
    count > 1 &&
    !/(?:sh|ch|[szxgc])es$/i.test(normalized)
  ) {
    count -= 1;
  }

  // Many past-tense words ending in -ed keep the "e" silent (e.g. "liked").
  // Exclude cases where the ending is typically pronounced as its own syllable.
  if (
    normalized.endsWith('ed') &&
    count > 1 &&
    normalized.length > 3 &&
    !normalized.endsWith('ted') &&
    !normalized.endsWith('ded')
  ) {
    count -= 1;
  }

  // -le ending counts as a syllable when preceded by a consonant (e.g. "little")
  if (
    normalized.endsWith('le') &&
    normalized.length > 2 &&
    !vowels.includes(normalized[normalized.length - 3])
  ) {
    count += 1;
  }

  return Math.max(count, 1);
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
