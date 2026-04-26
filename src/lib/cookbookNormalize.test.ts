/**
 * Tests for the cookbook content normalization layer.
 *
 * These lock in the contract between raw recipe input (the markdown
 * users write on relays) and the print-ready data shape the PDF
 * renderer consumes. They exist so that future iteration on the PDF
 * layout can't silently regress the formatting cleanup.
 *
 * Scope is the normalizer only — no PDF rendering, no jsPDF, no UI.
 */

import { describe, it, expect } from 'vitest';
import type { NDKEvent } from '@nostr-dev-kit/ndk';
import {
  cleanDirectionLine,
  cleanIngredientLine,
  cleanNotesBlock,
  cleanNotesIntoParagraphs,
  isPlaceholderDirection,
  normalizeRecipeForCookbook,
  stripDuplicateRecipeBlocks,
  stripMarkdownFormatting
} from './cookbookNormalize';

/**
 * Build a minimal NDKEvent-shaped object from a recipe markdown string
 * + tag list. Only the fields the normalizer reads are populated.
 */
function makeRecipeEvent(opts: {
  pubkey?: string;
  kind?: number;
  content: string;
  tags?: string[][];
}): NDKEvent {
  return {
    kind: opts.kind ?? 30023,
    pubkey: opts.pubkey ?? 'a'.repeat(64),
    content: opts.content,
    tags: opts.tags ?? [],
    id: 'test-event-id',
    sig: '',
    created_at: 0
  } as unknown as NDKEvent;
}

// ─── Phase 2: markdown cleanup ────────────────────────────────

describe('stripMarkdownFormatting', () => {
  it('strips bold (**)', () => {
    expect(stripMarkdownFormatting('**Optional** flaky salt')).toBe('Optional flaky salt');
  });

  it('strips bold (__)', () => {
    expect(stripMarkdownFormatting('__Optional__ flaky salt')).toBe('Optional flaky salt');
  });

  it('strips italic (*)', () => {
    expect(stripMarkdownFormatting('use *good* olive oil')).toBe('use good olive oil');
  });

  it('strips inline code', () => {
    expect(stripMarkdownFormatting('run `pnpm test` first')).toBe('run pnpm test first');
  });

  it('strips strikethrough', () => {
    expect(stripMarkdownFormatting('~~deprecated~~ ingredient')).toBe('deprecated ingredient');
  });

  it('strips heading markers', () => {
    expect(stripMarkdownFormatting('## Ingredients')).toBe('Ingredients');
    expect(stripMarkdownFormatting('### Notes')).toBe('Notes');
  });

  it('unwraps non-localhost links to their label', () => {
    expect(stripMarkdownFormatting('[Bitcoin Beans](https://example.com)')).toBe('Bitcoin Beans');
  });

  it('drops localhost links entirely (label + URL)', () => {
    expect(stripMarkdownFormatting('[demo](http://localhost:5173/recipe/123)')).toBe('');
    expect(stripMarkdownFormatting('[x](http://127.0.0.1:8080)')).toBe('');
    expect(stripMarkdownFormatting('[y](http://0.0.0.0/test)')).toBe('');
  });

  it('drops bare localhost URLs', () => {
    expect(stripMarkdownFormatting('see http://127.0.0.1:8080/test for details')).toBe(
      'see for details'
    );
    expect(stripMarkdownFormatting('http://localhost:5173/recipe/123')).toBe('');
  });

  it('collapses double-dashes to a single hyphen', () => {
    expect(stripMarkdownFormatting('Cook for 1--2 minutes')).toBe('Cook for 1-2 minutes');
  });

  it('collapses internal whitespace but preserves newlines', () => {
    expect(stripMarkdownFormatting('a   b\n\nc   d')).toBe('a b\n\nc d');
  });

  it('preserves blank-line paragraph breaks', () => {
    const input = 'first paragraph\n\nsecond paragraph';
    expect(stripMarkdownFormatting(input)).toBe(input);
  });

  it('collapses 3+ blank lines to a single blank line', () => {
    expect(stripMarkdownFormatting('first\n\n\n\nsecond')).toBe('first\n\nsecond');
  });

  it('preserves snake_case identifiers (italic _ should not match)', () => {
    expect(stripMarkdownFormatting('use my_secret_sauce variable')).toBe('use my_secret_sauce variable');
  });

  it('handles empty / nullish input', () => {
    expect(stripMarkdownFormatting('')).toBe('');
    expect(stripMarkdownFormatting(undefined as unknown as string)).toBe('');
  });
});

// ─── Phase 3: ingredient cleaning ─────────────────────────────

describe('cleanIngredientLine', () => {
  it('strips leading dash bullets', () => {
    expect(cleanIngredientLine('- 1 cup sugar')).toBe('1 cup sugar');
  });

  it('strips leading bullet character', () => {
    expect(cleanIngredientLine('• 2 eggs')).toBe('2 eggs');
  });

  it('strips leading asterisk bullets', () => {
    expect(cleanIngredientLine('* 1 tbsp olive oil')).toBe('1 tbsp olive oil');
  });

  it('trims surrounding whitespace and collapses internal whitespace', () => {
    expect(cleanIngredientLine('  - 3 tbsp   honey  ')).toBe('3 tbsp honey');
  });

  it('strips leading numeric prefix when present', () => {
    expect(cleanIngredientLine('1. flour')).toBe('flour');
    expect(cleanIngredientLine('1) flour')).toBe('flour');
  });

  it('strips inline markdown emphasis', () => {
    expect(cleanIngredientLine('- **Optional** flaky salt')).toBe('Optional flaky salt');
  });

  it('drops localhost link wrappers', () => {
    expect(cleanIngredientLine('- [demo](http://localhost:5173) cinnamon')).toBe('cinnamon');
  });
});

// ─── Phase 4: direction cleaning ──────────────────────────────

describe('cleanDirectionLine', () => {
  it('strips leading numeric prefix (period)', () => {
    expect(cleanDirectionLine('1. Mix ingredients')).toBe('Mix ingredients');
  });

  it('strips leading numeric prefix (paren)', () => {
    expect(cleanDirectionLine('  2) Bake at 350')).toBe('Bake at 350');
  });

  it('strips leading bullet markers', () => {
    expect(cleanDirectionLine('- Whisk thoroughly')).toBe('Whisk thoroughly');
    expect(cleanDirectionLine('• Set aside to rest')).toBe('Set aside to rest');
  });

  it('strips inline markdown emphasis', () => {
    expect(cleanDirectionLine('1. Add **half** the sugar')).toBe('Add half the sugar');
  });

  it('preserves natural sentence content', () => {
    const sentence = 'Combine the flour and salt, then whisk until smooth.';
    expect(cleanDirectionLine(sentence)).toBe(sentence);
  });
});

// ─── Phase 5: placeholder detection ───────────────────────────

describe('isPlaceholderDirection', () => {
  const placeholders = ['See above', 'see above', 'See above.', 'N/A', 'na', 'TBD', 'To do', 'Same as above'];
  for (const s of placeholders) {
    it(`detects placeholder: ${s}`, () => {
      expect(isPlaceholderDirection(s)).toBe(true);
    });
  }

  it('does not flag legitimate one-liners that contain placeholder words', () => {
    expect(isPlaceholderDirection('See above for the dressing instructions')).toBe(false);
    expect(isPlaceholderDirection('Mix and bake at 350')).toBe(false);
  });

  it('does not flag long content even if it starts like a placeholder', () => {
    expect(
      isPlaceholderDirection('See above — also pre-warm the oven before mixing')
    ).toBe(false);
  });
});

// ─── Phase 6: duplicate block removal ─────────────────────────

describe('stripDuplicateRecipeBlocks', () => {
  const notesWithSubBlocks = [
    'Some intro text from the chef.',
    '',
    '## Ingredients',
    '- sugar',
    '- flour',
    '',
    '## Directions',
    '1. Mix',
    '2. Bake',
    '',
    'Closing thought.'
  ].join('\n');

  it('removes embedded ## Ingredients block when structured ingredients exist', () => {
    const out = stripDuplicateRecipeBlocks(notesWithSubBlocks, true, false);
    expect(out).not.toMatch(/##\s*Ingredients/i);
    expect(out).not.toMatch(/sugar/i);
  });

  it('removes embedded ## Directions block when structured directions exist', () => {
    const out = stripDuplicateRecipeBlocks(notesWithSubBlocks, false, true);
    expect(out).not.toMatch(/##\s*Directions/i);
    expect(out).not.toMatch(/Bake/i);
  });

  it('removes both when both structured sections exist', () => {
    const out = stripDuplicateRecipeBlocks(notesWithSubBlocks, true, true);
    expect(out).not.toMatch(/##\s*Ingredients/i);
    expect(out).not.toMatch(/##\s*Directions/i);
    // Surrounding chef prose survives.
    expect(out).toContain('Some intro text from the chef.');
    expect(out).toContain('Closing thought.');
  });

  it('also removes ## Steps and ## Method aliases', () => {
    const withMethod = '## Method\n1. Mix\n2. Bake\n\nNote.';
    const out = stripDuplicateRecipeBlocks(withMethod, false, true);
    expect(out).not.toMatch(/##\s*Method/i);
    expect(out).toContain('Note.');
  });

  it('preserves notes-only recipes (no structured sections)', () => {
    const out = stripDuplicateRecipeBlocks(notesWithSubBlocks, false, false);
    expect(out).toBe(notesWithSubBlocks);
  });

  it('does not terminate early at letter Z (regression — JS has no \\Z anchor)', () => {
    const notes = [
      '## Ingredients',
      '- Zucchini',
      '- Zaatar',
      '- Zinc supplement'
    ].join('\n');
    const out = stripDuplicateRecipeBlocks(notes, true, false);
    // The whole block should be gone, including the Z-prefixed items.
    expect(out).not.toMatch(/Zucchini|Zaatar|Zinc/);
  });
});

// ─── Phase 7: end-to-end normalization ────────────────────────

describe('normalizeRecipeForCookbook', () => {
  it('cleans ingredients and directions, drops markdown, removes duplicate blocks', () => {
    const content = [
      '## Details',
      '- ⏲️ Prep time: 10 minutes',
      '- 🍳 Cook time: 30 minutes',
      '- 🍽️ Servings: 4',
      '',
      '## Ingredients',
      '- **2 cups** flour',
      '- 1 cup [Bitcoin Beans](https://example.com/beans)',
      '- 3 tbsp [demo](http://localhost:5173) honey',
      '',
      '## Directions',
      '1. Mix all ingredients',
      '2. Bake for 1--2 hours at 350F',
      '',
      "## Chef's notes",
      'A short note about the recipe.',
      '',
      '## Ingredients',
      '- duplicate sub-block',
      '',
      '## Directions',
      '1. duplicate sub-step'
    ].join('\n');

    const event = makeRecipeEvent({
      content,
      tags: [
        ['title', '**Test** Recipe'],
        ['d', 'test-recipe'],
        ['image', 'https://example.com/img.jpg']
      ]
    });

    const recipe = normalizeRecipeForCookbook(event, 'Alice');

    expect(recipe.title).toBe('Test Recipe');
    expect(recipe.image).toBe('https://example.com/img.jpg');
    expect(recipe.creatorName).toBe('Alice');
    expect(recipe.servings).toBe('4');
    expect(recipe.prepTime).toBe('10 minutes');
    expect(recipe.cookTime).toBe('30 minutes');

    // Ingredient line cleanup: bold stripped, link unwrapped, localhost dropped.
    expect(recipe.ingredients).toEqual([
      '2 cups flour',
      '1 cup Bitcoin Beans',
      '3 tbsp honey'
    ]);

    // Direction cleanup: numeric prefix stripped, double-dash collapsed.
    expect(recipe.directions).toEqual([
      'Mix all ingredients',
      'Bake for 1-2 hours at 350F'
    ]);

    // Notes survive but the duplicate Ingredients/Directions sub-blocks
    // that followed Chef's notes are gone.
    expect(recipe.chefNotes).toBeTruthy();
    expect(recipe.chefNotes!).not.toMatch(/duplicate sub-block/);
    expect(recipe.chefNotes!).not.toMatch(/duplicate sub-step/);
    expect(recipe.chefNotes!).toContain('A short note about the recipe.');
  });

  it('drops a single-placeholder direction set so the renderer can show the fallback', () => {
    const content = [
      '## Ingredients',
      '- 1 cup sugar',
      '',
      '## Directions',
      '1. See above'
    ].join('\n');

    const event = makeRecipeEvent({
      content,
      tags: [['title', 'Placeholder Recipe']]
    });

    const recipe = normalizeRecipeForCookbook(event);
    expect(recipe.ingredients).toEqual(['1 cup sugar']);
    expect(recipe.directions).toEqual([]);
  });

  it('strips embedded ## Directions block from notes even when filtered list is empty', () => {
    // Regression for the placeholder-vs-notes interaction: the parsed
    // directions had content (so notes cleanup should run), but the
    // post-filter directions array is empty.
    const content = [
      '## Ingredients',
      '- 1 cup sugar',
      '',
      '## Directions',
      '1. See above',
      '',
      "## Chef's notes",
      'Real notes here.',
      '',
      '## Directions',
      '1. duplicate sub-step that should be stripped'
    ].join('\n');

    const event = makeRecipeEvent({ content, tags: [['title', 'X']] });
    const recipe = normalizeRecipeForCookbook(event);

    expect(recipe.directions).toEqual([]);
    expect(recipe.chefNotes).toBeTruthy();
    expect(recipe.chefNotes!).not.toMatch(/duplicate sub-step/);
    expect(recipe.chefNotes!).toContain('Real notes here.');
  });
});

// ─── Phase 8: edge cases ──────────────────────────────────────

describe('normalizeRecipeForCookbook — edge cases', () => {
  it('handles empty content without crashing', () => {
    const event = makeRecipeEvent({ content: '', tags: [['title', 'Empty']] });
    const recipe = normalizeRecipeForCookbook(event);
    expect(recipe.title).toBe('Empty');
    expect(recipe.ingredients).toEqual([]);
    expect(recipe.directions).toEqual([]);
    expect(recipe.chefNotes).toBeUndefined();
  });

  it('handles missing title tag (falls back to d-tag)', () => {
    const event = makeRecipeEvent({ content: '', tags: [['d', 'fallback-d']] });
    expect(normalizeRecipeForCookbook(event).title).toBe('fallback-d');
  });

  it('handles fully missing title/d tags (falls back to "Untitled recipe")', () => {
    // Title resolution is title-tag → d-tag → "Untitled recipe". The
    // event.id fallback is for the recipe ID only, not the printable
    // title — so empty tags always surface "Untitled recipe" regardless
    // of whether the event has an id.
    const event = makeRecipeEvent({ content: '', tags: [] });
    expect(normalizeRecipeForCookbook(event).title).toBe('Untitled recipe');
  });

  it('handles malformed markdown without throwing', () => {
    const malformed = '** unmatched bold *italic without close [link with no close';
    const event = makeRecipeEvent({
      content: `## Chef's notes\n${malformed}`,
      tags: [['title', 'Malformed']]
    });
    // Just needs to not throw and produce a string.
    const recipe = normalizeRecipeForCookbook(event);
    expect(typeof (recipe.chefNotes ?? '')).toBe('string');
  });

  it('handles notes-only recipes (no structured sections)', () => {
    const event = makeRecipeEvent({
      content: "## Chef's notes\nJust some thoughts about cooking.",
      tags: [['title', 'Notes Only']]
    });
    const recipe = normalizeRecipeForCookbook(event);
    expect(recipe.ingredients).toEqual([]);
    expect(recipe.directions).toEqual([]);
    expect(recipe.chefNotes).toContain('Just some thoughts about cooking.');
  });
});

// ─── Phase 10: paragraph handling ─────────────────────────────

describe('cleanNotesIntoParagraphs', () => {
  it('returns one entry per blank-line-separated paragraph', () => {
    const notes = 'first paragraph.\n\nsecond paragraph.';
    expect(cleanNotesIntoParagraphs(notes, false, false)).toEqual([
      'first paragraph.',
      'second paragraph.'
    ]);
  });

  it('strips markdown but preserves paragraph breaks', () => {
    const notes = '**Note 1**: do this.\n\n*Note 2*: do that.';
    expect(cleanNotesIntoParagraphs(notes, false, false)).toEqual([
      'Note 1: do this.',
      'Note 2: do that.'
    ]);
  });

  it('drops empty paragraphs (whitespace-only or after stripping)', () => {
    const notes = 'first.\n\n   \n\n[demo](http://localhost:5173)\n\nsecond.';
    expect(cleanNotesIntoParagraphs(notes, false, false)).toEqual(['first.', 'second.']);
  });

  it('still removes duplicate Ingredients/Directions blocks', () => {
    const notes = [
      'Intro paragraph.',
      '',
      '## Ingredients',
      '- sugar',
      '',
      'Closing paragraph.'
    ].join('\n');
    const paragraphs = cleanNotesIntoParagraphs(notes, true, false);
    expect(paragraphs).toContain('Intro paragraph.');
    expect(paragraphs).toContain('Closing paragraph.');
    expect(paragraphs.some((p) => /Ingredients|sugar/i.test(p))).toBe(false);
  });

  it('returns empty array for undefined / empty notes', () => {
    expect(cleanNotesIntoParagraphs(undefined, false, false)).toEqual([]);
    expect(cleanNotesIntoParagraphs('', false, false)).toEqual([]);
    expect(cleanNotesIntoParagraphs('   \n\n  ', false, false)).toEqual([]);
  });
});

describe('cleanNotesBlock', () => {
  it("preserves the `\\n\\n` separators in its string output", () => {
    const notes = 'first.\n\nsecond.\n\nthird.';
    const cleaned = cleanNotesBlock(notes, false, false);
    // The exact separator: blank line between paragraphs.
    expect(cleaned).toContain('first.\n\nsecond.');
    expect(cleaned).toContain('second.\n\nthird.');
  });

  it('returns empty string for undefined input', () => {
    expect(cleanNotesBlock(undefined, false, false)).toBe('');
  });
});

describe('normalizeRecipeForCookbook — paragraph-aware notes', () => {
  it('joins paragraphs with `\\n\\n` so the renderer can split + space them', () => {
    const content = [
      '## Ingredients',
      '- 1 cup sugar',
      '',
      "## Chef's notes",
      'Paragraph one talks about the prep.',
      '',
      'Paragraph two talks about the bake.'
    ].join('\n');

    const event = makeRecipeEvent({ content, tags: [['title', 'X']] });
    const recipe = normalizeRecipeForCookbook(event);

    expect(recipe.chefNotes).toBeDefined();
    const paragraphs = recipe.chefNotes!.split(/\n\s*\n+/);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toContain('prep');
    expect(paragraphs[1]).toContain('bake');
  });
});
