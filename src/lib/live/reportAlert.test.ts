/** Admin DMs: the report alert (text, throttle, urgent bypass) and the access request. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSecretKey, getPublicKey, nip04, nip19, verifyEvent } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createKvFake } from '../../test/liveStreamStub';
import type { LiveReportReason } from './config';
import {
  ALERT_RELAYS,
  buildAccessRequest,
  buildReportAlert,
  sendAdminDm,
  sendAdminDms,
  sendReportAlert,
  type ReportAlertInput
} from './reportAlert.server';

const SESSION = 'ab'.repeat(16);
const senderSk = generateSecretKey();
const SENDER = getPublicKey(senderSk);
const adminSk = generateSecretKey();
const ADMIN = getPublicKey(adminSk);
const backupSk = generateSecretKey();
const BACKUP = getPublicKey(backupSk);

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
const base = () => ({
  senderKey: bytesToHex(senderSk),
  publish: publish as unknown as (event: any, relays: string[]) => Promise<number>,
  now: 1_800_000_000
});
/** sendAdminDm: one recipient. */
const oneDeps = () => ({ ...base(), recipientPubkey: ADMIN });
/** sendReportAlert: one admin, so the throttle tests count one DM per alert. */
const deps = () => ({
  ...base(),
  kv,
  throttleKey: `live:alert:${SESSION}`,
  recipientPubkeys: [ADMIN] as readonly string[]
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

  it('DMs every admin, each its own event, and throttles once for all', async () => {
    const both = { ...deps(), recipientPubkeys: [ADMIN, BACKUP] };
    expect(await sendReportAlert(input(), both)).toBe('sent');
    expect(publish).toHaveBeenCalledTimes(2);
    const events = publish.mock.calls.map((c: any) => c[0] as any);
    expect(events.map((e: any) => e.tags)).toEqual([[['p', ADMIN]], [['p', BACKUP]]]);
    expect(nip04.decrypt(adminSk, SENDER, events[0].content)).toBe(buildReportAlert(input()));
    expect(nip04.decrypt(backupSk, SENDER, events[1].content)).toBe(buildReportAlert(input()));
    expect(await sendReportAlert(input({ reason: 'spam' }), both)).toBe('throttled');
    expect(publish).toHaveBeenCalledTimes(2);
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
    expect(kv.data.has(`live:alert:${SESSION}`)).toBe(true);
    const other = 'cd'.repeat(16);
    expect(
      await sendReportAlert(input({ sessionId: other }), { ...deps(), throttleKey: `live:alert:${other}` })
    ).toBe('sent');
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
    expect(await sendAdminDm(text, oneDeps())).toBe('sent');
  });
});

describe('sendAdminDms', () => {
  it('sends one DM per admin', async () => {
    expect(await sendAdminDms('hi', { ...base(), recipientPubkeys: [ADMIN, BACKUP] })).toBe('sent');
    const events = publish.mock.calls.map((c: any) => c[0] as any);
    expect(events.map((e: any) => e.tags[0][1]).sort()).toEqual([ADMIN, BACKUP].sort());
    expect(nip04.decrypt(backupSk, SENDER, events.find((e: any) => e.tags[0][1] === BACKUP).content)).toBe('hi');
  });

  it("one admin's failed publish does not stop the other's DM", async () => {
    publish.mockRejectedValueOnce(new Error('no relay accepted'));
    expect(await sendAdminDms('hi', { ...base(), recipientPubkeys: [ADMIN, BACKUP] })).toBe('sent');
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('is failed when every publish fails, and no-sender-key without a key', async () => {
    publish.mockRejectedValue(new Error('no relay accepted'));
    expect(await sendAdminDms('hi', { ...base(), recipientPubkeys: [ADMIN, BACKUP] })).toBe('failed');
    expect(
      await sendAdminDms('hi', { ...base(), senderKey: undefined, recipientPubkeys: [ADMIN, BACKUP] })
    ).toBe('no-sender-key');
  });

  it('sends a key listed twice only once, and nothing for an empty list', async () => {
    await sendAdminDms('hi', { ...base(), recipientPubkeys: [ADMIN, ADMIN] });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(await sendAdminDms('hi', { ...base(), recipientPubkeys: [] })).toBe('failed');
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
