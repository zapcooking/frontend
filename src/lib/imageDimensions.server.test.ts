/**
 * Tests for the OG image-dimension prober (docs/plans/og-missing-images-fix.md).
 *
 * The JPEG/PNG/WebP byte-format parsers are exercised against hand-built
 * minimal-but-valid buffers rather than real image files, so the suite has
 * no network dependency and pins down the exact offset math. Real-image
 * cross-checks (JPEG/PNG/WebP-lossy/WebP-lossless against `sips` ground
 * truth) were done manually during development — see the investigation doc.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { probeImageDimensions } from './imageDimensions.server';

function buildJpeg(width: number, height: number, { withApp0 = true } = {}): Uint8Array {
  const bytes: number[] = [0xff, 0xd8]; // SOI
  if (withApp0) {
    // A harmless APP0/JFIF segment before SOF0, so the test also exercises
    // the marker-walk loop (not just "SOF0 is the very first segment").
    bytes.push(
      0xff, 0xe0, 0x00, 0x10,
      0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00
    );
  }
  const sofLen = 17; // 2(len) + 1(precision) + 2(h) + 2(w) + 1(numcomp) + 3*3(components)
  bytes.push(
    0xff, 0xc0,
    (sofLen >> 8) & 0xff, sofLen & 0xff,
    8, // precision
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    3, // component count
    1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1
  );
  bytes.push(0xff, 0xd9); // EOI
  return new Uint8Array(bytes);
}

function buildPng(width: number, height: number): Uint8Array {
  const bytes: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]; // signature
  bytes.push(0, 0, 0, 13); // IHDR chunk length (unused by the parser, but realistic)
  bytes.push(0x49, 0x48, 0x44, 0x52); // "IHDR"
  bytes.push((width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff);
  bytes.push((height >>> 24) & 0xff, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff);
  bytes.push(8, 6, 0, 0, 0); // bit depth, color type, compression, filter, interlace
  bytes.push(0, 0, 0, 0); // CRC (unchecked by the parser)
  return new Uint8Array(bytes);
}

function buildWebpVp8(width: number, height: number): Uint8Array {
  const bytes: number[] = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
  bytes.push(0, 0, 0, 0); // file size (unused)
  bytes.push(0x57, 0x45, 0x42, 0x50); // "WEBP"
  bytes.push(0x56, 0x50, 0x38, 0x20); // "VP8 "
  bytes.push(0, 0, 0, 0); // chunk size (unused)
  // 6 bytes of frame tag before the 14-bit width/height fields the parser reads.
  bytes.push(0, 0, 0, 0x9d, 0x01, 0x2a);
  bytes.push(width & 0xff, (width >> 8) & 0xff);
  bytes.push(height & 0xff, (height >> 8) & 0xff);
  return new Uint8Array(bytes);
}

function buildWebpVp8x(width: number, height: number): Uint8Array {
  const bytes: number[] = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
  bytes.push(0x56, 0x50, 0x38, 0x58); // "VP8X"
  bytes.push(10, 0, 0, 0); // chunk size
  bytes.push(0, 0, 0, 0); // flags + reserved
  const w = width - 1;
  const h = height - 1;
  bytes.push(w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff);
  bytes.push(h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff);
  return new Uint8Array(bytes);
}

function mockFetchOnce(buf: Uint8Array, { ok = true, status = 200 } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    })
  );
}

describe('probeImageDimensions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses JPEG dimensions (with a filler APP0 segment before SOF0)', async () => {
    mockFetchOnce(buildJpeg(1280, 664));
    const result = await probeImageDimensions('https://example.com/a.jpg');
    expect(result).toEqual({ width: 1280, height: 664, mime: 'image/jpeg' });
  });

  it('parses JPEG dimensions with SOF0 as the very first segment', async () => {
    mockFetchOnce(buildJpeg(100, 50, { withApp0: false }));
    const result = await probeImageDimensions('https://example.com/b.jpg');
    expect(result).toEqual({ width: 100, height: 50, mime: 'image/jpeg' });
  });

  it('parses PNG dimensions from the fixed-offset IHDR chunk', async () => {
    mockFetchOnce(buildPng(960, 960));
    const result = await probeImageDimensions('https://example.com/c.png');
    expect(result).toEqual({ width: 960, height: 960, mime: 'image/png' });
  });

  it('parses WebP lossy (VP8) dimensions', async () => {
    mockFetchOnce(buildWebpVp8(550, 368));
    const result = await probeImageDimensions('https://example.com/d.webp');
    expect(result).toEqual({ width: 550, height: 368, mime: 'image/webp' });
  });

  it('parses WebP extended (VP8X) dimensions', async () => {
    mockFetchOnce(buildWebpVp8x(400, 301));
    const result = await probeImageDimensions('https://example.com/e.webp');
    expect(result).toEqual({ width: 400, height: 301, mime: 'image/webp' });
  });

  it('returns null for an unrecognized format instead of throwing', async () => {
    mockFetchOnce(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    const result = await probeImageDimensions('https://example.com/f.bin');
    expect(result).toBeNull();
  });

  it('returns null (never throws) on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const result = await probeImageDimensions('https://example.com/g.jpg');
    expect(result).toBeNull();
  });

  it('returns null on a non-2xx response', async () => {
    mockFetchOnce(new Uint8Array([0xff, 0xd8]), { ok: false, status: 404 });
    const result = await probeImageDimensions('https://example.com/missing.jpg');
    expect(result).toBeNull();
  });

  it('caches a successful result — a second call does not refetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => buildJpeg(10, 20).buffer
    });
    vi.stubGlobal('fetch', fetchMock);

    const url = 'https://example.com/cached.jpg';
    await probeImageDimensions(url);
    await probeImageDimensions(url);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches a null result too — a broken image is not re-fetched every render', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([0, 0, 0]).buffer
    });
    vi.stubGlobal('fetch', fetchMock);

    const url = 'https://example.com/broken-unique-url.jpg';
    const first = await probeImageDimensions(url);
    const second = await probeImageDimensions(url);
    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
