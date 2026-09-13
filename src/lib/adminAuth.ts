// Admin hex pubkey (decoded from npub15u3cqhx6vuj3rywg0ph5mfv009lxja6cyvqn2jagaydukq6zmjwqex05rq)
export const ADMIN_PUBKEY = 'a723805cda67251191c8786f4da58f797e6977582301354ba8e91bcb0342dc9c';

// CLIENT-SIDE UI GATING ONLY. The admin pubkey is public knowledge, so a
// plain string comparison is spoofable — server routes must authenticate
// with verifyNip98(request, { expectedPubkey: ADMIN_PUBKEY }) instead
// (see $lib/nip98.server and /api/admin/promos for the pattern).
export function isAdmin(pubkey: string | null | undefined): boolean {
  return !!pubkey && pubkey === ADMIN_PUBKEY;
}
