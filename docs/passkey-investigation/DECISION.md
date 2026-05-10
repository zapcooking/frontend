# DECISION — Phase B: Passkey Login for zap.cooking

**Audience:** Seth + future contributors / reviewers.
**Status:** Phase B investigation complete. This document is the single source of truth for what Phase C should build and why.
**Companion docs:** `01-breez-spec-summary.md` … `09-security-review.md` in the same directory.

---

## TL;DR

- **Build it.** Passkey login is a strong fit for zap.cooking: phishing-resistant, low-friction signup, additive to existing auth methods.
- **RP scoping: Option B.** zap.cooking owns its own RP (`zap.cooking`), three well-known files served from our domain, no operational dependency on Breez.
- **Don't use the Breez SDK on the auth path.** Implement the spec's derivation algorithms directly with `@scure/bip39` + `@scure/bip32` + `@noble/secp256k1` + `nostr-tools`. Stay spec-aligned for forward interop.
- **Capacitor needs a native plugin** that bridges WebAuthn ceremonies (with PRF) to `ASAuthorizationController` (iOS 18+) and Credential Manager (Android API 28+). Web SvelteKit uses SimpleWebAuthn directly.
- **Passkey is additive, not a migration.** Existing nsecs cannot be wrapped in passkeys; new identities only.
- **Phase C effort: M to L.** ~3–6 weeks of focused engineering, plus mobile review cycles. Detailed estimates in §6.

---

## 1. RP scoping decision

**Decision: Option B — zap.cooking owns RP `zap.cooking`.**

(Full reasoning in `02-rp-scoping.md`.)

Rationale, ranked by weight:

1. **No operational coupling to Breez.** Their well-known files currently still ship a placeholder package (`com.example.passkeyprf`); change-management discipline is informal. Coupling our login uptime to that surface is an unacceptable bet.
2. **Chrome's 5-eTLD+1 cap on Related Origins is real.** Breez's list is already at the limit. Adding us = silent dropout risk.
3. **Strongest cryptographic isolation.** Compromising the wallet's passkey-derived keys does not touch zap.cooking. Two-passkey setup is a feature, not a bug, for crypto-asset-adjacent products.
4. **No migration path between options anyway.** PRF outputs don't transfer across RPs. The "share now, isolate later" reversibility argument doesn't apply — pick the long-term-defensible option.
5. **Three static files + one entitlement = one-day infra task.** No coordination required with anyone.

**What we lose:** users with a Breez/Glow passkey will need a second one for zap.cooking. The OS credential picker treats them as parallel options; the friction is one extra autofill tap.

---

## 2. Architecture decisions

### 2.1 Spec alignment

We follow the Breez "Passkey-Derived Deterministic Key Generation via PRF and Nostr Salt Lookup" spec **v0.9.1** for all algorithms (PRF magic constant, BIP32 paths, salt registry kind-1 events). We pin to v0.9.1 in code; future spec changes require a deliberate version bump, not a transparent rollout.

Resolved discrepancy from Task 1: the prompt's "account 0 derived from `account_master`" was a misreading. The spec derives account 55 (salt registry signer) from `account_master`, and account 0 (user identity) from a per-salt mnemonic. We follow the spec.

### 2.2 Salt strategy

**Single fixed salt: `"zap.cooking"`** for v1. Defer multi-salt UX to v2.

This means each user's identity is `m/44'/1237'/0'/0/0` of `BIP39(PRF(passkey, utf8("zap.cooking")))`.

### 2.3 Library stack

| Layer | Library | Notes |
|---|---|---|
| WebAuthn server (Workers) | `@simplewebauthn/server` | Works on Workers via `nodejs_compat` (already enabled) |
| WebAuthn browser | `@simplewebauthn/browser` | Pairs with above; PRF extension support out of the box |
| BIP39 mnemonic | `@scure/bip39` (replace existing `bip39`) | Same author as `@scure/bip32`, smaller bundle |
| BIP32 derivation | `@scure/bip32` (new) | Audited, ESM, Workers-clean |
| secp256k1 / Nostr keys | `nostr-tools` (already shipped) | Uses `@noble/secp256k1` internally |
| Hashes | `@noble/hashes` (already shipped) | For any HMAC/SHA needs in the pipeline |
| Capacitor passkey bridge | Fork of `Cap-go/capacitor-passkey` (most likely) | Spike first; build from scratch if needed |

### 2.4 Backend storage shape

New Postgres table on pantry.zap.cooking (`webauthn_credentials`) holds: credential ID, public key (COSE), counter, AAGUID, transports, nostr_pubkey binding, optional salt_registry_pubkey, device_label, timestamps. **Never** the derived nsec.

New Cloudflare KV namespace `WEBAUTHN_CHALLENGES` holds short-lived (300s TTL) registration/authentication challenges.

Seven new SvelteKit `+server.ts` endpoints under `src/routes/api/auth/passkey/{register,login,credentials}/...` plus three new pantry endpoints for credential CRUD.

### 2.5 Session model

**No server sessions in v1.** Match the existing client-holds-the-key model used by NIP-07/NIP-46/nsec import. Passkey login derives the nsec client-side; the server's role is to verify the WebAuthn assertion, return the npub binding, and step out.

Derived nsec lives in a Web Worker scope for the session. Logout = drop the worker. Cross-tab persistence = none for v1.

### 2.6 Coexistence

Passkey is the sixth auth method in `authManager.ts`, additive to NIP-07, NIP-46, NIP-46-QR, nsec import, and generated keys. **Existing flows are not modified.**

Passkey signup creates a new identity. Existing users with their own nsec keep using their current method; passkey is offered as a secondary option only with a clear "this is a separate identity" disclaimer.

---

## 3. Required infrastructure changes

### 3.1 zap.cooking domain (Cloudflare Pages)

| File | Path | Purpose |
|---|---|---|
| `static/.well-known/webauthn` | `https://zap.cooking/.well-known/webauthn` | Related Origins (only needed if subdomains added later — v1 file lists only `zap.cooking`) |
| `static/.well-known/apple-app-site-association` | served at the same path | iOS Capacitor `webcredentials.apps` linkage |
| `static/.well-known/assetlinks.json` | served at the same path | Android Capacitor Digital Asset Links |
| `static/_headers` (modified) | n/a | Force `Content-Type: application/json` for the two extension-less files |
| `wrangler.jsonc` (modified) | n/a | Add `WEBAUTHN_CHALLENGES` KV binding |

### 3.2 iOS Capacitor app

- Add `ios/App/App/App.entitlements` with `com.apple.developer.associated-domains = ["webcredentials:zap.cooking"]`.
- Wire entitlement file into Xcode build settings (Code Signing Entitlements → `App/App.entitlements` for both Debug and Release).
- Apple Developer portal: enable Associated Domains capability on App ID `cooking.zap.app`.
- Confirm Apple Team ID with Seth — needed for the AASA file.
- Install chosen passkey plugin via `npx cap sync ios`.
- Runtime check: `if #available(iOS 18, *)` before showing passkey UI.

### 3.3 Android Capacitor app

- Capture SHA-256 fingerprints of release and debug signing certs → assetlinks.json.
- Add Credential Manager dependencies via plugin (or directly in `android/app/build.gradle`):
  ```
  implementation "androidx.credentials:credentials:1.6.0-beta02"
  implementation "androidx.credentials:credentials-play-services-auth:1.6.0-beta02"
  ```
- AndroidX WebKit 1.14.0 already declared — no change needed.
- Runtime check for API 28+ before showing passkey UI.
- `npx cap sync android`.

### 3.4 pantry.zap.cooking Postgres

- New table `webauthn_credentials` (schema in `06-backend-impact.md` §1).
- Three new endpoints (`POST/GET/DELETE /api/members/:pubkey/credentials*`).
- Standalone migration deployed before Workers code that uses it.

---

## 4. Phased Phase C implementation plan

Phases sized as **S** (≤ 1 week / ~3 days), **M** (1–2 weeks), **L** (2–4 weeks).

### Phase C.0 — Validation spikes (S, ~3 days)

Validate the assumptions that have the highest impact-if-wrong:

1. Spike `Cap-go/capacitor-passkey` against a `zap.cooking`-scoped credential with PRF on a real iOS 18.4+ device. Confirm `clientExtensionResults.prf.results` round-trips.
2. Same on real Android device (Pixel + Google Password Manager).
3. Verify `eval.first` + `eval.second` batching works through both web and the plugin.
4. Verify the PRF salt prefix produces matching outputs on web vs. native (the cross-platform consistency property).

**Decision checkpoint:** if any spike fails, decide whether to fork the plugin, build our own, or ship web-only first.

### Phase C.1 — Infrastructure (S, ~3 days)

- Deploy three well-known files. Verify with curl + Apple/Google CDN endpoints.
- Provision `WEBAUTHN_CHALLENGES` KV namespace.
- Create and deploy the pantry.zap.cooking schema migration.

### Phase C.2 — Web auth (M, ~1.5 weeks)

- New `src/lib/passkey/derive.ts` — the PRF-to-nsec pipeline (§3.2 of `05-implementation-path.md`).
- New `src/lib/passkey/saltRegistry.ts` — publish/query helpers using existing nostr-tools / NDK.
- New `src/lib/passkey/passkeyClient.ts` — wrapper around SimpleWebAuthn (web) and Capacitor plugin (native).
- New `src/routes/api/auth/passkey/{register,login,credentials}/...` endpoints.
- Cross-platform test fixtures (same passkey produces same nsec on Safari macOS and Chrome Mac).
- Integration with existing `authManager` as a sixth method.
- UI: "Sign in with passkey" / "Sign up with passkey" buttons on `/login`.
- Settings page: credentials list, rename, revoke, backup phrase reveal.
- Web-only release: ship to production behind a feature flag via existing `NOURISH_FLAGS`-style pattern (or a new `PASSKEY_FLAGS` KV).

### Phase C.3 — Mobile auth (M, ~1.5 weeks)

- Integrate chosen Capacitor plugin (or merge our fork).
- iOS: entitlement file, Xcode wiring, deployment-target-aware runtime check.
- Android: Gradle dependencies, signing fingerprint verification, API-level runtime check.
- Cross-platform tests: same passkey synced via iCloud/Google PM produces same nsec on web and native.
- TestFlight (iOS) and Play Internal Track (Android) rollout for ≥ 1 week before promoting.

### Phase C.4 — Hardening + polish (S, ~3 days)

- Web Worker isolation for in-memory nsec.
- Re-auth gate on credential delete.
- Soft-banner: "back up your phrase" post-first-login.
- Telemetry: passkey signup conversion rate, PRF-not-supported error rates by platform/provider, AAGUID distribution.
- Security policy doc updated: passkey-specific recovery instructions, sync-compromise warning.

### Phase C.5 — Public launch (S, ~2 days)

- Promote feature flag.
- Announce on Nostr, blog, in-app notification.
- Monitor for support inquiries.

**Total:** ~3–5 weeks of focused engineering work. Plus 1+ weeks of TestFlight/Play Internal review cycles in parallel with C.4.

---

## 5. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Capacitor plugin spike (C.0) fails on Android PRF | Medium | Push back C.3 by 1–2 weeks; possibly ship web-only first | Have plugin fork plan ready; web-only fallback is acceptable interim |
| Spec v0.9.1 changes substantively in next 12 months | Medium | We continue using v0.9.1 algorithms; lose cross-app interop aspiration | Pin in code; document our pinned version |
| Apple changes WKWebView entitlement landscape | Low | Could simplify our plugin or invalidate the approach | Architecture isolates the plugin behind an interface; swappable |
| User passkey provider doesn't support PRF (Bitwarden, KeePass) | Medium for power users, low overall | That user can't use passkey login | Detect at registration via `prf.enabled`; show "use Apple/Google/1Password/Dashlane or use a Nostr extension" |
| Cross-platform PRF output divergence | Medium | Same passkey produces different identities on different platforms — silently broken sync recovery | Mandatory cross-platform integration tests before launch (C.2/C.3) |
| User loses passkey + iCloud + backup phrase | Low for any one user, certain in aggregate | That user's identity is unrecoverable | Prominent "this is your only backup" messaging + soft-gated backup-phrase prompt |
| Pantry schema migration deployed but Workers code not yet shipping | None — schema is additive, no consumers | n/a | Standard migration discipline |
| Workers KV TTL precision under load | Low | A challenge could survive 10s past TTL — still single-use, still bound to RPID | Negligible, doesn't open exploitable window |
| Spec author abandons project | Low-medium | We continue to operate; lose interop aspiration | Acceptable — we own implementation |
| Wallet integration complicates the story later | Medium | Confused messaging if we ship a Breez wallet | Document clearly: passkey for zap.cooking auth ≠ passkey for the wallet (different RPs, different keys, both fine) |

---

## 6. Effort summary

| Phase | Effort | Team-week range |
|---|---|---|
| C.0 — Spikes | S | 0.5–0.6 weeks |
| C.1 — Infra | S | 0.5–0.6 weeks |
| C.2 — Web auth | M | 1.5–2 weeks |
| C.3 — Mobile auth | M | 1.5–2 weeks |
| C.4 — Hardening | S | 0.5–0.6 weeks |
| C.5 — Launch | S | 0.4 weeks |
| **Total engineering** | — | **~5–7 team-weeks** |
| App Store review (iOS) | wall-clock | 1 week typically; up to 2 weeks if rejected once |
| Play Console review (Android) | wall-clock | 1–3 days for internal tracks; up to 1 week for production |

These are upper-bound estimates assuming one experienced full-stack engineer. With two engineers in parallel (one web, one mobile after C.0/C.1) the wall-clock could compress to ~3 weeks for engineering.

---

## 7. Decision checkpoints — what would change the recommendation

| If we learn… | Then we should… |
|---|---|
| Breez publishes signed-release SLA on `keys.breez.technology` well-known files | Reconsider Option A2 (shared RP, own salt) for the unification benefit |
| The Cap-go plugin spike fails on both iOS and Android PRF | Reconsider scope: ship web-only v1, defer mobile to v2 |
| User research shows demand for "sync my zap.cooking identity into another spec-compliant app" | Promote the BIP39 backup phrase from optional to default, and document the cross-app derivation steps |
| App Store / Play Store review rejects the entitlement / package linkage | Defer mobile until we work through the rejection; web ships independently |
| A different passkey-and-Nostr spec gains traction (e.g., a NIP) | Re-evaluate spec alignment; potentially support multiple |
| Existing user demand surfaces for "wrap my existing nsec in a passkey" | Investigate whether a hybrid approach (passkey unlocks an encrypted local nsec) makes sense as a separate v2 path |

---

## 8. Explicit non-goals for v1

1. **Migrating existing nsec users to passkey-derived identities.** Cryptographically impossible without changing what an identity is. Won't ship.
2. **Multi-salt UX** ("create a burner identity"). Defer to v2.
3. **Shared RP with Breez.** Decided no in §1.
4. **Server-side session management.** Out of scope; matches existing model.
5. **Cross-app interop with hypothetical other Breez-spec consumers.** Aspirational, not promised. The BIP39 backup phrase is the manual escape hatch.
6. **YubiKey / hardware-key-only mode.** Not blocked, but not designed-for in v1. Most users will use platform passkeys (Apple/Google/1Password).
7. **NFC / cross-device QR ("phone as authenticator") flows.** Inherited via WebAuthn defaults; not a feature we explicitly tune for v1.
8. **Push or email notifications on new-device sign-in.** Requires infrastructure we don't have.
9. **Bridging zap.cooking passkey identity to Lightning wallet operations.** That's a Phase D conversation about wallet integration generally.

---

## 9. Reading order for reviewers

1. This file (`DECISION.md`) — what and why.
2. `02-rp-scoping.md` — the central decision walked through with all options.
3. `01-breez-spec-summary.md` — the spec we're following + the discrepancy that was resolved.
4. `07-coexistence.md` — UX framing for new vs. existing users.
5. `09-security-review.md` — risk posture.
6. Other task docs as needed.

---

## 10. Phase B in one paragraph

zap.cooking should add passkey login as an additive sixth auth method, scoped to its own WebAuthn RP (`zap.cooking`), following the Breez passkey-login spec v0.9.1's PRF→BIP39→BIP32 derivation algorithms but operating its own infrastructure end-to-end. The biggest open implementation question is the Capacitor plugin's PRF behavior, validated by a 3-day Phase C.0 spike before committing to the mobile path. Total engineering effort is in the 5–7 team-week range with no architectural surprises remaining. Existing users keep their existing identities and methods; passkey is for new users and additional secondary identities. The result is phishing-resistant, low-friction onboarding for new users with no operational dependency on Breez.

---

## 11. Breez SDK coexistence and future wallet-passkey path

zap.cooking currently integrates Breez SDK with passkey login **not** enabled. Wallet keys are managed via the SDK's internal seed mechanism. This has two consequences for the Option B decision:

1. **No second-passkey friction at launch.** The zap.cooking passkey shipping under rpID `zap.cooking` will be the first passkey users encounter in this app. There is no existing Breez-derived credential for it to compete with.

2. **Future wallet-passkey path is preserved.** If product direction later calls for passkey-backed wallet key management, the correct path is **not** to flip `enablePasskey: true` in Breez SDK — doing so would register a credential under `keys.breez.technology` and reintroduce the two-passkeys-for-one-app friction that Option B explicitly avoids. Instead, derive wallet keys under our own RP using the Breez spec's salt mechanism: `PRF(passkey, "<wallet-salt>")` produces a 32-byte seed; BIP39-encode for storage portability; BIP32-derive for wallet operations. One passkey, two derivations — Nostr identity from `PRF(passkey, "zap.cooking")`, wallet seed from `PRF(passkey, "<wallet-salt>")`.

This is a Phase D consideration if/when passkey wallet management becomes a product goal. Captured here so the path isn't accidentally closed off by enabling Breez's built-in passkey login at some later date.
