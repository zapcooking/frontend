import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { identifyPhotoFormat } from './photoAsk';
import {
  looksLikeStructuredRecipe,
  pickLine,
  setCheffyPrompt,
  consumeCheffyPrompt,
  CHEFFY_PROMPT_KEY,
  CHEFFY_PROMPT_MAX_AGE_MS,
  photoFormatLine
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

// ---------------------------------------------------------------------------
// Pick-time format rejection copy
// ---------------------------------------------------------------------------

describe('photoFormatLine', () => {
  it('names HEIC when the browser independently guessed it', () => {
    // The noun is diagnosis, not a list item — it is the one fact that
    // converts into an action outside our product.
    for (const type of ['image/heic', 'image/heif', 'IMAGE/HEIC', 'image/heic-sequence']) {
      expect(photoFormatLine(type)).toBe(
        "Cheffy reads JPG, PNG, and WEBP — that one's a HEIC. Try another photo?"
      );
    }
  });

  it('claims nothing about the file when the type does not agree', () => {
    // The byte gate catches HEIC bytes in a file named .jpg, where
    // file.type is image/jpeg. Naming a format here would contradict the
    // filename the member is looking at.
    for (const type of ['image/jpeg', 'application/pdf', '', 'text/plain']) {
      expect(photoFormatLine(type)).toBe(
        "Cheffy doesn't recognize that file — it reads JPG, PNG, and WEBP. Try another photo?"
      );
    }
  });

  it('does not read like the server IMAGE_UNREADABLE line', () => {
    // The gate is a narrowing, not a guarantee, so a photo can fail here
    // OR at the model — instantly and for free, or after a signer
    // approval, an upload and a wait with no Try again button. A member
    // who reads the same sentence at both moments learns nothing from
    // the second, which is the expensive one.
    const server = readFileSync('src/routes/api/zappy/ask-photo/+server.ts', 'utf8');
    const unreadable = "Cheffy couldn't get a good look at that photo. Try another one?";
    expect(server, 'the live server line moved — re-check both wordings together').toContain(
      unreadable
    );
    for (const type of ['image/heic', 'image/jpeg']) {
      expect(photoFormatLine(type)).not.toBe(unreadable);
      // "couldn't read"/"couldn't get a look" is the server's register.
      // At pick time Cheffy has read nothing: sixteen bytes matched no
      // signature.
      expect(/couldn't (read|get)/.test(photoFormatLine(type))).toBe(false);
    }
  });

  it('leaves GIF out of the sentence while the gate still accepts it', () => {
    // A rejection message is advice, not a specification. This string
    // renders only when no signature matched, and every GIF matches
    // GIF8 — so no GIF holder, animated or still, can ever read it.
    // Listing GIF would spend a clause on a format its reader does not
    // have. Do not sync this list to the gate.
    for (const type of ['image/heic', 'image/jpeg']) {
      expect(/gif/i.test(photoFormatLine(type))).toBe(false);
    }
    expect(identifyPhotoFormat(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBe('image/gif');
  });
});

/**
 * Wiring guard for the pick-time gate.
 *
 * Neither Cheffy surface is unit-testable — this repo has no component
 * render harness — so this reads the source. It is a tripwire, not a
 * proof: it can only see that the handlers call the byte gate, never
 * that they call it on the right file.
 */
describe('the Cheffy photo inputs gate on bytes, not on file.type', () => {
  const FILES = ['src/components/CheffyMessenger.svelte', 'src/routes/cheffy/+page.svelte'];

  for (const file of FILES) {
    it(`${file} gates every picked file through identifyPhotoFile`, () => {
      const source = readFileSync(file, 'utf8');
      // Two handlers per file: ask and scan.
      expect(source.match(/await identifyPhotoFile\(file\)/g)?.length).toBe(2);
      expect(source).toContain('photoFormatLine(file.type)');
      // file.type is the browser's guess, derived from the filename. It
      // names what failed; it must not decide.
      expect(source).not.toContain("file.type.startsWith('image/')");
    });

    it(`${file} keeps accept wide — it is a hint to a picker we do not ship`, () => {
      const source = readFileSync(file, 'utf8');
      const accepts = source.match(/accept=[^\s>]+/g) ?? [];
      expect(accepts.length).toBeGreaterThan(0);
      for (const attr of accepts) {
        expect(attr).toBe('accept="image/*"');
      }
    });
  }
});
