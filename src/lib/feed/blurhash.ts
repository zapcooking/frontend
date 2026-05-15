/**
 * Blurhash decoder — hand-ported to avoid pulling the `blurhash` npm
 * dep (~3 kb on its own, plus base83/sRGB constants), and to keep
 * decode/encode logic in one auditable place.
 *
 * Algorithm follows the canonical blurhash spec (woltapp/blurhash):
 *   1. The hash starts with a base83-encoded "size flag" byte that
 *      packs `numX = (flag % 9) + 1` and `numY = floor(flag / 9) + 1`.
 *   2. The next 1 char is `quantisedMaxValue`, which sets the AC
 *      component scale: `maximumValue = (q + 1) / 166`.
 *   3. Next 4 chars are the DC component (the average sRGB color),
 *      base83-decoded to 24 bits and unpacked as RGB.
 *   4. Remaining chars: 2 chars per AC component (numX * numY - 1
 *      components total), each a 14-bit base83 number that decodes to
 *      three signed normalized floats (R, G, B).
 *   5. To render a pixel at (x, y) we cosine-blend the components
 *      across the image.
 *
 * Output is a tiny rasterized image (default 32x32) returned as a
 * `data:image/png;base64,…` URL ready to drop into a `<img src>` or a
 * `background-image: url(…)`. We rasterize via OffscreenCanvas where
 * available (workers, modern browsers) and fall back to a regular
 * `<canvas>` otherwise. SSR (no canvas) returns `null` — callers paint
 * a solid bg-secondary tile in that case.
 */

const BASE83 =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';

function base83Decode(str: string): number {
  let value = 0;
  for (let i = 0; i < str.length; i++) {
    const digit = BASE83.indexOf(str[i]);
    if (digit === -1) {
      throw new Error('blurhash: invalid base83 character');
    }
    value = value * 83 + digit;
  }
  return value;
}

function sRGBToLinear(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearTosRGB(value: number): number {
  const v = Math.max(0, Math.min(1, value));
  return v <= 0.0031308
    ? Math.round(v * 12.92 * 255 + 0.5)
    : Math.round((1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255 + 0.5);
}

function signPow(v: number, exp: number): number {
  return Math.sign(v) * Math.pow(Math.abs(v), exp);
}

function decodeDC(value: number): [number, number, number] {
  const r = value >> 16;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return [sRGBToLinear(r), sRGBToLinear(g), sRGBToLinear(b)];
}

function decodeAC(value: number, maximumValue: number): [number, number, number] {
  const quantR = Math.floor(value / (19 * 19));
  const quantG = Math.floor(value / 19) % 19;
  const quantB = value % 19;
  return [
    signPow((quantR - 9) / 9, 2) * maximumValue,
    signPow((quantG - 9) / 9, 2) * maximumValue,
    signPow((quantB - 9) / 9, 2) * maximumValue
  ];
}

/** Validate that a string is a usable blurhash. Cheap pre-check. */
export function isValidBlurhash(hash: string | undefined | null): hash is string {
  if (typeof hash !== 'string' || hash.length < 6) return false;
  try {
    const sizeFlag = base83Decode(hash[0]);
    const numY = Math.floor(sizeFlag / 9) + 1;
    const numX = (sizeFlag % 9) + 1;
    return hash.length === 4 + 2 * numX * numY;
  } catch {
    return false;
  }
}

/** Decode a blurhash to a flat `Uint8ClampedArray` of RGBA pixels.
 * Exposed so callers that already own a canvas can blit directly. */
export function decodeBlurhash(
  hash: string,
  width: number,
  height: number,
  punch = 1
): Uint8ClampedArray {
  if (!isValidBlurhash(hash)) {
    throw new Error('blurhash: malformed hash');
  }
  const sizeFlag = base83Decode(hash[0]);
  const numY = Math.floor(sizeFlag / 9) + 1;
  const numX = (sizeFlag % 9) + 1;
  const quantisedMaxValue = base83Decode(hash[1]);
  const maximumValue = ((quantisedMaxValue + 1) / 166) * punch;

  const colors: [number, number, number][] = new Array(numX * numY);
  for (let i = 0; i < colors.length; i++) {
    if (i === 0) {
      const value = base83Decode(hash.substring(2, 6));
      colors[i] = decodeDC(value);
    } else {
      const value = base83Decode(hash.substring(4 + i * 2, 6 + i * 2));
      colors[i] = decodeAC(value, maximumValue);
    }
  }

  const bytesPerRow = width * 4;
  const pixels = new Uint8ClampedArray(bytesPerRow * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < numY; j++) {
        const basisY = Math.cos((Math.PI * y * j) / height);
        for (let i = 0; i < numX; i++) {
          const basis = Math.cos((Math.PI * x * i) / width) * basisY;
          const color = colors[i + j * numX];
          r += color[0] * basis;
          g += color[1] * basis;
          b += color[2] * basis;
        }
      }
      const o = 4 * x + y * bytesPerRow;
      pixels[o] = linearTosRGB(r);
      pixels[o + 1] = linearTosRGB(g);
      pixels[o + 2] = linearTosRGB(b);
      pixels[o + 3] = 255;
    }
  }
  return pixels;
}

/**
 * Decode a blurhash to a tiny PNG data-URL suitable for use as a CSS
 * `background-image` or `<img src>` placeholder.
 *
 * - SSR-safe: returns `null` when no canvas is available.
 * - All exceptions (invalid hash, OOM on huge sizes) are swallowed
 *   into `null` so callers don't need try/catch — the convention is
 *   "show the bg-secondary fallback tile when this returns null".
 *
 * Output size defaults to 32x32, which is plenty for a CSS placeholder
 * that the browser will upscale + blur via `filter: blur(20px)`.
 */
export function blurhashToDataUrl(
  hash: string | undefined | null,
  width = 32,
  height = 32
): string | null {
  if (!isValidBlurhash(hash)) return null;
  try {
    const pixels = decodeBlurhash(hash, width, height);
    const canvas = createCanvas(width, height);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(pixels);
    ctx.putImageData(imageData, 0, 0);
    return canvasToDataUrl(canvas);
  } catch {
    return null;
  }
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

function createCanvas(width: number, height: number): AnyCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      return new OffscreenCanvas(width, height);
    } catch {
      /* fall through */
    }
  }
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
  }
  return null;
}

function canvasToDataUrl(canvas: AnyCanvas): string | null {
  // HTMLCanvasElement path — synchronous data URL.
  if (typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement) {
    return canvas.toDataURL('image/png');
  }
  // OffscreenCanvas has no synchronous `toDataURL`. We render to a
  // temporary HTMLCanvasElement when one is available, otherwise we
  // give up rather than block on the async `convertToBlob` path —
  // callers can re-try on a frame where DOM is available.
  if (typeof document !== 'undefined') {
    const fallback = document.createElement('canvas');
    fallback.width = canvas.width;
    fallback.height = canvas.height;
    const fctx = fallback.getContext('2d');
    if (!fctx) return null;
    fctx.drawImage(canvas as unknown as CanvasImageSource, 0, 0);
    return fallback.toDataURL('image/png');
  }
  return null;
}
