# Task 2 — RP Scoping Decision

**Status:** Recommendation below. Stop Gate 1: awaiting Seth's direction before Tasks 3+.

**Context carried in from Task 1:** the Breez spec derives the user's per-app Nostr identity from a *per-salt mnemonic*, not directly from `account_master`. So "share Breez's RP" yields one shared *passkey credential* and one shared *salt registry account*, but each app still needs to derive its identity from a salt. This sub-decision (which salt does zap.cooking use?) splits the original Option A into two materially different sub-options, A1 and A2.

---

## 0. Quick reference: how the WebAuthn PRF extension is scoped

This grounds the rest of the document.

- WebAuthn credentials are per-rpID. The authenticator stores a per-credential 32-byte secret called **CredRandom**, generated at credential creation and never exported.
- The PRF output is `HMAC-SHA-256(CredRandom, salt')` where `salt' = SHA-256("WebAuthn PRF" || 0x00 || developerSalt)` — the browser prepends `"WebAuthn PRF"` to domain-separate web usage from native CTAP `hmac-secret` usage.
- Therefore: **same physical authenticator + different rpID → different credentials → different CredRandom → different PRF outputs even for the same input bytes.** PRF is de facto RP-scoped.
- Synced passkeys (iCloud Keychain, Google Password Manager) sync the credential including its CredRandom, so same rpID credential on phone vs. desktop yields the same PRF output.
- The **Related Origins** mechanism lets multiple web origins (and native app IDs) operate against a single rpID. They share *one* credential and therefore *one* CredRandom — one PRF output stream. Supported on Chrome/Edge 128+, Safari/iOS 18+. Firefox positive standards position but not shipping. Chrome enforces a limit of 5 distinct eTLD+1 labels in the related-origins list.

Sources for §0: [Yubico PRF docs](https://developers.yubico.com/WebAuthn/Concepts/PRF_Extension/), [W3C WebAuthn wiki PRF explainer](https://github.com/w3c/webauthn/wiki/Explainer:-PRF-extension), [web.dev Related Origins](https://web.dev/articles/webauthn-related-origin-requests), [Levi Schuck: Related Origins](https://levischuck.com/blog/2024-07-related-origins).

---

## 1. Reframed options

Original prompt:
- A: share Breez's RP (`keys.breez.technology`)
- B: own RP (`zap.cooking`)
- C: both, with bridge

Refined per Task 1 spec reading:

| Option | RP / passkey | Salt registry (`nostr_account`) | zap.cooking identity (account 0 of which mnemonic?) | Wallet identity |
|---|---|---|---|---|
| **A1** Share RP + share salt | `keys.breez.technology` | shared with Breez | derived from the *same per-salt mnemonic* the wallet uses | derived from same per-salt mnemonic |
| **A2** Share RP + zap.cooking-specific salt | `keys.breez.technology` | shared with Breez | derived from a `"zap.cooking"` (or similar) salt's mnemonic | derived from a separate wallet salt |
| **B**  Own RP | `zap.cooking` | private to zap.cooking — wallet has its own | derived from a zap.cooking salt under zap.cooking's RP | derived under Breez's RP, totally independent |
| **C**  Both, with bridge | both | both | user picks at signup; bridging logic if a user wants to "convert" | both |

A1 and A2 differ on whether zap.cooking and the wallet share *one identity* (A1) or share *one passkey but have independent identities* (A2). C is mostly an A-or-B chooser at signup.

---

## 2. Option A1 — Share Breez RP and share the wallet's salt

### What it means

zap.cooking treats the wallet's primary salt (whatever Breez convention picks — likely a single default like "personal" or a user-chosen string) as its own. The wallet's per-salt mnemonic produces both the wallet keys and the user's zap.cooking nsec at account 0.

### UX

| Flow | Steps | Biometric prompts |
|---|---|---|
| Signup, no wallet yet | 1. Click "sign up with passkey." 2. Browser passkey ceremony fires (RP = `keys.breez.technology`). 3. PRF(MAGIC) → `account_master` → `nostr_account`. 4. Query salt registry — empty. 5. App asks for a salt (or uses a fixed default). 6. PRF(salt) → mnemonic → derive zap.cooking nsec at account 0. 7. Publish salt event to Nostr. | 1 ceremony if `eval.first`+`eval.second` are batched, else 2. |
| Signup, wallet already exists | 1. Passkey ceremony — user already has a credential under `keys.breez.technology`. 2. PRF(MAGIC) → same `account_master`. 3. Salt list returned has the wallet's salt(s). 4. zap.cooking picks one (UX: "use the same identity as your Glow wallet" — single confirm). 5. PRF(that salt) → same mnemonic the wallet uses → derive nsec at account 0 of *that* mnemonic. | Same as above. |
| Return login | Identical to signup-with-existing-wallet: master + salt → identity. | 1 batched ceremony or 2 sequential. |
| Adding a wallet later | The wallet uses the same salt; salt registry already has it; no new ceremony needed beyond what the wallet itself triggers. | 0 (zap.cooking is unaffected). |

### Infra zap.cooking needs

- **None of the well-known files of its own.** `keys.breez.technology` already publishes `/.well-known/webauthn`, AASA, and assetlinks — but **`zap.cooking` (web), `cooking.zap.app` (iOS bundle), and the Android package must be added to all three**. That requires Breez to update their published files. Operational dependency.
- **iOS Associated Domains entitlement:** `webcredentials:keys.breez.technology` (not `zap.cooking`).
- **Android:** the app must declare `keys.breez.technology` as the asset-linked domain; the Capacitor WebView will need to verify against assetlinks served by Breez.
- **Capacitor app IDs are already set:** `cooking.zap.app` (per `capacitor.config.ts`). For inclusion in Breez's well-known lists we'd give them the Apple Team ID + bundle ID and the Android signing cert SHA-256 fingerprint (production and dev).

### Failure modes

- **Breez stops publishing or changes well-known files** → zap.cooking passkey login breaks for all users immediately. There is no client-side recovery; the rpID is what the credential is bound to. Existing users cannot re-authenticate via passkey until either (a) Breez restores files, or (b) we migrate users to a different RP, which requires registering *new* passkeys with no in-place upgrade path because PRF outputs don't transfer across RPs.
- **Breez changes their default salt convention** → existing users' salts are still valid (salts are per-user data on Nostr) but new-user defaults diverge. Manageable but a coordination hazard.
- **Breez removes our origin / app ID from the related-origins list** → same effect as the "stops publishing" case but more targeted. Could be silent (no announcement) and only detected when login starts failing.
- **Chrome's 5-eTLD+1 limit on related origins** → already at risk: current `webauthn` file lists 6 web origins under at least 5 distinct eTLD+1s (`vercel.app`, `breez.technology`, `glow-app.co`, `pages.dev`, `bitlasso.xyz`). Adding `zap.cooking` adds a 6th. Behavior on Chrome: extras are silently ignored, in unspecified order. We could end up "registered" but non-functional.

### Security/privacy implications specific to A1

- The wallet developer's app code can derive zap.cooking's nsec from the same per-salt mnemonic at any time (within the wallet's runtime). This is not a "compromise" per se — both apps have legitimately gone through the passkey ceremony — but it does mean the wallet has technical access to the zap.cooking signing key. The user's threat model has to include "I trust the wallet."
- Conversely, zap.cooking's runtime can derive the wallet keys. We'd have a written policy not to, but the cryptographic isolation is gone.
- Salt registry is shared. Any zap.cooking debugging output or backend log that exposes the user's `nostr_account` npub leaks the existence of all their wallet salts. Logging hygiene becomes more sensitive.

---

## 3. Option A2 — Share Breez RP, zap.cooking owns its salt

### What it means

Same shared rpID and same `account_master`/`nostr_account`, but zap.cooking publishes and consumes its own salt — likely a fixed convention like the literal string `"zap.cooking"` or a UUID we reserve. The wallet uses different salts. zap.cooking and wallet identities are cryptographically independent (different per-salt mnemonics) even though they share the underlying passkey credential.

### UX

| Flow | Steps | Biometric prompts |
|---|---|---|
| Signup, no wallet | 1. Passkey ceremony. 2. PRF(MAGIC) + PRF("zap.cooking") batched as eval.first/eval.second. 3. Derive `nostr_account` and zap.cooking nsec. 4. Publish "zap.cooking" salt event. | 1 if batched, else 2. |
| Signup, wallet already exists | 1. Passkey ceremony — existing credential. 2. PRF(MAGIC) → same `account_master`. 3. Salt registry already has wallet salts. 4. zap.cooking adds its own salt. 5. PRF("zap.cooking") → independent identity. | 1 batched, else 2. |
| Return login | PRF(MAGIC) + PRF("zap.cooking") batched. | 1 batched, else 2. |

### Salt-discovery problem

zap.cooking needs to know which salt produces its identity. Three sub-options:

1. **Fixed string `"zap.cooking"`.** Cleanest. Discoverable by convention. Downside: defeats plausible deniability for any user who's a known zap.cooking user (because anyone querying their `nostr_account` npub will see a kind-1 with `content: "zap.cooking"`).
2. **User-chosen salt presented at signup.** Maximum deniability but worst UX — users have to remember which salt is "the cooking one" at restore time.
3. **Tagged salt event.** Use a tag like `["d", "zap.cooking"]` on the kind-1 to mark our salt. The spec says salt events are vanilla kind-1 with content = salt; adding tags would be a deviation but not a breaking one for Breez (they ignore tags). Still leaks app identity to any reader of `nostr_account`'s posts.

For zap.cooking specifically, plausible deniability is not a strong product requirement (we're a public Nostr app, the npub-as-zap.cooking-user signal already exists in many places). I'd pick (1).

### Infra zap.cooking needs

Same as A1: must be added to Breez's three well-known files. Same Capacitor entitlement. Same Chrome 5-eTLD+1 risk.

### Failure modes

Same as A1 for RP-related concerns. Stronger isolation than A1 within those constraints — wallet compromise does not directly leak zap.cooking's nsec because they're independent per-salt mnemonics.

### Security/privacy specific to A2

- Wallet *can* still derive zap.cooking's nsec, because the wallet has the passkey and the salt is a known constant — but the wallet has to actively choose to do so. It's not a side effect of normal wallet operation. Threat: malicious wallet build vs. defense-in-depth-against-honest-mistake.
- Salt registry is still shared.

---

## 4. Option B — zap.cooking owns its RP

### What it means

`zap.cooking` is its own rpID. zap.cooking's passkey credential is distinct from the wallet's. PRF outputs are completely independent. The salt registry signed by zap.cooking's `nostr_account` lives at a different npub from the wallet's.

### UX

| Flow | Steps | Biometric prompts |
|---|---|---|
| Signup | Standard WebAuthn create with rpID=`zap.cooking`. PRF(MAGIC) + PRF("default" or user salt). Derive identity. Publish salt. | 1 batched, else 2. |
| Return login | Standard WebAuthn get. PRF(MAGIC) + PRF(salt). | 1 batched, else 2. |
| Adding a wallet later | Wallet does its own ceremony under `keys.breez.technology`. **User triggers a separate biometric prompt for the wallet.** The two passkeys live side by side in iCloud Keychain/Google Password Manager. | wallet adds 1, zap.cooking unaffected. |

### Infra zap.cooking needs

- `https://zap.cooking/.well-known/webauthn` listing related origins. We'd want at minimum `https://zap.cooking` and probably `https://www.zap.cooking`. (Not strictly required if we only ever use the bare `zap.cooking` origin — but useful for any future subdomain.)
- `https://zap.cooking/.well-known/apple-app-site-association` with `webcredentials.apps` listing `<TEAMID>.cooking.zap.app` and any dev/staging variants.
- `https://zap.cooking/.well-known/assetlinks.json` with our Android package + signing cert SHA-256.
- iOS Associated Domains entitlement: `webcredentials:zap.cooking`.
- Capacitor app ID `cooking.zap.app` already aligns; need to confirm the Apple Team ID and Android signing cert fingerprints (both prod and dev keystores).
- These files need to be served from the actual `zap.cooking` apex domain. Cloudflare Pages serves the production build there today, so it's a `_headers` / `static/` addition — no infra spin-up.

### Failure modes

- **No Breez dependency.** The wallet shutting down or changing its passkey infrastructure has zero effect on zap.cooking auth.
- **Our own well-known file outage** → we own and operate it on Cloudflare Pages, so reliability matches the rest of the site.
- **No identity unification** → the user has two passkeys (one for wallet, one for zap.cooking). Most password managers display them as two entries. Not technically a failure mode but a real UX cost.

### Security/privacy specific to B

- Strong cryptographic isolation between wallet and zap.cooking — different RPs, different credentials, different PRF outputs. Compromising one does not compromise the other.
- We control rate-limiting, attestation policy, ceremony origin checks. No reliance on Breez's choices.
- We're free to add or remove related origins (within Chrome's 5-label cap) without coordinating with anyone.

---

## 5. Option C — Both, with bridge

### What it means

User chooses at signup whether to use the Breez-shared passkey (A1 or A2) or a zap.cooking-specific passkey (B). A "bridge" lets users link their two identities later if they started with one and decided to add the other.

### Reality check

- "Linking" two passkey-derived identities is hard because the derived nsec in mode B is fundamentally a different keypair from the derived nsec in mode A1/A2. Linking would mean publishing some kind of cross-signed claim event ("npub_X and npub_Y are the same person") and teaching every consumer to treat them as one. That's a Nostr-wide convention problem, not a zap.cooking problem.
- Doubling the surface area means: two registration paths, two login paths, two restore flows, two debug paths, two kinds of salt registries to query, two sets of well-known files to maintain.
- The practical "bridge" most users would actually want is: "I signed up with mode B, now I got a wallet — can I import the wallet's identity into zap.cooking?" Yes, by manually entering the wallet-derived nsec via the existing nsec-import flow. That's not a passkey feature, it's an existing one.

### Recommendation: skip C for v1.

If A or B is the right pick, run with that. If demand for unification appears, add a second passkey method later. Don't ship two paths in v1.

---

## 6. PRF-scoping reality check (cross-cutting)

Re-stating the constraint that bounds these options:

> The same physical authenticator can produce different PRF outputs scoped to different RPs, but only by holding *different credentials* — one per RP. There is no PRF-level mechanism to derive an A2 identity from a B credential or vice versa.

Practical implication: there is no migration path from B to A1/A2 that preserves the user's nsec. Switching RP = re-derive everything = new identity. This is a one-shot decision per user; the only way to change it later is to issue users a new identity.

---

## 7. Capacitor app ID interaction

- `capacitor.config.ts`: `appId: 'cooking.zap.app'`. This is the iOS bundle identifier and Android package name.
- For **Option A1/A2**: we need Breez to add `<TEAMID>.cooking.zap.app` to their AASA `webcredentials.apps` list and our Android package + signing cert SHA-256 to their assetlinks. We also need iOS `webcredentials:keys.breez.technology` in our entitlements file and Android Digital Asset Link verification pointing at `keys.breez.technology`.
- For **Option B**: same files but served from `zap.cooking`, controlled by us. iOS entitlement `webcredentials:zap.cooking`.
- Either way the Capacitor WebView passkey support depends on the OS — see Task 3 for whether PRF actually works inside WKWebView and Android WebView. (Working hypothesis: passkey *creation/use* works in WebView via the system credential dialog on iOS 18+ and Android 14+; whether the PRF extension specifically is exposed to the WebView's WebAuthn JS API is the unknown.)

---

## 8. Comparison matrix

| Dimension | A1 (share RP+salt) | A2 (share RP, own salt) | B (own RP) |
|---|---|---|---|
| Passkeys per user | 1 | 1 | 2 |
| Biometric prompts at login | 1 batched / 2 unbatched | 1 batched / 2 unbatched | 1 batched / 2 unbatched |
| Identity = wallet identity? | Yes | No (independent) | No (independent) |
| Cryptographic isolation from wallet | None | Strong (different mnemonics) | Strongest (different RPs) |
| Need Breez to add us to well-knowns | Yes | Yes | No |
| Operational dependency on Breez | High | High | None |
| Chrome 5-label limit risk | Already pressed | Already pressed | None |
| Breez RP shutdown blast radius | Total auth failure | Total auth failure | None |
| Salt-registry npub shared with wallet | Yes (one shared) | Yes (one shared) | No (separate) |
| Well-known files we maintain | 0 | 0 | 3 |
| Apple Associated Domains | `keys.breez.technology` | `keys.breez.technology` | `zap.cooking` |
| Migration to other option later | one-way break | one-way break | one-way break |
| Spec maturity exposure | Same | Same | Same |
| Coordination overhead with Breez | High (every onboarding/cert change) | High | None |

---

## 9. Recommendation: **Option B — own RP `zap.cooking`**

### Why

1. **No operational coupling to Breez.** This is the dominant factor. Every other option puts our auth uptime behind a vendor whose well-known files are currently shipping a placeholder (`com.example.passkeyprf` is still in their live assetlinks.json). That's a real signal about change-management discipline. Coupling our login system to that surface is a bet I would not take.
2. **Chrome's 5-eTLD+1 cap is a real ceiling.** Breez's list is already at the limit. Adding us means displacing someone else, or being silently dropped, with no visibility into the order Chrome picks.
3. **Strongest isolation by default.** Compromising the wallet's passkey-derived keys does not touch zap.cooking. The opposite is also true. Two-passkey setup is a feature, not a bug, for this kind of crypto-asset-adjacent product.
4. **No migration path between options anyway.** Since we can't safely switch RPs later, the choice is basically irrevocable per-user. The reversibility argument that usually favors "share now, isolate later" doesn't apply. Lean into the option that's defensible long-term.
5. **Simplicity.** We own three static files in `static/.well-known/` and an iOS entitlement and an Android Digital Asset Link. That's a one-day infra task. We don't have to wait for Breez to update anything to ship.
6. **The unification benefit of A1/A2 is real but small.** "One passkey covers both" is nice; "one ceremony covers both" still needs careful eval.first/eval.second batching that may not be supported in every WebView. The biometric-prompt count is identical to B in the realistic case. The wallet, when it's installed, has its own login UX anyway.

### What we lose by picking B

- Users who already have a Breez/Glow passkey will need a second one for zap.cooking. Most users won't have one — Breez's passkey rollout is early-2026 and Glow is still small. By the time it matters, both passkeys exist side-by-side in the system credential manager and the friction is one extra "Sign in with passkey" tap, which the OS treats as one autofill option among others.
- We can't claim "your wallet identity *is* your zap.cooking identity." We'd communicate it as "your zap.cooking identity is a Nostr identity derived from a passkey on this device, separate from your wallet's identity. Use NIP-07/NIP-46/nsec import if you want to bring an existing Nostr identity in."

### Decision-changer signals

I would change this recommendation if any of the following turn out to be true:

- **Breez publicly commits to enterprise-grade SLA on `keys.breez.technology` well-known files** (signed releases, change log, public outage history). Not today — they're still pre-1.0.
- **A2's salt-discovery via fixed string is acceptable AND product wants explicit identity-unification with the wallet as a marketing message.** In that case A2 (not A1) makes sense — A1's "wallet can derive zap.cooking nsec" is a hard sell in a security review.
- **Chrome lifts the 5-eTLD+1 cap or Breez prunes their list to leave headroom.** Lifts the practical risk on A1/A2.

---

## 10. What unblocks Tasks 3+ given this recommendation

If Seth confirms Option B:
- Task 3 narrows: we don't need to validate Breez's RP-specific PRF behavior, only generic PRF/WebAuthn support.
- Task 4 narrows further: we don't need the Breez SDK's passkey hook at all. We use the spec's algorithms, derive our own per-salt mnemonics, and remain interoperable with the spec for any future bridging.
- Task 5 expands slightly: we own the WebAuthn server logic end-to-end on Cloudflare Workers.
- Task 6 expands: we own challenge/verify endpoints. The members.zap.cooking Postgres gains a credentials table.
- Task 8 expands: we own the well-known files and entitlements.
- Task 9 simplifies: no Breez vendor risk to assess.

If Seth picks A1, A2, or C, Tasks 3–9 reframe accordingly.

---

> 🛑 **STOP GATE 1 — awaiting Seth's confirmation of RP scoping direction before continuing.**
