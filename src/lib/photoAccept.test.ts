import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PHOTO_ACCEPT } from './photoAsk';

/**
 * Keeps the Cheffy photo picker and the two vision endpoints agreeing on
 * which image formats exist.
 *
 * PHOTO_ACCEPT is a *server* fact wearing a client hat: both endpoints
 * identify the format from the base64 prefix and default everything they
 * do not recognise to image/jpeg, so a file the picker admits but the
 * sniffer cannot name is sent mislabelled and fails at the model. That is
 * exactly what shipped — `accept="image/*"` admitted HEIC, which can
 * never match, and the member got "couldn't get a good look at that
 * photo" for a file that was fine.
 *
 * The pairing is what rots: someone adds a fifth prefix to a sniffer, or
 * widens the picker, and the other half stays put. Neither change looks
 * wrong on its own. So this asserts the two halves against each other
 * rather than against a hardcoded list.
 *
 * Scoped honestly: this checks the FORMAT LIST agrees. It does not check
 * that any given file decodes, and it is not a claim that OpenAI accepts
 * all four.
 */

const ROOT = path.resolve(__dirname, '../..');
const ENDPOINTS = [
  'src/routes/api/zappy/ask-photo/+server.ts',
  'src/routes/api/zappy/scan/+server.ts'
];

/** The base64 prefix → mime pairs a sniffer actually branches on. */
function sniffedMimes(source: string): string[] {
  const mimes: string[] = [];
  // `if (image.startsWith('<prefix>')) { mimeType = '<mime>';`
  const branch = /startsWith\('[^']+'\)\)\s*\{\s*mimeType\s*=\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = branch.exec(source)) !== null) mimes.push(m[1]);
  return mimes;
}

describe('PHOTO_ACCEPT tracks what the vision endpoints can identify', () => {
  const accepted = PHOTO_ACCEPT.split(',');

  it('is a comma-joined mime list with no spaces or wildcards', () => {
    expect(PHOTO_ACCEPT).not.toContain(' ');
    expect(PHOTO_ACCEPT).not.toContain('*');
    for (const type of accepted) expect(type).toMatch(/^image\/[a-z0-9.+-]+$/);
  });

  for (const rel of ENDPOINTS) {
    it(`matches the formats ${rel.split('/').slice(-2)[0]} sniffs`, () => {
      const source = readFileSync(path.join(ROOT, rel), 'utf8');
      const sniffed = sniffedMimes(source);

      // Guards the regex itself: if the sniffer is refactored into a shape
      // this no longer reads, the test must fail rather than pass on [].
      expect(sniffed.length).toBeGreaterThan(0);
      expect([...new Set(sniffed)].sort()).toEqual([...accepted].sort());
    });
  }
});

describe('the format the picker used to admit and the sniffer cannot name', () => {
  /**
   * An ISO-BMFF file (HEIC/HEIF/AVIF — the iPhone camera roll) opens with
   * the size of its `ftyp` BOX, not of the file: a small integer, so the
   * first three bytes are 00 00 00 and the base64 always begins "AAAA".
   * None of the sniffed prefixes can start that way, which is why a HEIC
   * is labelled image/jpeg and rejected downstream.
   */
  const isoBmffHeader = (boxSize: number, brand: string) => {
    const bytes = Buffer.concat([
      Buffer.from([
        (boxSize >>> 24) & 0xff,
        (boxSize >>> 16) & 0xff,
        (boxSize >>> 8) & 0xff,
        boxSize & 0xff
      ]),
      Buffer.from('ftyp' + brand, 'ascii')
    ]);
    return bytes.toString('base64');
  };

  const prefixes = ['/9j/', 'iVBOR', 'R0lGOD', 'UklGR'];

  it('base64s as AAAA… for every realistic brand and box size', () => {
    for (const brand of ['heic', 'heix', 'hevc', 'mif1', 'msf1', 'avif']) {
      for (let size = 0x14; size <= 0x40; size += 4) {
        const b64 = isoBmffHeader(size, brand);
        expect(b64.startsWith('AAAA')).toBe(true);
        for (const prefix of prefixes) expect(b64.startsWith(prefix)).toBe(false);
      }
    }
  });

  it('is therefore absent from PHOTO_ACCEPT', () => {
    for (const type of ['image/heic', 'image/heif', 'image/avif']) {
      expect(PHOTO_ACCEPT).not.toContain(type);
    }
  });
});
