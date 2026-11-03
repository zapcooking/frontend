import type NDK from '@nostr-dev-kit/ndk';
import { NDKEvent } from '@nostr-dev-kit/ndk';
import type { SignAuth, SignedAuthEvent } from './memberLogin';

/**
 * Signs the Fresh relay's NIP-42 challenge with the app's signer
 * (extension, NIP-46, nsec or passkey vault). Uses `$ndk` for its signer
 * only: the event is never published through NDK's pool.
 */
export function ndkAuthSigner(ndk: NDK): SignAuth {
  return async (template) => {
    if (!ndk.signer) throw new Error('not signed in');
    // Same construction as $lib/nip98's signer.
    const event = new NDKEvent(ndk);
    event.kind = template.kind;
    event.created_at = template.created_at;
    event.tags = template.tags;
    event.content = template.content;
    await event.sign();
    return event.rawEvent() as SignedAuthEvent;
  };
}
