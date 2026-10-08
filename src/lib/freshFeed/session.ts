import { get } from 'svelte/store';
import { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk';
import { ndk, userPublickey } from '$lib/nostr';
import { membershipStatusMap, queueMembershipLookup } from '$lib/stores/membershipStatus';
import { FreshClient } from './relay';
import { MemberLogin } from './memberLogin';
import { ndkAuthSigner } from './authSigner';
import { MemberUnlock } from './memberUnlock';

/**
 * One Fresh client and member login per tab session, so a declined login
 * stays declined across tab switches and page visits until a reload or the
 * "Log in to the feed" button. Membership is the app's own answer
 * (`active`, never the tier); the relay has the final say.
 */
let session: { client: FreshClient; login: MemberLogin; unlock: MemberUnlock } | null = null;

function isMember(): boolean {
  const pk = get(userPublickey);
  if (!pk) return false;
  queueMembershipLookup(pk);
  return get(membershipStatusMap)[pk.toLowerCase()]?.active === true;
}

export function freshSession(): { client: FreshClient; login: MemberLogin; unlock: MemberUnlock } {
  if (!session) {
    const login = new MemberLogin({
      pubkey: () => get(userPublickey),
      isMember,
      sign: (template) => ndkAuthSigner(get(ndk))(template),
      // Same rule as the pantry relay's NIP-42 policy (nip29.ts): a local
      // key signs without a prompt; everything else (extension, NIP-46) asks.
      signerPrompts: () => !(get(ndk).signer instanceof NDKPrivateKeySigner)
    });
    const client = new FreshClient({ login });
    // "Tap to unlock" for the tab, like the login: a decline holds until a reload.
    const unlock = new MemberUnlock(
      async () => login.access(await client.connection(), true),
      () => get(userPublickey)
    );
    session = { client, login, unlock };
  }
  return session;
}
