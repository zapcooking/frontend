import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bucket, casefold, charGrams, load, score, scorable, wordGrams } from './nspam';

// nspam.ts against the model's own reference cases (src/test/fixtures/nspam, from the model
// repository at the revision Sidecar's scripts/build-nspam-model.py pins): the hashing token by
// token, and fifty real bundles of replies with the scores the trained pipeline gave them. A
// port that drifts from the pipeline anywhere, in a regular expression's idea of a space or in a
// tree's comparison, moves a score here.

const ROOT = resolve(__dirname, '../../..');
const lines = (f: string) =>
  readFileSync(resolve(ROOT, 'src/test/fixtures/nspam', f), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
const bin = readFileSync(resolve(ROOT, 'static/models/nspam.bin'));
const MODEL = load(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.length) as ArrayBuffer);

// Signed counts per bucket, sorted by bucket, as the fixtures list them.
function buckets(grams: string[]) {
  const m = new Map<number, number>();
  for (const g of grams) {
    const { index, sign } = bucket(g);
    m.set(index, (m.get(index) || 0) + sign);
  }
  return [...m]
    .filter(([, v]) => v)
    .sort((a, b) => a[0] - b[0])
    .map(([index, value]) => ({ index, value }));
}

describe('nspam model parity', () => {
  it('every token hashes to the buckets and signs scikit-learn gives it', () => {
    const cases = lines('hash_fixtures.jsonl');
    expect(cases.length).toBeGreaterThanOrEqual(10);
    for (const c of cases) {
      // The fixtures list at most 32 buckets, the lowest first.
      const sorted = (a: { index: number; value: number }[]) =>
        a.slice().sort((x, y) => x.index - y.index);
      expect(buckets(wordGrams(c.token)).slice(0, 32)).toEqual(sorted(c.word_buckets));
      expect(buckets(charGrams(c.token)).slice(0, 32)).toEqual(sorted(c.char_wb_buckets));
    }
  });

  it('EVERY REFERENCE BUNDLE SCORES WHAT THE TRAINED MODEL GAVE IT', () => {
    const cases = lines('parity_fixtures.jsonl');
    expect(cases.length).toBe(50);
    for (const [i, c] of cases.entries()) {
      const r = score(MODEL, c.notes);
      const rel = Math.abs(r!.raw - c.expected_raw_score) / Math.max(1e-12, c.expected_raw_score);
      expect(
        rel,
        `case ${i + 1}: raw ${r!.raw}, the model gave ${c.expected_raw_score}`
      ).toBeLessThan(1e-9);
      expect(
        Math.abs(r!.score - c.expected_calibrated_score),
        `case ${i + 1}: calibrated ${r!.score}, expected ${c.expected_calibrated_score}`
      ).toBeLessThan(1e-9);
    }
  });

  it('the bots in the reference set score as bots, and the people as people', () => {
    // Not a test of the model's quality, which is its authors' to state: a check that the
    // labels and the scores line up the way the fixtures say, so a sign flipped somewhere in
    // the port cannot pass by matching numbers it inverted.
    const cases = lines('parity_fixtures.jsonl');
    const right = cases.filter(
      (c) => score(MODEL, c.notes)!.score >= 0.5 === (c.label === 1)
    ).length;
    expect(right).toBeGreaterThanOrEqual(45);
  });

  it('text is case-folded as Python folds it, not merely lowercased', () => {
    expect(casefold('Straße')).toBe('strasse');
    expect(casefold('ΣΟΦΟΣ')).toBe('σοφοσ');
    expect(casefold('ſ')).toBe('s');
    expect(casefold('GM')).toBe('gm');
  });

  it('the bundled model is the one Sidecar VENDOR.md records, byte for byte', () => {
    const sha = createHash('sha256').update(bin).digest('hex');
    expect(sha).toBe('67e3f69c5bcde9e5ec14d68382665aa3f5d72b6deed8d9235dd2d110e7b642c8');
  });

  it('the model file is checked before it is trusted', () => {
    const bad = new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0]);
    expect(() => load(bad.buffer.slice(bad.byteOffset, bad.byteOffset + bad.length))).toThrow(
      /not an nspam model/
    );
    const extra = new Uint8Array(bin.length + 1);
    extra.set(bin);
    expect(() => load(extra.buffer)).toThrow(/trailing bytes/);
    expect(MODEL.trees.length).toBe(500);
  });

  it('ONLY A REPLY, MOSTLY IN LATIN SCRIPT, IS SCORED: THE MODEL KNOWS LITTLE ELSE', () => {
    const reply = (content: string, extra: Record<string, unknown> = {}) => ({
      kind: 1,
      content,
      tags: [
        ['e', 'a'.repeat(64)],
        ['p', 'b'.repeat(64)]
      ],
      ...extra
    });
    expect(scorable(reply('Great point, thanks for sharing'))).toBe(true);
    expect(scorable(reply('Crème brûlée à la française'))).toBe(true);
    expect(scorable(reply('ボトル：0通が漂流中'))).toBe(false);
    expect(scorable(reply('Привет, как дела?'))).toBe(false);
    expect(scorable(reply('🔥🔥🔥'))).toBe(false);
    // The words decide, not the links in them: an Urdu reply with a long Latin URL is Urdu.
    expect(
      scorable(
        reply(
          'مکمل ویڈیو اس لنک پر دیکھیں 👇\nhttps://www.google.com/share.google?q=1Uk3ErPbVsYk4W5yg'
        )
      )
    ).toBe(false);
    expect(scorable(reply('Привет nostr:npub1' + 'q'.repeat(58)))).toBe(false);
    expect(scorable(reply('Look at this https://example.com/a'))).toBe(true);
    expect(scorable(reply('https://media.tenor.com/abc/homer.gif'))).toBe(true);
    expect(scorable(reply('hello', { kind: 7 }))).toBe(false);
    expect(scorable({ kind: 1, content: 'hello there', tags: [['p', 'b'.repeat(64)]] })).toBe(
      false
    );
    expect(score(MODEL, [])).toBeNull();
  });

  it('a bundle is the newest ten at most, as the model was trained', () => {
    const notes = Array.from({ length: 14 }, (_, i) => ({
      content: 'reply ' + i,
      tags: [['e', 'x']],
      created_at: 1700000000 + i
    }));
    expect(score(MODEL, notes)).toEqual(score(MODEL, notes.slice(0, 10)));
  });
});
