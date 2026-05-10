# Task 9 — Security Review

**Status:** Complete. Stop Gate 2: this is the last per-task doc before the consolidated DECISION.md.

**Scope:** threat model and risk assessment for the Option B (own RP) implementation sketched in Tasks 1–8. Where Tasks 1–8 already addressed a risk, I link to it instead of restating.

---

## 1. Phishing resistance

WebAuthn's defining property: assertions are bound to the RP origin by the authenticator, and verified server-side. An attacker who clones our login UI at `evil.com` cannot get a real `zap.cooking` passkey to sign a challenge — the browser refuses to even surface the credential because the rpID doesn't match.

**Conclusion:** strong by design. No additional mitigation needed.

**Caveat:** the Capacitor native plugin path bypasses the browser-level origin enforcement and re-implements it in the plugin. Plugin code must:
- Set `rpId: "zap.cooking"` explicitly.
- Verify the OS-returned `clientDataJSON.origin` matches `https://zap.cooking` (web) or `cooking.zap.app` (Capacitor) — *don't* trust the request payload's origin field.
- Reject mismatches.

The chosen plugin (per Task 5 §2.2) must enforce these. We test this in the Phase C spike.

---

## 2. Server compromise

If `pantry.zap.cooking`'s Postgres or the SvelteKit Workers env are compromised, what does an attacker get?

| Artifact stolen | Attacker's gain |
|---|---|
| `webauthn_credentials.credential_id` | Public information; cannot be used to authenticate (no private key) |
| `webauthn_credentials.public_key` | Used to verify assertions; **cannot generate them** |
| `webauthn_credentials.counter` | Just a number; rolling it back doesn't unlock anything |
| `webauthn_credentials.aaguid` | Tells attacker which authenticators users have (Apple Keychain vs YubiKey vs 1Password). Mild fingerprinting; not exploitable. |
| `webauthn_credentials.nostr_pubkey` | The user's npub. Already public on Nostr. No leakage. |
| `webauthn_credentials.salt_registry_pubkey` | The user's salt-registry npub. With it, attacker can query Nostr to enumerate all published salts (just `"zap.cooking"` for v1). Confirms the user is registered — but that's also derivable from the credential row. |
| Workers env secret used for session JWTs | If we go with server sessions — attacker can forge sessions. We're not in v1 (Task 6 §3 recommends no server sessions). N/A for v1. |

**Critical fact:** the server **never holds key material that an attacker could use to impersonate users.** No nsecs, no PRF outputs, no per-salt mnemonics.

**Conclusion:** server compromise is recoverable. Worst case is that we have to invalidate sessions (none in v1) and rotate any auth-time secrets (none in v1). Users' identities and signing keys are unaffected.

---

## 3. Client compromise during session

While the user is signed in, the derived nsec sits in browser memory (Task 7 §5). An attacker who can:
- Run JS in the page (XSS via a vulnerability in our code, malicious browser extension, dev-tools console with social engineering)
- Inspect process memory (malware on the user's machine)

…can read the nsec. **Same exposure as today's nsec-import flow.**

This is *not* a regression from existing auth methods:
- NIP-07: extension holds nsec; if extension or its host page is compromised, signing requests can be hijacked.
- NIP-46/bunker: signing happens remotely over Nostr; somewhat better isolation, but the bunker secret in localStorage is similar exposure.
- nsec import: nsec in localStorage or memory; identical exposure.
- Generated keys: same as nsec import.

Mitigations we already have or should add:
- CSP header restricting script sources (already in production via SvelteKit + Cloudflare defaults; verify).
- DOMPurify on user-provided HTML (already in `package.json`).
- Optional: derive the nsec inside a Web Worker so it lives in worker memory rather than main-thread memory. Adds isolation without changing UX. **Recommended for v1.**
- Optional: re-prompt for passkey on high-value ops (membership purchase, account export, NIP-46 delegation). Defer to v2.

**Conclusion:** equivalent to current auth methods. The Web Worker isolation is a small additional hardening worth doing.

---

## 4. Lost passkey

Recovery layers (per Task 7 §6):

1. **Synced passkey on a different device** (iCloud Keychain / Google Password Manager / 1Password / Dashlane sync). Most users land here. Same passkey credential synced → same CredRandom → same PRF outputs → same nsec. Seamless.
2. **BIP39 mnemonic backup phrase** (if user opted to write it down). Re-derives the nsec via the existing nsec-import flow. The user is signed in but no longer has a passkey for that identity until they register a new one (which would produce a *new* identity, not the recovered one — see Task 7 §6 for why).
3. **No recovery option exhausted.** The identity is unrecoverable. Account is functionally lost.

This must be **clearly communicated at signup**. The "passkey is your only key" property is a feature for fast onboarding and a footgun for users who don't understand it. Suggested copy already in Task 7 §8.

**Acceptable for new users** because they have no prior identity to lose; the worst case is they make a new one. **Not acceptable as a *replacement* for existing users' identities** — which is why Task 7 frames passkey as additive only.

**Conclusion:** the failure mode is real but bounded and clearly communicable. v1 should ship with backup phrase as a soft-gated post-signup prompt.

---

## 5. Passkey sync compromise (iCloud / Google account takeover)

If an attacker takes over a user's iCloud or Google account, they:
- Get the synced passkey on a device they control.
- Run the WebAuthn ceremony, get the same PRF outputs, derive the same nsec.
- Are now indistinguishable from the legitimate user.

**This is structurally equivalent to seed-phrase compromise** in self-custody Bitcoin terminology. The "seed" here is the passkey credential plus its CredRandom; the iCloud/Google sync is the seed's backup mechanism.

Mitigations:
- We can't independently detect this — to us, it looks like a normal login from a synced device.
- Apple's account-recovery flows (which gate iCloud Keychain access on additional factors, including device-bound recovery contacts) are the user's primary defense. Outside our control.
- We could add a "session start notification" — push or email — when a new device first authenticates, but we have no email or push channel today and this would be a real ask.

**Conclusion:** real risk, structurally identical to seed-phrase loss in any self-custody system. Document it in our security policy. No technical mitigation in v1 beyond what Apple/Google already provide.

---

## 6. Spec maturity risk

The Breez passkey-login spec is v0.9.1. One known production reference app (Glow). No formal changelog. No multi-implementer coordination process visible.

| Failure mode | Likelihood | Impact |
|---|---|---|
| Spec changes a derivation path | Medium over 12-month horizon | All existing zap.cooking passkey identities would still work (we're not changing our derivation), but cross-app interop with newer spec-compliant apps would break |
| Spec changes the MAGIC constant | Low | Same as above |
| Spec adds required new fields | Medium | Backward-compatible if they're optional; breaking otherwise |
| Spec is abandoned | Low-medium | We continue using our implementation; lose the cross-app interop *aspiration* but lose nothing functional |
| Spec gets a security flaw discovered | Low | We'd need to react; specifics depend on the flaw |

Mitigations:
- We control our own implementation. Even if Breez disappears, our identities work.
- We pin to spec v0.9.1's algorithms in code. Spec updates require a deliberate code change, not a transparent rollout.
- We document clearly that v0.9.1 is the version we follow.

**Conclusion:** medium-low risk. Manageable by owning our implementation. The biggest cost is that "interop with other apps following the spec" is more aspirational than guaranteed.

---

## 7. Specific to our implementation choices

### 7.1 Salt = `"zap.cooking"` (fixed string)

- **Plausible deniability**: lost. Anyone querying a user's salt-registry npub can confirm they're a zap.cooking user. As discussed in Task 2 §3, this is acceptable for a public Nostr app.
- **Discoverability**: easy. App always knows what salt to use.
- **Risk**: Breez spec might one day reserve specific salt strings for system use. Unlikely with `"zap.cooking"` (clearly app-specific) but possible.

### 7.2 Salt registry on our relays + public relays

- We publish to `relay.zap.cooking`, `relay.damus.io`, `relay.primal.net`, etc. Each is a potential leak surface, but the data leaked (the npub of the salt-registry account + the literal string `"zap.cooking"`) is already designed to be public.
- Relay denial — if all relays we publish to refuse our events, the user's salt registry can't be reconstructed, breaking the "restore on new device" flow. Mitigation: publish redundantly.

### 7.3 In-memory nsec held in Web Worker (recommended in §3)

- Worker isolation prevents `window`-scope JS from reading the nsec directly.
- Doesn't prevent a malicious extension or compromised page from sending crafted "sign this event" requests to the worker — the worker still has to expose a `signEvent` interface.
- Net: small but real hardening over main-thread storage.

### 7.4 Cloudflare Workers / KV for challenge state

- Challenge generation uses `crypto.getRandomValues()` — proper CSPRNG.
- KV is multi-tenant; Cloudflare itself could in principle read the challenges. Threat: a Cloudflare insider observes a challenge during its 5-minute lifetime. Practical impact: zero, because the challenge alone doesn't authenticate anything — you also need the authenticator's signature over it.
- If Cloudflare's KV layer ever leaks data publicly, attacker sees a stream of one-shot, time-bounded random values. Not exploitable.

### 7.5 Pantry Postgres credential storage

- `credential_id` is unique-indexed; no enumeration via collision.
- `public_key` and `counter` stored as bytea; standard PG security applies.
- Standard Postgres backup hygiene applies. No new risk relative to the existing membership table.

---

## 8. Comparison: passkey vs. existing auth methods

| Property | NIP-07 ext | NIP-46 bunker | nsec import | Passkey (this design) |
|---|---|---|---|---|
| Server holds key material | ❌ | ❌ | ❌ | ❌ |
| Phishing resistance | weak (depends on extension) | weak | weak | **strong** (RP-bound) |
| In-memory nsec exposure during session | mediated by extension | low (remote signing) | direct | direct (mitigatable via Worker) |
| Per-event prompt | usually no (extension UX) | yes (per signing) | no | no (in-memory after login) |
| Cross-device transferable | manual (export key) | manual (re-import bunker URI) | manual | automatic (passkey sync) |
| Recoverable if device lost | extension stores key in cloud or not, depends | bunker URI lost = identity lost | nsec lost = identity lost | passkey synced via iCloud/GPM = automatic; or BIP39 backup |
| New-user setup friction | high (install extension) | high (install nsec.app etc.) | high (handle nsec) | **low** (one biometric prompt) |
| Existing user can adopt for existing identity? | yes | yes | yes | **no** (creates new identity) |

**Conclusion:** passkey is the strongest method on phishing resistance and signup ergonomics. Comparable on session-time security. The unique downside is the "new identity only" constraint.

---

## 9. What gets worse with passkey

Honest accounting:

1. **Surface area grows.** Every new auth method is a new attack surface. WebAuthn protocol, SimpleWebAuthn library, our custom plugin, the OS-level credential APIs, the password-manager apps. Each is a layer that can be wrong.
2. **Spec maturity exposure.** Other auth methods on zap.cooking are based on stable specs (NIP-07, NIP-46) or vendor APIs that have been around for years. The Breez passkey spec is months old.
3. **Plugin maintenance.** We commit to maintaining (or paying attention to) at least one Capacitor plugin for the lifetime of the feature.
4. **Cross-platform consistency burden.** Web Safari, web Chrome, Capacitor iOS, Capacitor Android all need to produce the *same* nsec for the *same* user with the *same* passkey. Any platform divergence in PRF input encoding, BIP39 entropy handling, etc., produces silently divergent identities. Cross-platform integration tests are mandatory.

These are all acceptable but should be planned for.

---

## 10. What gets better with passkey

1. **Phishing-resistant auth** — the strongest property. Most sign-in attacks become impossible.
2. **No backup phrase required at signup** for the median user (synced passkey is the recovery mechanism). Friction reduction is significant.
3. **First-party identity** — no extension required, no separate signing app required, no QR scanning required. One biometric prompt covers it.
4. **Cross-device sync is automatic** for users on iCloud Keychain / Google PM. New device = scan biometric = signed in. The historical "I have to type a 64-character key on my new phone" moment is gone.

---

## 11. Recommended security posture for v1

| Decision | Choice | Rationale |
|---|---|---|
| Attestation | `"none"` | Simplicity, privacy, broad authenticator support |
| User Verification | `"required"` | Spec mandates UV-protected; no reason to weaken |
| Resident keys | `"preferred"` | Enables discoverable credential UX |
| Origin enforcement in plugin | required and tested | Prevents the Capacitor path from being weaker than the browser path |
| nsec storage | Web Worker scope | Small hardening over main-thread |
| Server sessions | none | Matches existing auth model |
| Re-auth before destructive credential ops | yes | Defends against session-token theft of credential management |
| Backup phrase prompt | post-signup, soft-gated | Avoids friction at signup; leaves recovery option open |
| Cross-platform integration tests | mandatory | The same-passkey-→-same-nsec property is the load-bearing one |
| Spec version pinning | v0.9.1, documented | Deliberate updates only |

---

## 12. Open questions

| # | Question | Resolution |
|---|---|---|
| Q1 | Should we expose a "log out all devices" button? | No server sessions to invalidate (per Task 6 §3); the closest analog is "revoke all credentials," already in the credential management UI. |
| Q2 | Should the auth manager refuse to publish events if the nsec was derived more than N minutes ago? | No for v1; matches existing flows where session length is open-ended. Revisit if real users get phished and we need to add session expiry. |
| Q3 | Should we add an audit log of credential registrations / authentications? | Light: log to Workers observability with redacted credential ID prefix. Heavy: no, until needed. |
| Q4 | Should we allow users to opt their salt registry events into NIP-29 private group relays only, for plausible deniability? | Out of scope for v1; salt registry is intentionally public per spec. Document as a v2 consideration. |
| Q5 | Should we publish a public security disclosure policy alongside this feature? | Yes — the existing zap.cooking security email + Nostr DM channel covers it; make sure passkey-specific reports are routed correctly. |

---

> 🛑 **STOP GATE 2 — Tasks 3–9 complete. Awaiting Seth's direction before writing the consolidated DECISION.md (Task 10).**
