import { get } from 'svelte/store';
import { ndk, userPublickey } from '$lib/nostr';
import { membershipStatusMap, queueMembershipLookup } from '$lib/stores/membershipStatus';
import { FreshClient } from './relay';
import { MemberLogin } from './memberLogin';
import { ndkAuthSigner } from './authSigner';

/**
 * One Fresh client and member login per tab session, so a declined login
 * stays declined across tab switches and page visits until a reload or the
 * "Log in to the feed" button. Membership is the app's own answer
 * (`active`, never the tier); the relay has the final say.
 */
let session: { client: FreshClient; login: MemberLogin } | null = null;

function isMember(): boolean {
  const pk = get(userPublickey);
  if (!pk) return false;
  queueMembershipLookup(pk);
  return get(membershipStatusMap)[pk.toLowerCase()]?.active === true;
}

export function freshSession(): { client: FreshClient; login: MemberLogin } {
  if (!session) {
    const login = new MemberLogin({
      pubkey: () => get(userPublickey),
      isMember,
      sign: (template) => ndkAuthSigner(get(ndk))(template)
    });
    session = { client: new FreshClient({ login }), login };
  }
  return session;
}
