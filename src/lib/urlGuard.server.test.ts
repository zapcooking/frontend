import { describe, it, expect, vi } from 'vitest';
import { parsePublicUrl, fetchWithSsrfGuard, SsrfGuardError } from './urlGuard.server';

/**
 * The guard's job is to keep server-side fetches of user-supplied URLs
 * off internal addresses — including after a redirect, which is the case
 * `redirect: 'follow'` silently gets wrong.
 */

const ok = (raw: string) => parsePublicUrl(raw).ok;

describe('parsePublicUrl', () => {
  it('accepts ordinary public http(s) URLs', () => {
    expect(ok('https://example.com/recipe')).toBe(true);
    expect(ok('http://example.com:8080/x?y=1')).toBe(true);
  });

  it('rejects non-http(s) schemes', () => {
    for (const raw of ['file:///etc/passwd', 'ftp://example.com', 'data:text/html,x']) {
      expect(ok(raw)).toBe(false);
    }
  });

  it('rejects internal hostnames', () => {
    for (const host of [
      'localhost',
      'foo.localhost',
      'printer.local',
      'metadata.internal'
    ]) {
      expect(ok(`http://${host}/`)).toBe(false);
    }
  });

  it('rejects private, loopback and link-local IPv4', () => {
    for (const ip of [
      '127.0.0.1',
      '10.0.0.5',
      '192.168.1.1',
      '172.16.0.1',
      '172.31.255.255',
      '0.0.0.0',
      '169.254.169.254' // cloud instance metadata
    ]) {
      expect(ok(`http://${ip}/`)).toBe(false);
    }
  });

  it('allows public IPv4 that merely looks adjacent to private ranges', () => {
    for (const ip of ['172.32.0.1', '172.15.0.1', '11.0.0.1', '192.169.0.1']) {
      expect(ok(`http://${ip}/`)).toBe(true);
    }
  });

  it('rejects IPv6 loopback, link-local and unique-local', () => {
    for (const host of ['[::1]', '[fe80::1]', '[fc00::1]', '[fd12:3456::1]']) {
      expect(ok(`http://${host}/`)).toBe(false);
    }
  });

  it('rejects IPv4-mapped IPv6 forms', () => {
    expect(ok('http://[::ffff:127.0.0.1]/')).toBe(false);
    expect(ok('http://[::ffff:169.254.169.254]/')).toBe(false);
  });

  it('rejects integer and hex host encodings of loopback', () => {
    // WHATWG URL canonicalizes these to 127.0.0.1 before the guard sees
    // them; the explicit numeric-host reject is belt-and-braces.
    for (const host of ['2130706433', '0x7f000001', '127.1']) {
      expect(ok(`http://${host}/`)).toBe(false);
    }
  });

  it('rejects malformed input', () => {
    expect(ok('not a url')).toBe(false);
    expect(ok('')).toBe(false);
  });
});

/** Minimal Response stand-in — Workers-shaped, no undici needed. */
function redirectTo(location: string, status = 302): Response {
  return {
    status,
    headers: { get: (k: string) => (k.toLowerCase() === 'location' ? location : null) }
  } as unknown as Response;
}

function okResponse(): Response {
  return {
    status: 200,
    ok: true,
    headers: { get: () => null }
  } as unknown as Response;
}

describe('fetchWithSsrfGuard', () => {
  it('fetches a public URL and reports the final hop', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());

    const { response, finalUrl } = await fetchWithSsrfGuard(
      'https://example.com/a',
      {},
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );

    expect(response.status).toBe(200);
    expect(finalUrl).toBe('https://example.com/a');
    // Never delegate redirect handling to the platform.
    expect(fetchImpl.mock.calls[0][1].redirect).toBe('manual');
  });

  it('blocks a redirect from a public host into a private address', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(redirectTo('http://169.254.169.254/latest/meta-data/'))
      .mockResolvedValue(okResponse());

    await expect(
      fetchWithSsrfGuard(
        'https://example.com/redirect',
        {},
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      )
    ).rejects.toThrow(SsrfGuardError);

    // The private hop must never be requested.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('follows public redirects and returns the last URL', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(redirectTo('https://cdn.example.org/final'))
      .mockResolvedValue(okResponse());

    const { finalUrl } = await fetchWithSsrfGuard(
      'https://example.com/start',
      {},
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );

    // og:image and friends must resolve against this, not the input URL.
    expect(finalUrl).toBe('https://cdn.example.org/final');
  });

  it('resolves relative Location headers against the current hop', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(redirectTo('/moved'))
      .mockResolvedValue(okResponse());

    const { finalUrl } = await fetchWithSsrfGuard(
      'https://example.com/start',
      {},
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );

    expect(finalUrl).toBe('https://example.com/moved');
  });

  it('rejects the caller URL before any fetch when it is private', async () => {
    const fetchImpl = vi.fn();

    await expect(
      fetchWithSsrfGuard(
        'http://127.0.0.1:8787/',
        {},
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      )
    ).rejects.toThrow(SsrfGuardError);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('gives up after too many redirects', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(redirectTo('https://example.com/loop'));

    await expect(
      fetchWithSsrfGuard(
        'https://example.com/loop',
        {},
        { fetchImpl: fetchImpl as unknown as typeof fetch, maxRedirects: 2 }
      )
    ).rejects.toThrow(/exceeded 2 redirects/);

    expect(fetchImpl).toHaveBeenCalledTimes(3); // hops 0,1,2
  });

  it('rejects a redirect with no Location header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 302,
      headers: { get: () => null }
    } as unknown as Response);

    await expect(
      fetchWithSsrfGuard(
        'https://example.com/x',
        {},
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      )
    ).rejects.toThrow(/redirect without Location/);
  });
});
