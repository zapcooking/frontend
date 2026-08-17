/**
 * Compile-time regression test for the collection page's derived values.
 *
 * The bug this pins was invisible to every other kind of test. The three
 * functions were correct; the call sites were correct JavaScript; the
 * page rendered without error. What was wrong lived only in the COMPILED
 * output: `$: listTitle = getListTitle();` names no reactive variable, so
 * Svelte compiled it into the instance body rather than into
 * `$$self.$$.update`, and it ran exactly once — at init, with `event`
 * still `null` — leaving the hero showing the `'Collection'` fallback and
 * no cover on a collection that had both.
 *
 * So the assertion has to be about the compiler's output, not about
 * behaviour we can call directly.
 *
 * TRAP, and it is worth reading before editing this file: the obvious
 * implementation — `code.slice(code.indexOf('$$self.$$.update'))` — is a
 * FALSE GREEN. Reactive statements with no dependencies are emitted AFTER
 * the update block, so slicing to end-of-file finds them too and reports
 * every statement as reactive, including the broken ones. It passes on
 * the exact bug it claims to catch. The block has to be brace-matched,
 * and `updatedLabel` below is the control that proves the extractor is
 * discriminating rather than just always-true.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { compile, preprocess } from 'svelte/compiler';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const PAGE = 'src/routes/my-kitchen/[naddr]/+page@.svelte';

/** The body of `$$self.$$.update = () => { … }`, brace-matched. */
function updateBlock(code: string): string {
  const marker = '$$self.$$.update = () => {';
  const start = code.indexOf(marker);
  if (start === -1) return '';
  let depth = 0;
  let i = start + marker.length - 1;
  for (; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return code.slice(start, i + 1);
}

async function compiledUpdateBlock(): Promise<string> {
  const src = readFileSync(PAGE, 'utf8');
  const pre = await preprocess(src, vitePreprocess(), { filename: PAGE });
  const { js } = compile(pre.code, { generate: 'dom', filename: PAGE });
  return updateBlock(js.code);
}

function isRecomputed(block: string, name: string): boolean {
  return new RegExp(`\\b${name} = `).test(block);
}

describe('collection page reactivity', () => {
  it('recomputes title, summary and cover when the list event loads', async () => {
    const block = await compiledUpdateBlock();
    expect(block.length).toBeGreaterThan(0);

    // Each of these must sit inside $$self.$$.update. Outside it, they
    // run once at init and the page renders 'Collection' forever.
    expect(isRecomputed(block, 'listTitle')).toBe(true);
    expect(isRecomputed(block, 'listSummary')).toBe(true);
    expect(isRecomputed(block, 'listImage')).toBe(true);
  });

  it('control: the extractor can tell the two cases apart', async () => {
    const block = await compiledUpdateBlock();

    // `updatedLabel` names `event` directly in its own statement and has
    // always compiled correctly. If this ever reads false the extractor
    // is broken, not the page.
    expect(isRecomputed(block, 'updatedLabel')).toBe(true);

    // And a name that is not a reactive statement at all must not match,
    // or the regex is matching the whole file.
    expect(isRecomputed(block, 'getCollectionTitle')).toBe(false);
  });

  it('control: brace-matching, not slice-to-end', async () => {
    const src = readFileSync(PAGE, 'utf8');
    const pre = await preprocess(src, vitePreprocess(), { filename: PAGE });
    const { js } = compile(pre.code, { generate: 'dom', filename: PAGE });

    // The naive extraction reaches past the block's closing brace. Prove
    // the real one does not, so a future edit cannot quietly restore the
    // false green described at the top of this file.
    const naive = js.code.slice(js.code.indexOf('$$self.$$.update'));
    const matched = updateBlock(js.code);
    expect(matched.length).toBeLessThan(naive.length);
    expect(matched.endsWith('}')).toBe(true);
  });
});
