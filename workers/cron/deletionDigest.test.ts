/**
 * Daily account-deletion digest: what it says, when it stays quiet,
 * and that the admin can actually decrypt what it sends.
 */
import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, nip04, verifyEvent } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils.js';
import { buildDigest, runDeletionDigest, ADMIN_URL, DIGEST_RELAYS } from './deletionDigest';

const DAY = 86400;
const NOW = 1_800_000_000;

function fakeDb(rows: { billing: string; requested_at: number }[]) {
  const queries: string[] = [];
  return {
    queries,
    prepare(query: string) {
      queries.push(query);
      return { bind: () => ({ all: async () => ({ results: rows as any[] }) }) };
    }
  };
}

describe('buildDigest', () => {
  it('stays silent when nothing is pending', () => {
    expect(buildDigest([], NOW)).toBeNull();
  });

  it('flags every request whose renewal was not confirmed stopped', () => {
    const text = buildDigest(
      [
        { billing: 'cancelled', requested_at: NOW - DAY },
        { billing: 'none', requested_at: NOW - DAY },
        { billing: 'error', requested_at: NOW - DAY },
        { billing: 'unavailable', requested_at: NOW - DAY }
      ],
      NOW
    )!;
    expect(text).toContain('4 account deletion requests pending');
    expect(text).toContain('3 need a manual Stripe check');
    expect(text).toContain(ADMIN_URL);
  });

  it('omits the Stripe line when every renewal was stopped', () => {
    const text = buildDigest([{ billing: 'cancelled', requested_at: NOW }], NOW)!;
    expect(text).toContain('1 account deletion request pending');
    expect(text).not.toContain('Stripe');
  });

  it('counts overdue and due-soon requests against the 30-day deadline', () => {
    const text = buildDigest(
      [
        { billing: 'cancelled', requested_at: NOW - 31 * DAY },
        { billing: 'cancelled', requested_at: NOW - 25 * DAY },
        { billing: 'cancelled', requested_at: NOW - 2 * DAY }
      ],
      NOW
    )!;
    expect(text).toContain('1 past the 30-day deadline');
    expect(text).toContain('1 due within 7 days');
  });
});

describe('runDeletionDigest', () => {
  const senderSk = generateSecretKey();
  const adminSk = generateSecretKey();
  const adminPubkey = getPublicKey(adminSk);

  it('sends a signed kind-4 DM the admin can decrypt, with no pubkeys in it', async () => {
    const published: { event: any; relays: string[] }[] = [];
    const memberPubkey = 'ab'.repeat(32);
    const result = await runDeletionDigest({
      db: fakeDb([{ billing: 'none', requested_at: NOW - DAY }]),
      senderKey: bytesToHex(senderSk),
      recipientPubkey: adminPubkey,
      publish: async (event, relays) => {
        published.push({ event, relays });
        return relays.length;
      },
      now: NOW
    });

    expect(result).toBe('sent');
    expect(published).toHaveLength(1);
    const { event, relays } = published[0];
    expect(relays).toEqual(DIGEST_RELAYS);
    expect(event.kind).toBe(4);
    expect(event.tags).toEqual([['p', adminPubkey]]);
    expect(verifyEvent(event)).toBe(true);

    const text = nip04.decrypt(adminSk, getPublicKey(senderSk), event.content);
    expect(text).toContain('1 needs a manual Stripe check');
    expect(text).not.toContain(memberPubkey);
  });

  it('sends nothing when nothing is pending', async () => {
    let calls = 0;
    const result = await runDeletionDigest({
      db: fakeDb([]),
      senderKey: bytesToHex(senderSk),
      recipientPubkey: adminPubkey,
      publish: async () => ++calls,
      now: NOW
    });
    expect(result).toBe('nothing-pending');
    expect(calls).toBe(0);
  });

  it('reports a missing sender key only when there is something to send', async () => {
    const result = await runDeletionDigest({
      db: fakeDb([{ billing: 'cancelled', requested_at: NOW }]),
      senderKey: undefined,
      recipientPubkey: adminPubkey,
      publish: async () => 1,
      now: NOW
    });
    expect(result).toBe('no-sender-key');
  });

  it('only reads pending rows', async () => {
    const db = fakeDb([]);
    await runDeletionDigest({
      db,
      senderKey: bytesToHex(senderSk),
      recipientPubkey: adminPubkey,
      publish: async () => 1,
      now: NOW
    });
    expect(db.queries[0]).toContain('WHERE status = ?');
  });

  it('propagates a publish failure so the tick logs it', async () => {
    await expect(
      runDeletionDigest({
        db: fakeDb([{ billing: 'none', requested_at: NOW }]),
        senderKey: bytesToHex(senderSk),
        recipientPubkey: adminPubkey,
        publish: async () => {
          throw new Error('no relay accepted');
        },
        now: NOW
      })
    ).rejects.toThrow('no relay accepted');
  });
});
