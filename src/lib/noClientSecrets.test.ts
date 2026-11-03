/**
 * Guard: no server credential may be compiled into client-reachable code.
 *
 * A pantry API secret once lived as a string literal in a +page.svelte and
 * shipped in a public immutable chunk for nine months. Every .svelte file and
 * every non-server .ts module under src/ is bundled for the browser, so any
 * long hex/base64 literal assigned to a SECRET/API_KEY/TOKEN-style name there
 * is a leak by construction. Server-only modules (*.server.ts, +server.ts,
 * +page.server.ts, +layout.server.ts, hooks.server.ts) are exempt: they may
 * read secrets from env, and are not shipped to clients.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const SERVER_ONLY = /(\.server\.ts|\+server\.ts|hooks\.server\.ts)$/;
const CLIENT_SOURCE = /\.(svelte|ts)$/;
const LITERAL_SECRET =
  /\b[A-Za-z_]*(SECRET|API_KEY|APIKEY|PRIVATE_KEY|PRIVKEY|BEARER|TOKEN)[A-Za-z_]*\s*[:=]\s*['"`]([0-9a-f]{32,}|[A-Za-z0-9+/=_-]{40,})['"`]/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (CLIENT_SOURCE.test(name) && !SERVER_ONLY.test(name) && !name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

describe('client bundle contains no credential literals', () => {
  it('has no SECRET/API_KEY/TOKEN-named string literal that looks like a credential', () => {
    const hits: string[] = [];
    for (const file of walk(ROOT)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(LITERAL_SECRET)) {
        // Allow-list: identifiers whose VALUE is a storage/cache key name, not a credential,
        // and public identifiers (e.g. a bech32 token id) that merely contain TOKEN in the name.
        if (/_KEY\s*[:=]\s*['"`][a-z_]+(:[a-z_]+)*['"`]/.test(m[0])) continue;
        if (/IDENTIFIER|_ID\b/.test(m[0]) || /['"`](btkn|npub|note|nevent|naddr|nprofile)1/.test(m[0])) continue;
        const line = text.slice(0, m.index).split('\n').length;
        hits.push(`${relative(ROOT, file)}:${line} ${m[0].slice(0, 40)}…`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('the page that once embedded the pantry API secret is gone', () => {
    expect(existsSync(join(ROOT, 'routes/membership/test-relay-access'))).toBe(false);
  });
});
