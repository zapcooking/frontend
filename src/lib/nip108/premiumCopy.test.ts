import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Durability-claim tripwire for the premium (Lightning-gated recipe) surface.
 *
 * Four user-facing strings on this surface promised buyers "permanent access", and a
 * fifth promised the author they would "always have access". Deleting a gated recipe
 * replaces the kind-35000 event with a tombstone carrying no 'gated' tag, and
 * checkIfGated() in ./client.ts reads the gated note id off exactly that tag — so a
 * delete severs the buyer's route to what they bought, and the author's too. None of
 * those five claims was ours to make. They were removed alongside the delete-address
 * fix that made them plainly false.
 *
 * This scans DIRECTORIES rather than any one string, so it keeps holding after the
 * strings it was written against are gone and covers files added later.
 *
 * IT IS A TRIPWIRE, NOT A GUARD. The vocabulary below is the set of phrasings we have
 * actually shipped; a durability claim can be made in words that are not in it — the
 * fifth string above was missed by exactly this kind of pattern before a human read the
 * block. A green run means "none of the known phrasings is present", never "no claim of
 * durability is made on this surface".
 *
 * Comments are stripped before matching, so writing up this history in a code comment
 * does not trip it.
 */

const SURFACE_ROOTS = [
  'src/routes/premium',
  'src/routes/create/gated',
  'src/lib/nip108',
  'src/components/GatedRecipePayment.svelte'
];

const DURABILITY_VOCABULARY = /permanent|forever|lifetime|always have access/i;

function collectSourceFiles(target: string): string[] {
  const abs = path.resolve(target);
  if (statSync(abs).isFile()) return [target];
  return readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(child);
    if (!/\.(svelte|ts)$/.test(entry.name)) return [];
    if (entry.name.endsWith('.test.ts')) return [];
    return [child];
  });
}

function stripComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('premium surface makes no durability claim', () => {
  const files = SURFACE_ROOTS.flatMap(collectSourceFiles);

  it('finds the premium surface to scan', () => {
    // Guards against the scan silently covering nothing if these paths move.
    expect(files.length).toBeGreaterThan(3);
    expect(files).toContain('src/components/GatedRecipePayment.svelte');
  });

  // A case per file, built in a loop rather than with it.each — it.each doesn't typecheck
  // under svelte-check's TS setup here, the same limitation noted in
  // routes/api/zappy/note-review/noteReview.test.ts:300.
  for (const file of files) {
    it(`${file} claims nothing about how long access lasts`, () => {
      const offending = stripComments(readFileSync(path.resolve(file), 'utf-8'))
        .split('\n')
        .map((line, i) => ({ line: line.trim(), number: i + 1 }))
        .filter(({ line }) => DURABILITY_VOCABULARY.test(line));

      expect(
        offending.map(({ number, line }) => `${file}:${number} ${line}`),
        'A delete severs buyer and author access, so this surface cannot promise durability'
      ).toEqual([]);
    });
  }
});
