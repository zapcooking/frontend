# NIP-46 Remote Signer — Events Signed With the Wrong Pubkey

**Status:** Fixed
**Affected:** Users logged in via a NIP-46 remote signer whose **signer pubkey differs from their user pubkey** — most notably **Primal** remote signing. Local keys (nsec), NIP-07 extensions, and Amber are **not** affected.
**Core fix:** `src/lib/authManager.ts` (`bindUserToSigner`)
**Related hardening:** `src/lib/mediaUpload.ts` + `MediaUploader.svelte`, `ImageUploader.svelte`, `ProfileEditModal.svelte`

---

## Symptoms

For users on an affected remote signer, anything that produced a **signed Nostr event** failed, usually silently:

- **Image uploads** to nostr.build returned `401 Unauthorized, please provide a valid nip-98 token`.
- **Zaps** failed (the zap request, kind `9734`, is a signed event rejected by the LNURL callback / relays).
- **Relay NIP-42 auth** failed: `error: failed to authenticate`.
- Notes (kind `1`), reactions, and other publishes would be rejected by relays for an invalid signature.

The console showed an upload like this (diagnostics, since removed):

```
[NIP98-DEBUG] {"pubkey":"fe3faf63…c2cb43d", … ,"idMatches":true,"sigValid":false}
nostr.build/api/v2/upload/files:1  Failed to load resource: 401
```

`idMatches: true` (the event id is consistent with its fields) but `sigValid: false` (the signature does not verify), and the `pubkey` is the **signer/bunker** key — not the user's.

## Root cause

The bug lives in how NDK's `NDKNip46Signer` reports the signing user, combined with how `NDKEvent` stamps an event's author.

1. **`NDKNip46Signer` initializes `remoteUser` to the signer (bunker) pubkey** in its constructor and **never updates it** — not even after a successful `connect`/`blockUntilReady`:

   ```js
   // node_modules/@nostr-dev-kit/ndk — NDKNip46Signer
   this.remoteUser = new NDKUser({ pubkey: remotePubkey }); // remotePubkey = SIGNER pubkey
   …
   async user() { return this.remoteUser; }
   ```

2. **`NDKEvent.toNostrEvent()` derives the author from `signer.user()`** when the event has no pubkey set:

   ```js
   if (!pubkey && this.pubkey === "") {
     const user = await this.ndk?.signer?.user();
     this.pubkey = user?.pubkey || "";
   }
   ```

3. So every event we sign is **stamped with the signer's pubkey**, while the bunker actually signs with the **user's** key. The resulting event claims `pubkey = <signer>` but carries a signature valid for `<user>`. Any verifier (nostr.build, relays, LNURL callbacks) recomputes the id, checks the signature against the stated pubkey, and rejects it.

### Why only Primal / why it was invisible elsewhere

NIP-46 explicitly allows the **signer pubkey to differ from the user pubkey**. Primal's remote signer uses this: the bunker key (`fe3faf…`) is not the user key (`ee6ea1…`). For signers where the two are equal (local nsec, NIP-07, Amber), stamping the "signer" pubkey coincidentally produces the correct value, so the bug never manifested.

The app compounds it: Primal's `connect` handshake is rejected (`We don't accept connect requests with new secret`), so `blockUntilReady()` times out. The app recovers by calling `get_public_key` to learn the real user pubkey and logs the user in — but that pubkey was **never propagated onto the signer object**, so `signer.user()` kept returning the bunker pubkey.

## The fix

After the real user pubkey is known (via `get_public_key`), bind it onto the signer and NDK so all downstream signing uses it. `remotePubkey` (the RPC routing target sent to the bunker) is deliberately left untouched.

```ts
// src/lib/authManager.ts
private bindUserToSigner(user: NDKUser): void {
  if (this.nip46Signer) {
    (this.nip46Signer as unknown as { remoteUser: NDKUser }).remoteUser = user;
  }
  this.ndk.activeUser = user;
}
```

`bindUserToSigner(user)` is called at **all three** NIP-46 entry points so every way of establishing a session is covered:

1. Fresh `bunker://` connect
2. Reconnect / restore from `localStorage`
3. `nostrconnect://` pairing

Because `toNostrEvent()` only resolves the pubkey when it is empty, fixing `signer.user()` fixes **all** signed events at once — uploads, zaps, relay auth, notes, reactions.

> Note: the pre-existing workaround that set `_remoteUser` / `_userPubkey` had no effect — those are not real `NDKNip46Signer` fields. The real field is `remoteUser`.

## Related upload hardening

While diagnosing, the four duplicated nostr.build upload implementations were consolidated into `src/lib/mediaUpload.ts` (`uploadToNostrBuild`) and made more robust for remote signers:

- **Warm the signer** (`blockUntilReady`) *before* stamping the NIP-98 `created_at`, so a slow bunker connect/approval does not consume the token's freshness window.
- **Retry once** on an auth failure with a freshly-signed, freshly-stamped token.
- Add a NIP-98 `expiration` tag.
- Fix `ImageUploader`'s signing hint, which only mentioned browser extensions (now mentions extension / Amber / Primal).

These are defense-in-depth; the signature mismatch above was the actual blocker.

## How to verify

1. Log in with a **Primal remote signer** (signer pubkey ≠ user pubkey).
2. Post an image in the composer → upload succeeds (first attempt may pause on the Primal approval prompt).
3. Send a zap → succeeds.
4. (Optional) Confirm a signed event verifies and carries the **user** pubkey:
   ```js
   import { verifyEvent, getEventHash } from 'nostr-tools';
   // event.pubkey === <user pubkey>, getEventHash(event) === event.id, verifyEvent(event) === true
   ```

## Takeaway

For NIP-46 remote signers, **do not assume `signer.user()` returns the logged-in user.** NDK reports the signer pubkey unless `remoteUser` is explicitly bound to the user pubkey learned via `get_public_key`. Any future feature that constructs and signs events through a remote signer depends on this binding; if the signer is ever re-created, re-bind.
