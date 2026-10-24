/**
 * Guard: coordinates are read with `parseCoordinate`, never by splitting on
 * every colon. A d-tag may contain colons (a URL, or a title such as
 * "Pasta: Weeknight"), and `split(':')` with a three-part check silently
 * dropped those recipes from lists, packs, meal plans and grocery runs.
 *
 * Any `split(':')` (or `split(/:/)`, or with a limit — JS drops the rest)
 * in src/ fails unless its exact line is allow-listed below with a reason.
 * Allow only values that are not coordinates.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const SOURCE = /\.(svelte|ts|js)$/;
const COLON_SPLIT = /\.split\(\s*(?:(['"`]):\1|\/:\/)/;

/** `file: trimmed line` → why it is not a coordinate. */
const ALLOWED: Record<string, string> = {
  'routes/admin/nourish-flags/+page.svelte: const [direction, dimension] = labelValue.split(\':\');':
    'a NIP-32 label value `direction:dimension`, not a coordinate'
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (SOURCE.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

describe('coordinate parsing', () => {
  it('no source splits a value on every colon (use parseCoordinate)', () => {
    const hits: string[] = [];
    const seen = new Set<string>();
    for (const file of walk(ROOT)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (!COLON_SPLIT.test(line)) return;
          const key = `${relative(ROOT, file)}: ${line.trim()}`;
          if (key in ALLOWED) seen.add(key);
          else hits.push(`${relative(ROOT, file)}:${i + 1} ${line.trim()}`);
        });
    }
    expect(hits).toEqual([]);
    // A stale allow-list entry hides nothing; drop it.
    expect(Object.keys(ALLOWED).filter((k) => !seen.has(k))).toEqual([]);
  });
});
