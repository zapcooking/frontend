import { describe, it, expect } from 'vitest';
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  type EventTemplate,
  type VerifiedEvent
} from 'nostr-tools';
import { verifyNip98 } from './nip98.server';
import { normalizeUrl, sha256Hex } from './nip98';

const ENDPOINT = 'https://zap.cooking/api/extract-recipe';
const METHOD = 'POST';

const sk = generateSecretKey();
const pubkey = getPublicKey(sk);

async function signEvent(
  template: EventTemplate,
  secretKey: Uint8Array = sk
): Promise<VerifiedEvent> {
  return finalizeEvent(template, secretKey);
}

async function buildSignedAuthEvent(opts: {
  url?: string;
  method?: string;
  bodyBytes?: Uint8Array;
  created_at?: number;
  kind?: number;
  secretKey?: Uint8Array;
}): Promise<VerifiedEvent> {
  const tags: string[][] = [
    ['u', normalizeUrl(opts.url ?? ENDPOINT)],
    ['method', (opts.method ?? METHOD).toUpperCase()]
  ];
  if (opts.bodyBytes !== undefined) {
    tags.push(['payload', await sha256Hex(opts.bodyBytes)]);
  }
  return signEvent(
    {
      kind: opts.kind ?? 27235,
      created_at: opts.created_at ?? Math.floor(Date.now() / 1000),
      tags,
      content: ''
    },
    opts.secretKey ?? sk
  );
}

function encodeAuthHeader(event: VerifiedEvent): string {
  return `Nostr ${btoa(JSON.stringify(event))}`;
}

function makeRequest(opts: {
  url?: string;
  method?: string;
  body?: string;
  authorization?: string;
}): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (opts.authorization) headers.set('Authorization', opts.authorization);
  return new Request(opts.url ?? ENDPOINT, {
    method: opts.method ?? METHOD,
    headers,
    body: opts.body
  });
}

describe('verifyNip98', () => {
  it('accepts a valid event and returns the signer pubkey when expectedPubkey is omitted', async () => {
    const body = JSON.stringify({ type: 'text', textData: 'hello', pubkey });
    const bodyBytes = new TextEncoder().encode(body);
    const event = await buildSignedAuthEvent({ bodyBytes });
    const request = makeRequest({ body, authorization: encodeAuthHeader(event) });

    const result = await verifyNip98(request, { bodyBytes });
    expect(result).toEqual({ ok: true, pubkey });
  });

  it('rejects wrong kind', async () => {
    const body = '{}';
    const bodyBytes = new TextEncoder().encode(body);
    const event = await buildSignedAuthEvent({ bodyBytes, kind: 1 });
    const request = makeRequest({ body, authorization: encodeAuthHeader(event) });

    const result = await verifyNip98(request, { bodyBytes });
    expect(result).toEqual({ ok: false, reason: 'wrong-kind' });
  });

  it('rejects bad signature', async () => {
    const body = '{}';
    const bodyBytes = new TextEncoder().encode(body);
    const event = await buildSignedAuthEvent({ bodyBytes });
    const tampered = { ...event, sig: '0'.repeat(128) };
    const request = makeRequest({ body, authorization: encodeAuthHeader(tampered as VerifiedEvent) });

    const result = await verifyNip98(request, { bodyBytes });
    expect(result).toEqual({ ok: false, reason: 'invalid-signature' });
  });

  it('rejects tampered event id', async () => {
    const body = '{}';
    const bodyBytes = new TextEncoder().encode(body);
    const event = await buildSignedAuthEvent({ bodyBytes });
    const tampered = { ...event, id: 'f'.repeat(64) };
    const request = makeRequest({ body, authorization: encodeAuthHeader(tampered as VerifiedEvent) });

    const result = await verifyNip98(request, { bodyBytes });
    expect(result).toEqual({ ok: false, reason: 'invalid-signature' });
  });

  it('rejects created_at more than 61s in the past', async () => {
    const body = '{}';
    const bodyBytes = new TextEncoder().encode(body);
    const stale = Math.floor(Date.now() / 1000) - 61;
    const event = await buildSignedAuthEvent({ bodyBytes, created_at: stale });
    const request = makeRequest({ body, authorization: encodeAuthHeader(event) });

    const result = await verifyNip98(request, { bodyBytes });
    expect(result).toEqual({ ok: false, reason: 'stale-timestamp' });
  });

  it('rejects created_at more than 61s in the future', async () => {
    const body = '{}';
    const bodyBytes = new TextEncoder().encode(body);
    const future = Math.floor(Date.now() / 1000) + 61;
    const event = await buildSignedAuthEvent({ bodyBytes, created_at: future });
    const request = makeRequest({ body, authorization: encodeAuthHeader(event) });

    const result = await verifyNip98(request, { bodyBytes });
    expect(result).toEqual({ ok: false, reason: 'stale-timestamp' });
  });

  it('rejects u-tag URL mismatch', async () => {
    const body = '{}';
    const bodyBytes = new TextEncoder().encode(body);
    const event = await buildSignedAuthEvent({
      bodyBytes,
      url: 'https://zap.cooking/api/other-endpoint'
    });
    const request = makeRequest({ body, authorization: encodeAuthHeader(event) });

    const result = await verifyNip98(request, { bodyBytes });
    expect(result).toEqual({ ok: false, reason: 'url-mismatch' });
  });

  it('rejects method mismatch', async () => {
    const body = '{}';
    const bodyBytes = new TextEncoder().encode(body);
    const event = await buildSignedAuthEvent({ bodyBytes, method: 'GET' });
    const request = makeRequest({ body, authorization: encodeAuthHeader(event) });

    const result = await verifyNip98(request, { bodyBytes });
    expect(result).toEqual({ ok: false, reason: 'method-mismatch' });
  });

  it('rejects malformed base64', async () => {
    const body = '{}';
    const bodyBytes = new TextEncoder().encode(body);
    const request = makeRequest({ body, authorization: 'Nostr !!!not-base64!!!' });

    const result = await verifyNip98(request, { bodyBytes });
    expect(result).toEqual({ ok: false, reason: 'malformed-header' });
  });

  it('rejects malformed JSON in header', async () => {
    const body = '{}';
    const bodyBytes = new TextEncoder().encode(body);
    const request = makeRequest({
      body,
      authorization: `Nostr ${btoa('not json')}`
    });

    const result = await verifyNip98(request, { bodyBytes });
    expect(result).toEqual({ ok: false, reason: 'malformed-header' });
  });

  it('rejects payload-tag mismatch when bodyBytes provided', async () => {
    const signedBody = JSON.stringify({ type: 'text', textData: 'signed' });
    const sentBody = JSON.stringify({ type: 'text', textData: 'sent' });
    const signedBytes = new TextEncoder().encode(signedBody);
    const sentBytes = new TextEncoder().encode(sentBody);
    const event = await buildSignedAuthEvent({ bodyBytes: signedBytes });
    const request = makeRequest({ body: sentBody, authorization: encodeAuthHeader(event) });

    const result = await verifyNip98(request, { bodyBytes: sentBytes });
    expect(result).toEqual({ ok: false, reason: 'payload-mismatch' });
  });

  it('rejects expectedPubkey mismatch when the param is provided', async () => {
    const otherSk = generateSecretKey();
    const body = '{}';
    const bodyBytes = new TextEncoder().encode(body);
    const event = await buildSignedAuthEvent({ bodyBytes, secretKey: otherSk });
    const request = makeRequest({ body, authorization: encodeAuthHeader(event) });

    const result = await verifyNip98(request, {
      bodyBytes,
      expectedPubkey: pubkey
    });
    expect(result).toEqual({ ok: false, reason: 'pubkey-mismatch' });
  });

  it('accepts when expectedPubkey matches the signer', async () => {
    const body = '{}';
    const bodyBytes = new TextEncoder().encode(body);
    const event = await buildSignedAuthEvent({ bodyBytes });
    const request = makeRequest({ body, authorization: encodeAuthHeader(event) });

    const result = await verifyNip98(request, { bodyBytes, expectedPubkey: pubkey });
    expect(result).toEqual({ ok: true, pubkey });
  });
});
