// Admin hex pubkey (decoded from npub15u3cqhx6vuj3rywg0ph5mfv009lxja6cyvqn2jagaydukq6zmjwqex05rq)
export const ADMIN_PUBKEY = 'a723805cda67251191c8786f4da58f797e6977582301354ba8e91bcb0342dc9c';

export function isAdmin(pubkey: string | null | undefined): boolean {
  return !!pubkey && pubkey === ADMIN_PUBKEY;
}
