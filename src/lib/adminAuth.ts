// Primary admin hex pubkey (decoded from npub15u3cqhx6vuj3rywg0ph5mfv009lxja6cyvqn2jagaydukq6zmjwqex05rq).
// Use it only where exactly one key is needed (seed rows, fixtures).
// Everything that decides "is this an admin?" uses ADMIN_PUBKEYS.
export const ADMIN_PUBKEY = 'a723805cda67251191c8786f4da58f797e6977582301354ba8e91bcb0342dc9c';

// Backup admin, full site admin with the same powers as the primary
// (decoded from npub1aeh2zw4elewy5682lxc6xnlqzjnxksq303gwu2npfaxd49vmde6qcq4nwx).
export const BACKUP_ADMIN_PUBKEY = 'ee6ea13ab9fe5c4a68eaf9b1a34fe014a66b40117c50ee2a614f4cda959b6e74';

/**
 * Every admin, primary first. Lowercase 64-hex. Server routes gate on
 * this with verifyNip98(request, { expectedPubkeys: ADMIN_PUBKEYS });
 * admin DMs (report alerts, access requests) go to each key.
 */
export const ADMIN_PUBKEYS: readonly string[] = Object.freeze([ADMIN_PUBKEY, BACKUP_ADMIN_PUBKEY]);

// CLIENT-SIDE UI GATING ONLY. The admin pubkeys are public knowledge, so a
// plain string comparison is spoofable — server routes must authenticate
// with verifyNip98(request, { expectedPubkeys: ADMIN_PUBKEYS }) instead
// (see $lib/nip98.server and /api/admin/promos for the pattern).
export function isAdmin(pubkey: string | null | undefined): boolean {
  return !!pubkey && ADMIN_PUBKEYS.includes(pubkey);
}
