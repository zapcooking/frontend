/** Admin DMs: the report alert (text, throttle, urgent bypass) and the access request. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSecretKey, getPublicKey, nip04, nip19, verifyEvent } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createKvFake } from '../../test/liveStreamStub';
import type { LiveReportReason } from './config';
import {
  ALERT_RELAYS,
  ALERT_THROTTLE_PREFIX,
  buildAccessRequest,
  buildReportAlert,
  sendAdminDm,
  sendReportAlert,
  type ReportAlertInput
} from './reportAlert.server';

const SESSION = 'ab'.repeat(16);
const senderSk = generateSecretKey();
const SENDER = getPublicKey(senderSk);
const adminSk = generateSecretKey();
const ADMIN = getPublicKey(adminSk);

const input = (over: Partial<ReportAlertInput> = {}): ReportAlertInput => ({
  sessionId: SESSION,
  title: 'Pizza Beans',
  reason: 'nudity',
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

  it('says when a comment was reported, and flags the urgent reasons loudly', () => {
    expect(buildReportAlert(input({ comment: true }))).toContain('a comment on a live stream');
    expect(buildReportAlert(input({ reason: 'child_safety' }))).toMatch(/^🚨 CHILD SAFETY/);
    expect(buildReportAlert(input({ reason: 'violence' }))).toMatch(/^🚨 VIOLENCE/);
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
    expect(await sendReportAlert(input(), { ...deps(), senderKey: nip19.nsecEncode(senderSk) })).toBe(
      'sent'
    );
  });

  it('sends at most one alert per session in the throttle window', async () => {
    expect(await sendReportAlert(input(), deps())).toBe('sent');
    expect(await sendReportAlert(input({ reason: 'spam' }), deps())).toBe('throttled');
    expect(publish).toHaveBeenCalledTimes(1);
    expect(kv.data.has(ALERT_THROTTLE_PREFIX + SESSION)).toBe(true);
    expect(await sendReportAlert(input({ sessionId: 'cd'.repeat(16) }), deps())).toBe('sent');
  });

  it('never throttles child safety or violence', async () => {
    await sendReportAlert(input(), deps());
    for (const reason of ['child_safety', 'violence', 'child_safety'] as LiveReportReason[]) {
      expect(await sendReportAlert(input({ reason }), deps())).toBe('sent');
    }
    expect(publish).toHaveBeenCalledTimes(4);
  });

  it('still sends when the throttle cannot be read or written', async () => {
    kv.failReads = true;
    kv.failWrites = true;
    expect(await sendReportAlert(input(), deps())).toBe('sent');
  });

  it('reports a missing key or a failed publish without throwing, and sets no throttle', async () => {
    expect(await sendReportAlert(input(), { ...deps(), senderKey: undefined })).toBe('no-sender-key');
    publish.mockRejectedValueOnce(new Error('no relay accepted'));
    expect(await sendReportAlert(input(), deps())).toBe('failed');
    expect(kv.data.size).toBe(0);
  });
});

describe('access request', () => {
  it('carries the pending count, npub, profile link and the note', () => {
    const pk = getPublicKey(generateSecretKey());
    const text = buildAccessRequest({
      pubkey: pk,
      note: 'Weeknight pasta, every Tuesday',
      pending: 3,
      origin: 'https://zap.cooking'
    });
    const npub = nip19.npubEncode(pk);
    expect(text).toMatch(/^🎥 New Go live access request \(3 pending\)/);
    expect(text).toContain(npub);
    expect(text).toContain(`https://zap.cooking/user/${npub}`);
    expect(text).toContain('Note: "Weeknight pasta, every Tuesday"');
    expect(text).toContain('https://zap.cooking/admin/live');
  });

  it('leaves out an empty note', async () => {
    const text = buildAccessRequest({ pubkey: ADMIN, note: '', pending: 1, origin: 'https://zap.cooking' });
    expect(text).not.toContain('Note:');
    expect(await sendAdminDm(text, deps())).toBe('sent');
  });
});
