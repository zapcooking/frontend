/** The admin key list: primary + backup, decoded from their npubs. */
import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import { ADMIN_PUBKEY, ADMIN_PUBKEYS, BACKUP_ADMIN_PUBKEY, isAdmin } from './adminAuth';

describe('admin keys', () => {
  it('match their npubs', () => {
    expect(nip19.decode('npub15u3cqhx6vuj3rywg0ph5mfv009lxja6cyvqn2jagaydukq6zmjwqex05rq').data).toBe(
      ADMIN_PUBKEY
    );
    expect(nip19.decode('npub1aeh2zw4elewy5682lxc6xnlqzjnxksq303gwu2npfaxd49vmde6qcq4nwx').data).toBe(
      BACKUP_ADMIN_PUBKEY
    );
  });

  it('lists the primary first, then the backup, as lowercase hex', () => {
    expect(ADMIN_PUBKEYS).toEqual([ADMIN_PUBKEY, BACKUP_ADMIN_PUBKEY]);
    for (const pk of ADMIN_PUBKEYS) expect(pk).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(ADMIN_PUBKEYS)).toBe(true);
  });

  it('isAdmin is true for either admin and false for anyone else', () => {
    expect(isAdmin(ADMIN_PUBKEY)).toBe(true);
    expect(isAdmin(BACKUP_ADMIN_PUBKEY)).toBe(true);
    expect(isAdmin('b'.repeat(64))).toBe(false);
    expect(isAdmin('')).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });
});
