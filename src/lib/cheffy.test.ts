import { describe, it, expect } from 'vitest';
import {
  looksLikeStructuredRecipe,
  pickLine,
  setCheffyPrompt,
  consumeCheffyPrompt,
  CHEFFY_PROMPT_KEY,
  CHEFFY_PROMPT_MAX_AGE_MS
} from './cheffy';

describe('looksLikeStructuredRecipe', () => {
  const fullRecipe = `# Garlic Butter Pasta

A quick, forgiving weeknight pasta.

## Details
⏲️ Prep time: 5 min
🍳 Cook time: 15 min
🍽️ Servings: 2

## Ingredients
- 200g spaghetti
- 3 cloves garlic

## Directions
1. Boil the pasta.
2. Toss with garlic butter.

## Chef's notes
- Swap in chili flakes for heat.`;

  it('returns true for a complete structured recipe', () => {
    expect(looksLikeStructuredRecipe(fullRecipe)).toBe(true);
  });

  it('returns false for a conversational answer', () => {
    expect(
      looksLikeStructuredRecipe(
        "You can absolutely swap yogurt for sour cream — it's a little tangier but works great in most dishes."
      )
    ).toBe(false);
  });

  it('returns false when only an ingredients section is present', () => {
    expect(looksLikeStructuredRecipe('# Idea\n\n## Ingredients\n- eggs\n- cheese')).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(looksLikeStructuredRecipe('')).toBe(false);
  });
});

describe('pickLine', () => {
  it('returns the only line for single-entry pools', () => {
    expect(pickLine(['only'])).toBe('only');
  });

  it('returns an empty string for an empty pool', () => {
    expect(pickLine([])).toBe('');
  });

  it('never returns the avoided line and always returns a pool member', () => {
    const pool = ['a', 'b', 'c', 'd'];
    for (let i = 0; i < 200; i++) {
      const result = pickLine(pool, 'b');
      expect(pool).toContain(result);
      expect(result).not.toBe('b');
    }
  });
});

describe('Cheffy prompt handoff', () => {
  // Minimal in-memory sessionStorage stub (node test env has none).
  function installStorage() {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k)
      }
    });
  }

  it('round-trips a prompt and consumes it once', () => {
    installStorage();
    setCheffyPrompt('What goes well with salmon?');
    expect(consumeCheffyPrompt()).toBe('What goes well with salmon?');
    // Single-use: a second read is empty.
    expect(consumeCheffyPrompt()).toBe(null);
  });

  it('ignores blank prompts', () => {
    installStorage();
    setCheffyPrompt('   ');
    expect(consumeCheffyPrompt()).toBe(null);
  });

  it('drops a stale handoff beyond the freshness window', () => {
    installStorage();
    sessionStorage.setItem(
      CHEFFY_PROMPT_KEY,
      JSON.stringify({ prompt: 'old idea', at: Date.now() - (CHEFFY_PROMPT_MAX_AGE_MS + 1000) })
    );
    expect(consumeCheffyPrompt()).toBe(null);
  });
});
