/**
 * Shared SSRF guard for server-side fetches of user-supplied URLs.
 *
 * Extracted from parseRecipe.server.ts, which had the only complete
 * implementation. Three endpoints fetch attacker-influenced URLs and
 * each was guarding differently (or not at all) — one guard, one place.
 *
 * Cloudflare Workers don't expose DNS resolution, so DNS-rebinding
 * cannot be defended against here. Within that limit: http(s) only,
 * reject internal hostnames, and reject IP literals in private,
 * loopback, link-local and unique-local ranges — including the AWS
 * instance-metadata address (169.254.169.254).
 *
 * Redirects must be followed MANUALLY (see fetchWithSsrfGuard):
 * `redirect: 'follow'` lets a public URL bounce into a private address
 * with no revalidation, which defeats the guard entirely.
 */

export function parsePublicUrl(
  raw: string
): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'Invalid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'Only http(s) URLs are supported' };
  }
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return { ok: false, reason: 'Internal hostnames are not allowed' };
  }
  if (isPrivateIpLiteral(host)) {
    return { ok: false, reason: 'Private/loopback addresses are not allowed' };
  }
  // Defense in depth. WHATWG `URL` already canonicalizes integer and hex
  // host forms (http://2130706433, http://0x7f000001, http://127.1) to
  // dotted-quad before we see `hostname`, so the checks above catch them.
  // Reject the shapes outright anyway: no legitimate host is bare digits
  // or 0x-prefixed, and this stops the bypass returning if a runtime ever
  // parses hosts less strictly.
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/.test(host)) {
    return { ok: false, reason: 'Numeric host encodings are not allowed' };
  }
  return { ok: true, url };
}

function isPrivateIpLiteral(host: string): boolean {
  // Strip IPv6 brackets if present (URL.hostname yields them unbracketed
  // on WHATWG, but be defensive).
  const h = (host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host).toLowerCase();

  // IPv6 loopback / unspecified / link-local / unique-local.
  if (h === '::1' || h === '::' || h === '0:0:0:0:0:0:0:1' || h === '0:0:0:0:0:0:0:0') return true;
  if (h.startsWith('fe80:') || h.startsWith('fe80::')) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;

  // IPv4-mapped/compatible IPv6 written in HEX. WHATWG `URL` rewrites
  // [::ffff:127.0.0.1] to [::ffff:7f00:1], so the dotted-quad branch below
  // never sees it — checking only the dotted form let loopback and
  // 169.254.169.254 through. Anything in `::`-prefixed space is v4-mapped
  // or v4-compatible and has no legitimate use in a user-supplied URL, so
  // reject the whole space rather than decoding hextets.
  if (h.startsWith('::')) return true;

  if (h.includes(':') && /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) {
    const dottedMatch = h.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (dottedMatch && isPrivateIpv4(dottedMatch[1])) return true;
    // Any IPv6 literal with an embedded IPv4 portion is unusual and
    // only really used for tunneling/compat — reject even if the v4
    // portion is public, since the v6 prefix (::ffff:, ::) is a
    // known bypass vector. Be conservative.
    return true;
  }

  // Plain IPv4-literal check.
  return isPrivateIpv4(h);
}

function isPrivateIpv4(h: string): boolean {
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 0) return true; // 0.0.0.0/8
  return false;
}

export const DEFAULT_MAX_REDIRECTS = 5;

export class SsrfGuardError extends Error {
  /** Which hop tripped the guard: 0 is the caller's own URL. */
  readonly hop: number;
  constructor(message: string, hop: number) {
    super(message);
    this.name = 'SsrfGuardError';
    this.hop = hop;
  }
}

/**
 * Fetch a user-supplied URL, re-validating the guard on every redirect hop.
 *
 * `redirect: 'follow'` is unusable here: the platform would transparently
 * chase a 302 from a public host into 169.254.169.254, and the guard would
 * only ever have seen the public URL. So redirects are followed by hand
 * and each hop goes back through parsePublicUrl.
 *
 * Returns the final response together with the URL it actually came from —
 * callers resolving relative URLs (og:image, say) must resolve against
 * that final hop, not the URL they passed in.
 */
export async function fetchWithSsrfGuard(
  rawUrl: string,
  init: RequestInit = {},
  options: { maxRedirects?: number; fetchImpl?: typeof fetch } = {}
): Promise<{ response: Response; finalUrl: string }> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const doFetch = options.fetchImpl ?? fetch;

  let currentUrl = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const parsed = parsePublicUrl(currentUrl);
    if (!parsed.ok) {
      throw new SsrfGuardError(parsed.reason, hop);
    }

    const target = parsed.url.toString();
    const response = await doFetch(target, { ...init, redirect: 'manual' });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new SsrfGuardError(`redirect without Location (${response.status})`, hop);
      }
      // Resolve relative Locations against the current hop, or a
      // same-origin `/path` would be rejected as scheme-less.
      try {
        currentUrl = new URL(location, target).toString();
      } catch {
        throw new SsrfGuardError('invalid redirect Location', hop);
      }
      continue;
    }

    return { response, finalUrl: target };
  }

  throw new SsrfGuardError(`exceeded ${maxRedirects} redirects`, maxRedirects);
}
