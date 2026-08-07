/**
 * Error-taxonomy tests for the recipe-extraction pipeline.
 *
 * These exercise the REAL parseRecipe/fetchUrlContent path with a
 * stubbed global fetch. Contract under test:
 *
 *   - Every URL-fetch failure keeps HTTP status 400 (mobile clients
 *     branch on the numeric status — statuses are frozen until a
 *     coordinated Android/iOS release) but carries a stable `code`.
 *   - The client-facing `error` string is the neutral fallback copy —
 *     never the raw internal/upstream detail ("Failed to fetch URL:
 *     403" and friends must not escape).
 *   - The SSRF guard still runs on every redirect hop. The three
 *     redirect-guard tests (metadata IP, plain private range,
 *     non-http scheme) are mutation canaries: deleting the in-loop
 *     parsePublicUrl check must fail all of them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseRecipe, MAX_TEXT_INPUT_CHARS } from '$lib/parseRecipe.server';
import { EXTRACT_ERROR_FALLBACK, type ExtractErrorCode } from '$lib/extractErrors';

const KEY = 'test-openai-key';
const TARGET = 'https://example.com/recipes/tacos';

const fetchMock = vi.fn();

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

function openAiResponse(recipe: Record<string, unknown> = { title: 'Tacos' }): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(recipe) } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

function htmlResponse(body = '<html><body><h1>Tacos</h1></body></html>'): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
}

/** Route the stubbed fetch: target URL → given response/behavior, OpenAI → success. */
function mockTarget(responder: (url: string) => Response | Promise<Response>) {
  fetchMock.mockImplementation(async (url: string | URL) => {
    const u = String(url);
    if (u.includes('api.openai.com')) return openAiResponse();
    return responder(u);
  });
}

async function expectUrlFailure(url: string, code: ExtractErrorCode) {
  const result = await parseRecipe(KEY, { type: 'url', url });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('unreachable');
  // Status frozen at 400 for the whole URL-fetch family (mobile contract).
  expect(result.status).toBe(400);
  expect(result.code).toBe(code);
  // The client string is exactly the neutral fallback — nothing internal.
  expect(result.error).toBe(EXTRACT_ERROR_FALLBACK[code]);
  expect(result.error).not.toMatch(/Failed to fetch/i);
  expect(result.error).not.toMatch(/\b[45]\d\d\b/);
  return result;
}

describe('parseRecipe URL error taxonomy (status frozen at 400, code varies)', () => {
  it('upstream 403 → SOURCE_BLOCKED', async () => {
    mockTarget(() => new Response('Forbidden', { status: 403 }));
    await expectUrlFailure(TARGET, 'SOURCE_BLOCKED');
  });

  it('upstream 401 → SOURCE_BLOCKED', async () => {
    mockTarget(() => new Response('', { status: 401 }));
    await expectUrlFailure(TARGET, 'SOURCE_BLOCKED');
  });

  it('upstream 451 → SOURCE_BLOCKED', async () => {
    mockTarget(() => new Response('', { status: 451 }));
    await expectUrlFailure(TARGET, 'SOURCE_BLOCKED');
  });

  it('upstream 404 → SOURCE_NOT_FOUND', async () => {
    mockTarget(() => new Response('Not found', { status: 404 }));
    await expectUrlFailure(TARGET, 'SOURCE_NOT_FOUND');
  });

  it('upstream 410 → SOURCE_NOT_FOUND', async () => {
    mockTarget(() => new Response('', { status: 410 }));
    await expectUrlFailure(TARGET, 'SOURCE_NOT_FOUND');
  });

  it('upstream 429 → SOURCE_UNAVAILABLE (transient — must NOT read as blocked)', async () => {
    mockTarget(() => new Response('', { status: 429 }));
    await expectUrlFailure(TARGET, 'SOURCE_UNAVAILABLE');
  });

  it('upstream 500 → SOURCE_UNAVAILABLE', async () => {
    mockTarget(() => new Response('', { status: 500 }));
    await expectUrlFailure(TARGET, 'SOURCE_UNAVAILABLE');
  });

  it('network failure (fetch rejects) → SOURCE_UNAVAILABLE', async () => {
    fetchMock.mockRejectedValue(new TypeError('getaddrinfo ENOTFOUND example.com'));
    const result = await expectUrlFailure(TARGET, 'SOURCE_UNAVAILABLE');
    expect(result.error).not.toContain('ENOTFOUND');
  });

  it('declared Content-Length over 5 MB → SOURCE_TOO_LARGE', async () => {
    mockTarget(
      () =>
        new Response('tiny', {
          status: 200,
          headers: { 'content-length': String(6 * 1024 * 1024), 'content-type': 'text/html' }
        })
    );
    await expectUrlFailure(TARGET, 'SOURCE_TOO_LARGE');
  });

  it('streamed body over 5 MB → SOURCE_TOO_LARGE', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 6; i++) controller.enqueue(chunk);
        controller.close();
      }
    });
    mockTarget(
      () => new Response(stream, { status: 200, headers: { 'content-type': 'text/html' } })
    );
    await expectUrlFailure(TARGET, 'SOURCE_TOO_LARGE');
  });

  it('more than 5 redirects → TOO_MANY_REDIRECTS', async () => {
    mockTarget(
      () =>
        new Response(null, {
          status: 301,
          headers: { location: 'https://example.com/recipes/hop' }
        })
    );
    await expectUrlFailure(TARGET, 'TOO_MANY_REDIRECTS');
    expect(fetchMock).toHaveBeenCalledTimes(6); // hops 0..5, then bail
  });

  it('redirect without Location header → SOURCE_UNAVAILABLE', async () => {
    mockTarget(() => new Response(null, { status: 302 }));
    await expectUrlFailure(TARGET, 'SOURCE_UNAVAILABLE');
  });

  it('redirect with unparseable Location → SOURCE_UNAVAILABLE', async () => {
    mockTarget(() => new Response(null, { status: 302, headers: { location: 'http://[' } }));
    await expectUrlFailure(TARGET, 'SOURCE_UNAVAILABLE');
  });

  it('redirect into a private IP is refused by the in-loop guard → SOURCE_UNAVAILABLE', async () => {
    // MUTATION CANARY: if the per-hop parsePublicUrl check inside
    // fetchUrlContent's loop is removed, the second fetch fires and
    // this test fails on toHaveBeenCalledTimes(1).
    mockTarget(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/' }
        })
    );
    await expectUrlFailure(TARGET, 'SOURCE_UNAVAILABLE');
    expect(fetchMock).toHaveBeenCalledTimes(1); // the metadata IP was never fetched
  });

  it('redirect into a plain private range is refused by the in-loop guard → SOURCE_UNAVAILABLE', async () => {
    // MUTATION CANARY: same guard as the metadata-IP test, but for an
    // ordinary RFC 1918 address — the guard must not be scoped to
    // known-dangerous IPs only.
    mockTarget(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://10.0.0.1/internal/' }
        })
    );
    await expectUrlFailure(TARGET, 'SOURCE_UNAVAILABLE');
    expect(fetchMock).toHaveBeenCalledTimes(1); // the private IP was never fetched
  });

  it('redirect to a non-http(s) scheme is refused by the in-loop guard → SOURCE_UNAVAILABLE', async () => {
    // MUTATION CANARY: a redirect can change scheme, not just host —
    // the per-hop guard must reject file:/ftp:/etc. targets too.
    mockTarget(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: 'file:///etc/passwd' }
        })
    );
    await expectUrlFailure(TARGET, 'SOURCE_UNAVAILABLE');
    expect(fetchMock).toHaveBeenCalledTimes(1); // the file: URL was never fetched
  });

  it('never calls OpenAI when the URL fetch fails', async () => {
    mockTarget(() => new Response('', { status: 403 }));
    await parseRecipe(KEY, { type: 'url', url: TARGET });
    const openAiCalls = fetchMock.mock.calls.filter((call: unknown[]) =>
      String(call[0]).includes('api.openai.com')
    );
    expect(openAiCalls).toHaveLength(0);
  });

  it('logs upstream status + hostname only — no path, no body', async () => {
    mockTarget(() => new Response('SECRET-UPSTREAM-BODY', { status: 403 }));
    await parseRecipe(KEY, { type: 'url', url: 'https://example.com/secret-path?token=abc' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warnSpy.mock.calls[0]);
    expect(logged).toContain('example.com');
    expect(logged).toContain('403');
    expect(logged).not.toContain('secret-path');
    expect(logged).not.toContain('token=abc');
    expect(logged).not.toContain('SECRET-UPSTREAM-BODY');
  });
});

describe('parseRecipe hop-0 guard rejections are client fault codes', () => {
  it('unparseable URL → INVALID_URL', async () => {
    await expectUrlFailure('not a url at all', 'INVALID_URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('non-http(s) scheme → UNSUPPORTED_URL', async () => {
    await expectUrlFailure('ftp://example.com/recipe', 'UNSUPPORTED_URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loopback IP literal → UNSUPPORTED_URL', async () => {
    await expectUrlFailure('http://127.0.0.1/admin', 'UNSUPPORTED_URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('private-range IP literal → UNSUPPORTED_URL', async () => {
    await expectUrlFailure('http://10.0.0.5/', 'UNSUPPORTED_URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('localhost hostname → UNSUPPORTED_URL', async () => {
    await expectUrlFailure('http://localhost:5173/', 'UNSUPPORTED_URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('parseRecipe input validation codes (status 400, unchanged)', () => {
  it('empty text → INVALID_REQUEST', async () => {
    const result = await parseRecipe(KEY, { type: 'text', textData: '   ' });
    expect(result).toMatchObject({ ok: false, status: 400, code: 'INVALID_REQUEST' });
  });

  it('over-long text → TEXT_TOO_LONG', async () => {
    const result = await parseRecipe(KEY, {
      type: 'text',
      textData: 'x'.repeat(MAX_TEXT_INPUT_CHARS + 1)
    });
    expect(result).toMatchObject({ ok: false, status: 400, code: 'TEXT_TOO_LONG' });
  });

  it('empty imageData → INVALID_REQUEST', async () => {
    const result = await parseRecipe(KEY, { type: 'image', imageData: '' });
    expect(result).toMatchObject({ ok: false, status: 400, code: 'INVALID_REQUEST' });
  });

  it('empty url → INVALID_REQUEST', async () => {
    const result = await parseRecipe(KEY, { type: 'url', url: '' });
    expect(result).toMatchObject({ ok: false, status: 400, code: 'INVALID_REQUEST' });
  });
});

describe('parseRecipe AI failures (status 500, unchanged) → AI_UNAVAILABLE', () => {
  function mockTargetOkOpenAi(openAi: () => Response | Promise<Response>) {
    fetchMock.mockImplementation(async (url: string | URL) => {
      if (String(url).includes('api.openai.com')) return openAi();
      return htmlResponse();
    });
  }

  async function expectAiUnavailable() {
    const result = await parseRecipe(KEY, { type: 'url', url: TARGET });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.status).toBe(500);
    expect(result.code).toBe('AI_UNAVAILABLE');
    expect(result.error).toBe(EXTRACT_ERROR_FALLBACK.AI_UNAVAILABLE);
  }

  it('OpenAI non-OK response', async () => {
    mockTargetOkOpenAi(() => new Response('{"error":{"message":"quota"}}', { status: 500 }));
    await expectAiUnavailable();
    // Logging rider: status only, never the response body.
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain('quota');
  });

  it('OpenAI network failure', async () => {
    mockTargetOkOpenAi(() => {
      throw new TypeError('fetch failed');
    });
    await expectAiUnavailable();
  });

  it('OpenAI 200 with no content', async () => {
    mockTargetOkOpenAi(() => new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    await expectAiUnavailable();
  });

  it('OpenAI 200 with unparseable recipe JSON', async () => {
    mockTargetOkOpenAi(
      () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: 'this is SECRET-AI-PROSE not json' } }] }),
          { status: 200 }
        )
    );
    await expectAiUnavailable();
    // Logging rider: never log the AI response body.
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain('SECRET-AI-PROSE');
  });
});

describe('parseRecipe success path', () => {
  it('URL → fetch → OpenAI → normalized recipe', async () => {
    mockTarget(() => htmlResponse());
    const result = await parseRecipe(KEY, { type: 'url', url: TARGET });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.recipe.title).toBe('Tacos');
  });
});
