/** The Go live report alert: message text, throttle, and the DM it sends. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSecretKey, getPublicKey, nip04, verifyEvent } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createKvFake } from '../../test/liveStreamStub';
import {
  ALERT_RELAYS,
  ALERT_THROTTLE_PREFIX,
  buildReportAlert,
  sendReportAlert
} from './reportAlert.server';

const SESSION = 'ab'.repeat(16);
const senderSk = generateSecretKey();
const SENDER = getPublicKey(senderSk);
const adminSk = generateSecretKey();
const ADMIN = getPublicKey(adminSk);

const input = (over: Partial<Parameters<typeof buildReportAlert>[0]> = {}) => ({
  sessionId: SESSION,
  title: 'Pizza Beans',
  reason: 'nsfw',
  comment: false,
  origin: 'https://zap.cooking',
  ...over
});

let kv: ReturnType<typeof createKvFake>;
let publish: ReturnType<typeof vi.fn>;
const deps = () => ({
  kv,
  senderKey: bytesToHex(senderSk),
  recipientPubkey: ADMIN,
  publish: publish as unknown as (event: any, relays: string[]) => Promise<number>,
  now: 1_800_000_000
});

beforeEach(() => {
  kv = createKvFake();
  publish = vi.fn(async () => 2);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('buildReportAlert', () => {
  it('names the reason, the stream and the links, and nothing about the reporter', () => {
    const text = buildReportAlert(input());
    expect(text).toContain('Nudity or sexual content');
    expect(text).toContain('"Pizza Beans"');
    expect(text).toContain(`https://zap.cooking/live/s/${SESSION}`);
    expect(text).toContain('https://zap.cooking/admin/live');
  });

  it('says when a comment was reported, and flags child safety loudly', () => {
    expect(buildReportAlert(input({ comment: true }))).toContain('a comment on a live stream');
    expect(buildReportAlert(input({ reason: 'child_safety' }))).toMatch(/^🚨 CHILD SAFETY/);
  });

  it('links to the origin it was given (a preview links to itself)', () => {
    expect(buildReportAlert(input({ origin: 'https://x.frontend-hvd.pages.dev' }))).toContain(
      'https://x.frontend-hvd.pages.dev/live/s/'
    );
  });
});

describe('sendReportAlert', () => {
  it('sends a NIP-04 DM from the notification account to the admin', async () => {
    expect(await sendReportAlert(input(), deps())).toBe('sent');
    const [event, relays] = publish.mock.calls[0] as [any, string[]];
    expect(relays).toEqual(ALERT_RELAYS);
    expect(event.kind).toBe(4);
    expect(event.pubkey).toBe(SENDER);
    expect(event.tags).toEqual([['p', ADMIN]]);
    expect(verifyEvent(event)).toBe(true);
    expect(nip04.decrypt(adminSk, SENDER, event.content)).toBe(buildReportAlert(input()));
  });

  it('accepts an nsec as the sender key', async () => {
    const { nip19 } = await import('nostr-tools');
    const out = await sendReportAlert(input(), { ...deps(), senderKey: nip19.nsecEncode(senderSk) });
    expect(out).toBe('sent');
  });

  it('sends at most one alert per session in the throttle window', async () => {
    expect(await sendReportAlert(input(), deps())).toBe('sent');
    expect(await sendReportAlert(input({ reason: 'spam' }), deps())).toBe('throttled');
    expect(publish).toHaveBeenCalledTimes(1);
    expect(kv.data.has(ALERT_THROTTLE_PREFIX + SESSION)).toBe(true);
    // Another session is not throttled by this one.
    expect(await sendReportAlert(input({ sessionId: 'cd'.repeat(16) }), deps())).toBe('sent');
  });

  it('never throttles a child-safety report', async () => {
    await sendReportAlert(input(), deps());
    expect(await sendReportAlert(input({ reason: 'child_safety' }), deps())).toBe('sent');
    expect(await sendReportAlert(input({ reason: 'child_safety' }), deps())).toBe('sent');
    expect(publish).toHaveBeenCalledTimes(3);
  });

  it('still sends when the throttle cannot be read or written', async () => {
    kv.failReads = true;
    kv.failWrites = true;
    expect(await sendReportAlert(input(), deps())).toBe('sent');
  });

  it('reports a missing key or a failed publish without throwing', async () => {
    expect(await sendReportAlert(input(), { ...deps(), senderKey: undefined })).toBe('no-sender-key');
    publish.mockRejectedValueOnce(new Error('no relay accepted'));
    expect(await sendReportAlert(input(), deps())).toBe('failed');
    // A failed send sets no throttle, so the next report tries again.
    expect(kv.data.size).toBe(0);
  });
});
