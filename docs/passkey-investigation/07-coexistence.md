# Task 7 — Coexistence with Existing Auth Methods

**Status:** Complete.

**Hard reality the prompt names directly:** passkey-derived keys cannot be retrofitted onto existing nsecs. The PRF-based derivation is one-way from the passkey, and the resulting nsec is whatever the derivation produces — not whatever the user already has. **Passkey login is therefore an *additive* method for new users, not a migration target for the ~existing user base.** This document spells out what that means concretely and what the UX should look like.

---

## 1. zap.cooking's existing auth landscape

From `src/routes/login/+page.svelte` and `src/lib/authManager.ts`, the current sign-in methods are:

| Method | How it acquires the nsec | Persistence |
|---|---|---|
| **NIP-07** (browser extension: nos2x, Alby, etc.) | Extension holds the nsec; signs events without exposing the secret to the page | None on our side; extension persists across sessions |
| **NIP-46 / Bunker** (remote signer like nsec.app, Amber) | Remote signer over a shared secret; events round-tripped via Nostr relays | Bunker URI typically saved in localStorage by the client |
| **NIP-46 universal pairing (QR)** | Same as bunker but bootstrapped via QR-encoded pairing URI | Same |
| **nsec import** | User pastes a `nsec1…` string; client decodes and holds in memory | Optional localStorage stash if user opts in |
| **Generate new account** | Client uses `nostr-tools.generateSecretKey()` and presents the user with the new nsec to back up | Same as nsec import after generation |

These are all client-side. The server has no notion of "logged in" — it just sees published events on relays and can independently look up membership records by npub on `pantry.zap.cooking`.

---

## 2. Passkey is an additive sixth method

zap.cooking grows by one row in the methods table:

| Method | How it acquires the nsec | Persistence |
|---|---|---|
| **Passkey login (new)** | Client triggers WebAuthn ceremony; PRF outputs derive an nsec via BIP39/BIP32 | Server stores credential metadata; **never** the nsec. Browser/iCloud/Google PM stores the passkey. |

Crucially: **the nsec produced is a function of the passkey + the salt**. It is not configurable. A user who already has an existing Nostr identity (e.g., `npub1abc…` they've been using for years) cannot make their passkey produce that nsec. The passkey would produce *some other nsec*, `npub1xyz…`, which is the user's "passkey identity," not their existing identity.

---

## 3. UX matrix by user state

| User state | Recommended UX |
|---|---|
| **New user, no Nostr identity yet** | "Sign up with passkey" is featured prominently. Walks them through the WebAuthn ceremony, derives the identity, publishes the salt event. Done. They now have a Nostr identity backed by a passkey. |
| **Returning user who signed up via passkey** | "Sign in with passkey" — discoverable credential flow, one biometric, in. |
| **New user who'd rather use an existing extension** | "Sign in with NIP-07 extension" — unchanged from today. |
| **Existing user with their own nsec** | All existing flows (NIP-07, NIP-46, nsec import, generate) remain available. Passkey is an option but with a clear note: "Creates a *separate* identity from your existing one." |
| **Existing user wants a passkey backing their *existing* nsec** | **Not supported.** Passkey-derived keys are bound to the passkey, not arbitrary. We can offer "create a new identity backed by a passkey," but cannot wrap their old nsec inside one. |
| **Existing user wants both identities (current nsec for primary, passkey for a "secondary"/anonymous account)** | Supported by virtue of both flows existing independently. They sign in with one or the other; the app holds whichever is currently active. |

---

## 4. Specifically: should we offer "create a *second* identity via passkey" for existing users?

The prompt asks this. My answer: **yes, but as a secondary CTA, not the default.**

Reasoning:
- Some power users may want a passkey-backed "burner"/secondary identity for casual posting while their main npub is on a hardware-backed extension.
- The crypto already supports it (every passkey + salt combination is its own identity).
- The salt-discovery UX (Task 2 §3) gives us a place to expose "your passkey can hold multiple identities, one per salt." We could, for example, allow advanced users to enter a custom salt at signup ("burner-2026", "podcast-account").

**Recommendation for v1:** ship single-salt-per-user (the literal string `"zap.cooking"`) for simplicity. Defer multi-salt UX to v2 unless user research surfaces demand. The on-Nostr salt registry is forward-compatible; we don't lock ourselves out of multi-salt by going single-salt first.

---

## 5. Session model

### In-memory only

Match the existing authManager pattern:

- At login, derive the nsec from PRF outputs in a Web Worker or inline (Worker preferred; lets us avoid the nsec ever sitting in window-scope variables).
- Hold the nsec in a closure inside `authManager` for the session.
- Expose only a `signEvent(unsignedEvent)` method to the rest of the app. The nsec never leaves the closure.
- On tab close / explicit logout: drop the closure. Nothing to clean up server-side because there is no server session.

### No per-event biometric prompts

The user authenticates once at login (one biometric) → nsec is in memory for the session. Every event signed during the session reuses the in-memory nsec. **We don't trigger a passkey ceremony per event.**

This is the same UX as nsec import or extension auth today. The difference is just *how* the nsec arrives at the in-memory `authManager`.

If we ever want stronger per-event guarantees (e.g., for high-value actions like membership purchases, account export, NIP-46 delegation), we *could* trigger a fresh PRF ceremony for re-auth. Worth keeping in mind for sensitive ops; not v1.

### Re-login = re-derive

If the user closes the tab and comes back, the nsec is gone from memory. They sign in again with the passkey, which fires the WebAuthn ceremony again (one biometric prompt), produces the same PRF outputs (because synced/non-rotating), produces the same nsec. Same identity.

### Logout

Logout button → drop nsec from memory closure → `userPublickey` store cleared → UI returns to logged-out state. The passkey credential remains registered in the browser/Apple/Google credential store; logout doesn't deregister it.

---

## 6. Account export / recovery

### BIP39 mnemonic export

Per the spec (Task 1 §6), each per-salt root_key has a BIP39 mnemonic representation (24 words for 256-bit entropy). We can offer:

> **"Back up your identity"** — show the 24-word phrase derived from the per-salt mnemonic. User writes it down or saves it to a password manager.

This is the recovery anchor for the case where the passkey is lost (device + iCloud Keychain wiped, all Apple-account-recovery options exhausted, etc.). With the 24 words, the user can re-derive the same nsec without ever touching the original passkey.

UX flow:
1. Account settings → "Show backup phrase."
2. Re-authenticate with passkey (fresh assertion → fresh PRF outputs → re-derive mnemonic).
3. Display 24 words with "I've written this down" gate.
4. Optional: "Verify your backup" — quiz the user on a few words.

### Restore from backup phrase

Out of scope as a *passkey* feature — but trivially supported by the existing nsec-import flow if the user converts the mnemonic to nsec themselves. Could be made more first-class: an "I lost my passkey, restore from backup phrase" UI that takes the 24-word phrase, derives the same nsec via BIP39/BIP32, and signs the user in via the existing nsec-import path.

This re-creates the user's session without the passkey; they would then optionally register a *new* passkey on their *new* device, scoped to the same npub.

### Wait — can a new passkey produce the same nsec?

No. A fresh passkey on a new device, even with the same backup phrase, won't produce the same PRF outputs (different CredRandom). The user can either:
1. Use the synced passkey from iCloud / Google PM (which *does* produce the same PRF outputs — that's the cross-device recovery path), or
2. Use the BIP39 mnemonic to recover the nsec without the passkey (which works but stops being a "passkey" identity at that point — they'd be back to nsec-import territory).

So the **layers of recovery** are, in order of preference:
1. Same passkey synced via iCloud Keychain / Google PM → seamless restore on new device.
2. Backup BIP39 phrase → manual restore via existing nsec-import flow. User can register a fresh passkey on the new device, but it'll be scoped to a new identity unless they're explicit about not using passkey for the recovered nsec.

---

## 7. Adding/removing methods to the same npub

Today: a user with NIP-07 can also add a backup NIP-46 by re-logging-in with the bunker URI. The npub is the same; the *signing path* is different.

Passkey: the constraint changes. Adding a passkey to an existing nsec-based account doesn't make sense because the passkey would derive a *different* nsec. **You can't "add a passkey to your existing identity"** — you can only add a passkey to a *new* identity.

You *can*, however, register additional passkey credentials *for the same passkey-derived identity* (e.g., your iPhone passkey + your Mac passkey both reach the same iCloud Keychain → same credential → same PRF → same identity). The credentials list (Task 6) handles multiple per-npub registrations.

---

## 8. Communication recommendations (UI copy starting points)

For new users:
> **Sign up with passkey** — Use Face ID, Touch ID, or your security key. We'll create a new Nostr identity for you, anchored to your device. No password, no backup phrase needed (unless you want one).

For existing-user opt-in (settings page, *not* prominent on login):
> **Add passkey login**
>
> Passkey login creates a new, separate Nostr identity from your current one. You can use both — pick one to sign in with each session.
>
> Why a separate identity? Passkeys derive their signing key from the device, not from your existing keys. There's no way to wrap an existing key inside a passkey.

For passkey users at the "show backup phrase" prompt:
> **Save a backup phrase**
>
> Your passkey lives on your device(s) and syncs via iCloud Keychain or Google Password Manager. If you lose access to all of those, this 24-word phrase is the only way to recover your zap.cooking identity.
>
> Treat this like a Bitcoin seed phrase. Anyone who reads it can sign in as you.

For passkey-provider compatibility (signup-time check):
> **Heads up:** the passkey provider you're using (Bitwarden / KeePass) doesn't support the PRF extension required for passkey login. Use Apple Keychain, Google Password Manager, 1Password, or Dashlane instead — or sign in with a Nostr extension.

---

## 9. Existing methods stay unchanged

- **NIP-07 / nos2x / Alby**: untouched.
- **NIP-46 / bunker**: untouched.
- **Universal NIP-46 QR**: untouched.
- **nsec import**: untouched.
- **Generate new account**: untouched. Possibly de-emphasized vs. passkey signup since both create new identities, but available.

The existing `authManager` becomes one of *six* possible auth source paths. All paths converge on `{ pubkey, signEvent() }` for the rest of the app. Routing logic in the auth manager grows by one branch.

---

## 10. Spec alignment (carried from Task 1)

Following Breez's per-salt spec keeps zap.cooking-derived passkey identities portable to any other spec-compliant app. A user who registers a passkey on zap.cooking and later wants to sign into a hypothetical other zap.cooking-style Nostr app could re-derive the same identity if that app:
- Used the same RP (no — different app, different RP, different PRF), OR
- Was given the BIP39 backup phrase

So portability *to other apps* requires the backup phrase. Portability *across the user's own devices* requires the synced passkey. We support both.

---

## 11. Open questions

| # | Question | Resolution |
|---|---|---|
| Q1 | Show passkey signup option to logged-out users above NIP-07, below it, or A/B test? | Defer to UX after spike completes; default to "alongside, not above." |
| Q2 | Auto-prompt existing users to "set up a passkey backup" if they ever sign in via nsec import? | No for v1 — existing users have their own backup story (their original key generation method). |
| Q3 | Allow custom salt strings ("burner identity") in v1? | No — `"zap.cooking"` only. Defer multi-salt to v2. |
| Q4 | What happens when a user revokes their last passkey credential and has no other auth method registered? | Block deletion of last credential without prior confirmation. Show "you'll be locked out — add another login method first or save your backup phrase." |
| Q5 | Should the backup phrase be written into a prominent "set this up now" gate at signup, or surfaced in settings? | Settings, with a one-time soft-banner after first login asking the user to back up. Heavy gating at signup adds friction; passkey sync is the primary recovery anyway. |
