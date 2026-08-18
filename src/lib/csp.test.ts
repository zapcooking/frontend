import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import config from '../../svelte.config.js';

/**
 * The CSP script-src hashes in svelte.config.js are content hashes of the
 * inline scripts in src/app.html. Editing app.html silently invalidates
 * them: under the current report-only policy that means noise, and after
 * enforcement it means the theme bootstrap and fetch interceptor stop
 * running in production.
 *
 * SvelteKit hashes only the script it injects itself, so nothing else
 * catches this. These tests do.
 */

function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const [, attrs, body] = m;
    if (attrs.includes('src=')) continue; // external, covered by 'self'
    if (!body.trim()) continue;
    hashes.push(`sha256-${createHash('sha256').update(body).digest('base64')}`);
  }
  return hashes;
}

const scriptSrc: string[] = (config as any).kit.csp.reportOnly['script-src'];
const appHtml = readFileSync(new URL('../app.html', import.meta.url), 'utf-8');

describe('CSP script-src hashes match src/app.html', () => {
  it('declares a hash for every inline script in app.html', () => {
    for (const hash of inlineScriptHashes(appHtml)) {
      expect(scriptSrc).toContain(hash);
    }
  });

  it('has no stale hashes left over from removed scripts', () => {
    const actual = new Set(inlineScriptHashes(appHtml));
    for (const entry of scriptSrc.filter((s) => s.startsWith('sha256-'))) {
      expect(actual).toContain(entry);
    }
  });
});

describe('CSP policy shape', () => {
  it('is report-only — enforcing is a separate, deliberate change', () => {
    expect((config as any).kit.csp.reportOnly).toBeDefined();
    expect((config as any).kit.csp.directives).toBeUndefined();
  });

  it('has a report target, which report-only cannot be served without', () => {
    expect((config as any).kit.csp.reportOnly['report-uri']).toEqual(['/api/csp-report']);
  });

  it('locks down the directives an XSS would reach for', () => {
    const p = (config as any).kit.csp.reportOnly;
    expect(p['object-src']).toEqual(['none']);
    expect(p['base-uri']).toEqual(['self']);
    expect(p['form-action']).toEqual(['self']);
    // No 'unsafe-inline' / 'unsafe-eval' in script-src — that would make
    // the whole policy decorative.
    expect(p['script-src']).not.toContain('unsafe-inline');
    expect(p['script-src']).not.toContain('unsafe-eval');
  });
});
