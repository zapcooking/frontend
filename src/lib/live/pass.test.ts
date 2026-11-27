import { describe, it, expect } from 'vitest';
import { issuePass, verifyPass, LIVE_PASS_TTL_SECONDS } from './pass.server';

const SECRET = 'test-secret';
const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const NOW = 1_800_000_000;

describe('rejoin pass', () => {
  it('verifies a pass it issued, for the same session, before it expires', async () => {
    const pass = await issuePass(SECRET, A, NOW);
    expect(pass).toMatch(/^\d{10}\.[A-Za-z0-9_-]{43}$/);
    expect(await verifyPass(SECRET, A, pass, NOW)).toBe(true);
    expect(await verifyPass(SECRET, A, pass, NOW + LIVE_PASS_TTL_SECONDS - 1)).toBe(true);
  });

  it('refuses it once expired', async () => {
    const pass = await issuePass(SECRET, A, NOW);
    expect(await verifyPass(SECRET, A, pass, NOW + LIVE_PASS_TTL_SECONDS)).toBe(false);
  });

  it('refuses it for another session or under another secret', async () => {
    const pass = await issuePass(SECRET, A, NOW);
    expect(await verifyPass(SECRET, B, pass, NOW)).toBe(false);
    expect(await verifyPass('other-secret', A, pass, NOW)).toBe(false);
  });

  it('refuses a changed expiry, a changed signature, and junk', async () => {
    const pass = await issuePass(SECRET, A, NOW);
    const [expiry, sig] = pass.split('.');
    expect(await verifyPass(SECRET, A, `${Number(expiry) + 60}.${sig}`, NOW)).toBe(false);
    const flipped = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
    expect(await verifyPass(SECRET, A, `${expiry}.${flipped}`, NOW)).toBe(false);
    for (const junk of [
      null,
      '',
      'x',
      `${expiry}.`,
      `${expiry}.!!!!`,
      `${expiry}.${sig}.x`,
      'a'.repeat(500)
    ]) {
      expect(await verifyPass(SECRET, A, junk, NOW)).toBe(false);
    }
  });

  it('refuses an expiry further out than a pass is ever issued for', async () => {
    const pass = await issuePass(SECRET, A, NOW + 10 * LIVE_PASS_TTL_SECONDS);
    expect(await verifyPass(SECRET, A, pass, NOW)).toBe(false);
  });
});
