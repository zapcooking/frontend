// Decode HTML character references in OG card text: common named entities
// plus decimal (&#39;, &#039;) and hex (&#x27;) numeric references. Runs in
// a single left-to-right pass, so escaped source text like "&amp;#039;"
// decodes to the literal "&#039;" rather than double-decoding to "'".
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d'
};

function scalarFromRef(digits: string, radix: 10 | 16): string | null {
  const code = parseInt(digits, radix);
  // Surrogates and values above U+10FFFF can't form a Unicode scalar: pass
  // the source text through unchanged rather than mangling the string.
  if (
    !Number.isInteger(code) ||
    code < 0 ||
    code > 0x10ffff ||
    (code >= 0xd800 && code <= 0xdfff)
  ) {
    return null;
  }
  return String.fromCodePoint(code);
}

function decodeEntity(body: string): string | null {
  const named = NAMED_ENTITIES[body];
  if (named !== undefined) return named;
  const hex = body.match(/^#x([0-9a-f]+)$/i);
  if (hex) return scalarFromRef(hex[1], 16);
  const dec = body.match(/^#([0-9]+)$/);
  if (dec) return scalarFromRef(dec[1], 10);
  return null;
}

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c !== '&') {
      out += c;
      i++;
      continue;
    }
    // A character reference is '&' + body + ';'; bound the body at 10
    // characters (`&#x10FFFF;` and friends all fit well inside).
    let body: string | null = null;
    let end = i + 1;
    const limit = Math.min(i + 11, s.length);
    while (end < limit) {
      if (s[end] === ';') {
        body = s.slice(i + 1, end);
        break;
      }
      end++;
    }
    const replacement = body === null ? null : decodeEntity(body);
    if (body !== null && replacement !== null) {
      out += replacement;
      i = end + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}
