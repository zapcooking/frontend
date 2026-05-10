# Task 1 — Breez Passkey Login Spec: Deep-Read Summary

**Status:** Complete (pending Seth's review of flagged discrepancy below)
**Sources:**
- Spec: `https://github.com/breez/passkey-login/blob/main/spec.md` (v0.9.1, no explicit date in document)
- SDK implementation notes: `https://github.com/breez/passkey-login/blob/main/SDK%20implementation.md`
- Local copies pulled to `/tmp/breez-passkey-spec.md` and `/tmp/breez-passkey-sdk.md` on 2026-05-10

---

## 1. One-paragraph summary

The Breez "Passkey-Derived Deterministic Key Generation via PRF and Nostr Salt Lookup" spec defines a stateless, passkey-anchored mechanism for deriving stable wallet and identity keys from a single WebAuthn passkey. A fixed magic challenge produces an `account_master` used solely to derive a Nostr key (`nostr_account`) at BIP44 account index 55, which signs a public registry of "salt" strings published as kind-1 events on Nostr. Each salt string fed back through PRF yields a `root_key` that is treated as BIP39 entropy, producing a per-salt mnemonic and a BIP32/BIP44 hierarchy of wallet and app keys (including a per-salt Nostr identity at account index 0). No server-side state, local encrypted blob, or mandatory seed phrase is required; mnemonic export is offered as an optional cross-ecosystem backup. The companion SDK implementation note adds a centralization layer the spec itself does not require: a single shared rpID `keys.breez.technology` using the WebAuthn Related Origins mechanism, plus a Breez-managed relay accessed via API-key-derived NIP-42 auth.

---

## 2. PRF call shape

| Aspect | Detail | Source |
|---|---|---|
| WebAuthn extension | `prf` (CTAP2 `hmac-secret` underneath) | implied by "PRF extension of WebAuthn" (§1) |
| User Verification | Required ("UV-protected") | §1, §5.1 diagram |
| Input encoding | Raw bytes; magic value given as hex `0x4e594f415354525453414f594e`; salt strings used directly (encoding not stated — implicitly UTF-8 bytes) | §2, §6, §7.2 |
| Magic input bytes | 13 bytes: `4E 59 4F 41 53 54 52 54 53 41 4F 59 4E` = ASCII `"NYOASTRTSAOYN"` | §2, §4 (parenthetical) |
| Output size | Not stated explicitly; WebAuthn PRF first/second eval each return **32 bytes** (HMAC-SHA-256). 32 bytes is treated as BIP39 entropy → 24-word mnemonic | inferred from WebAuthn PRF spec; consistent with BIP39 max entropy |
| Whether `eval.first` or `eval.second` | Not stated; spec abstracts as "PRF(passkey, X)". In practice partner apps will use `eval.first` per challenge | implementer's call; not constrained by spec |

**Open question for implementation (defer to Task 5):** does Breez's reference code use `eval.first` only, or does it pack two challenges into one ceremony via `eval.first` + `eval.second`?

---

## 3. The MAGIC constant and its role

- **Value:** the 13-byte string `"NYOASTRTSAOYN"`, given as hex `0x4e594f415354525453414f594e`. The prompt called this `MAGIC_BYTES`; the spec calls it "the magic string."
- **Why it exists:** to deterministically distinguish the PRF call that produces `account_master` from any PRF call that uses a user-chosen salt. The spec says this guarantees no salt string can collide with the master derivation.
- **Implication:** because `"NYOASTRTSAOYN"` is reserved, partner apps must never accept it as a user-chosen salt string.
- **Origin of the name:** unclear from the spec; appears to be a hand-picked nonsense token chosen for unlikelihood of collision with real salt strings.

---

## 4. BIP32 / BIP44 derivation paths

The spec uses NIP-06 path conventions (`m/44'/1237'/account'/change/index`).

| Path | Derived from | Purpose | Spec ref |
|---|---|---|---|
| `m/44'/1237'/55'/0/0` | BIP39/BIP32 over **`account_master`** entropy | `nostr_account` — signs the salt registry events | §2, §6.1, §8 step 2 |
| `m/44'/1237'/0'/0/0` | BIP39/BIP32 over **a per-salt `root_key`** mnemonic | "Regular Nostr Account (general usage)" — per-salt nostr identity per NIP-06 | §2, §11 |
| arbitrary BIP44 paths | BIP39/BIP32 over per-salt `root_key` mnemonic | wallet/app keys (e.g., Lightning, Bitcoin) | §4, §6.2, §8 step 6 |

**Key structural fact (this is the part most easily misread):** The spec runs BIP39 over the 32-byte PRF outputs. So both the account-master path and the per-salt paths flow `PRF output → BIP39 mnemonic → BIP32 derivation`. The two PRF outputs (master and per-salt) feed *different* mnemonics, and the account-55 vs. account-0 indices live in *different* BIP32 trees:

```
PRF(passkey, MAGIC)   → account_master → BIP39 mnemonic_A → BIP32 → m/44'/1237'/55'/0/0   (nostr_account; salt registry)
PRF(passkey, salt_S)  → root_key_S    → BIP39 mnemonic_S → BIP32 → m/44'/1237'/0'/0/0   (per-salt nostr identity for salt S)
                                                                  → wallet/app keys for salt S
```

There is **one nostr_account** (the salt registry signer) regardless of how many salts exist. There is **one identity per salt** for app use.

> ⚠️ **This is the discrepancy with the prompt's working architecture — see §8 below before proceeding to Task 2.**

---

## 5. Salt registry event format

| Field | Value |
|---|---|
| `kind` | `1` (standard short-text-note) |
| `pubkey` | hex of `nostr_account` pubkey (account 55 path) |
| `content` | the salt string itself (no prefix, no formatting, no encoding wrapper) |
| `tags` | not specified; spec implies empty |
| `created_at`, `id`, `sig` | standard Nostr |

**Plausible deniability is the explicit design intent** (§7): salt events are indistinguishable from ordinary kind-1 posts. There is no protocol-level marker that a kind-1 event from `nostr_account` is a salt registry entry rather than a casual post. The implication: if `nostr_account` is *also* used for regular social-graph posting, the salt registry mixes with ordinary content. In practice the salt-registry account should not be reused for general posting.

**Listing salts (read path):** query relays for `{kinds: [1], authors: [<nostr_account hex>]}`; the `content` field of each returned event is a candidate salt. Sort alphabetically or by `created_at`.

---

## 6. Restore flow (annotated)

1. User indicates "restore."
2. Client triggers WebAuthn `get()` ceremony with `prf.eval.first = MAGIC_BYTES`. UV is required → biometric/PIN prompt fires.
3. Authenticator returns 32-byte `account_master`.
4. Client runs BIP39 over `account_master` → mnemonic_A → BIP32 → `m/44'/1237'/55'/0/0` → derives `nostr_account` keypair.
5. Client queries Nostr relays for `{kinds:[1], authors:[<nostr_account_pubkey>]}`. Receives N events whose `content` fields are candidate salts.
6. UI presents the salt list to user; user selects one (or more).
7. For each selected salt: another WebAuthn `get()` ceremony with `prf.eval.first = utf8(salt_string)` → 32-byte `root_key_S`.
8. BIP39(root_key_S) → mnemonic_S → BIP32 → derive `m/44'/1237'/0'/0/0` (nostr identity) and any wallet paths.
9. Mnemonic_S optionally shown for backup.

**Critical UX consequence:** every salt selection costs one biometric prompt. Restoring "the wallet and the zap.cooking identity" with two distinct salts = three biometric prompts (master + 2 salts). With one shared salt for both = two prompts (master + 1 salt). With cleverly batched `eval.first` + `eval.second` in a single WebAuthn call = potentially one fewer prompt (implementation detail; not addressed by spec).

---

## 7. Non-obvious requirements / constraints

| Item | Detail | Source |
|---|---|---|
| **UV is mandatory** | Authenticator must enforce user verification. Affects authenticator selection at registration (`userVerification: "required"`). | §1, §5.1 |
| **PRF extension is mandatory** | Authenticators without PRF/`hmac-secret` cannot participate. This excludes some hardware keys and several password managers (see Task 3). | §1 |
| **rpID centralization is *not* in the spec** | The spec is rpID-agnostic. The centralized `keys.breez.technology` rpID + Related Origins setup is introduced only in the SDK implementation note. Owning your own rpID is fully consistent with the spec. | spec §3 vs. SDK doc §1 |
| **Salt encoding** | Spec does not state the byte encoding of salt strings. Implementations must converge (presumably UTF-8). A mismatch produces silently divergent keys. | gap — needs Task 5 verification against reference code |
| **`account_master` is reused as BIP39 entropy** | The 32-byte PRF output is treated directly as BIP39 entropy (256 bits → 24 words). No KDF, no compression. | §6.1 |
| **No anti-rollback / no counter / no challenge nonce in PRF inputs** | The MAGIC and salt strings are constants. PRF input never includes a server challenge or session value. This is what makes the scheme stateless — but it also means PRF output is fully replayable if the authenticator is compromised. | §11 |
| **Salt strings are public** | Anyone with `nostr_account`'s pubkey can list every salt. Salts are designed to be human-meaningful, but they reveal a user's app graph (e.g., "zap.cooking", "btcpay-server") to anyone who knows their salt-registry npub. | §7 |
| **No spec-defined attestation policy** | Spec does not require attestation. SDK doc does not address it. Up to the relying party. | gap — Task 6 |
| **Lost passkey = lost keys** | Unless mnemonic was exported. Sync recovery (iCloud / Google Password Manager) is the implicit primary recovery path. | §11, §12 |
| **CXP/CXF cross-platform export immaturity** | Spec's "switch providers easily" claim depends on Credential Exchange Protocol/Format being supported by sync providers. Per SDK doc: iOS supports CXP (export); Android pending; Bitwarden lacks PRF; 1Password lacks CXP; KeePass lacks both. | §11, SDK doc §"Passkey Migration Considerations" |

---

## 8. ⚠️ Discrepancy with the prompt's "working architecture"

The Phase B prompt states:

> BIP32 derivations from `account_master`:
> - `m/44'/1237'/0'/0/0` → user's Nostr identity (standard NIP-06 path — **this is what zap.cooking signs in with**)
> - `m/44'/1237'/55'/0/0` → `nostr_account` (Breez salt registry; used by the wallet)

The spec says something different. Per §4 / §6 / §11, only the account-55 path is derived from `account_master`. The account-0 path lives **inside a per-salt mnemonic**, not under the master tree. There is no "general identity at account 0 of master" in the spec.

In other words:

- **Prompt model:** one PRF call (MAGIC) → master → both nostr_account (acct 55) and zap.cooking identity (acct 0). One ceremony covers everything.
- **Spec model:** PRF(MAGIC) → master → nostr_account only (acct 55, salt registry signer). PRF(zap.cooking's salt) → root_key → mnemonic → zap.cooking identity at acct 0 of *that* mnemonic. Two PRF ceremonies are needed (or one ceremony with `eval.first` + `eval.second` if Breez's reference SDK does that batching).

### Why this matters for Phase B scope

The prompt's central decision (RP scoping) and several downstream tasks assumed "one passkey ceremony covers wallet + zap.cooking identity." Under the spec, the cost of "passkey login to zap.cooking" is at minimum:

1. PRF(MAGIC) — to derive the registry signer.
2. Nostr query for the salt registry — to discover whether zap.cooking's salt is published.
3. PRF(salt) — to derive zap.cooking's identity.

If zap.cooking and the Breez wallet share a salt, one `root_key` can produce both wallet keys and the zap.cooking nostr identity (different paths under the same per-salt mnemonic). If they use different salts, they're cryptographically independent identities under the same passkey.

The "share Breez's RP → one ceremony covers both" framing in the prompt is therefore not literally accurate as written. RP sharing still gets you one *passkey* covering both, but each derivation still needs its own PRF call (or batched eval).

### What I need from Seth before Task 2

Three options for how to interpret the prompt vs. the spec:

1. **Trust the spec, revise the architecture.** Treat the prompt's "account 0 from master" as a misreading; carry forward the spec's per-salt model. Task 2 (RP scoping) then becomes: *should zap.cooking share Breez's salt + RP, share Breez's RP but use its own salt, or own its own RP entirely?*
2. **Keep the prompt's model and note the deviation.** Implement a non-standard derivation where zap.cooking takes account 0 directly off `account_master` for fewer PRF calls. This is interoperable with nothing — Breez's SDK won't recognize it — but it's faster.
3. **Validate against Breez's reference code first.** Before deciding, verify whether Breez's SDK actually exposes account-0-of-master as an identity hook (which would mean the spec text is incomplete, not the prompt). This blocks Task 2 until Task 4 (SDK surface) is partially complete.

I recommend **option 1** — it's what the spec actually says, what Breez's SDK will be built around, and what makes per-salt independence (a real security feature) work. Option 2 trades interoperability for one biometric prompt. Option 3 is fine but slower.

---

## 9. Other notes worth recording

- **Spec maturity:** version 0.9.1, single repository, no spec-level changelog or signed releases. Treat as a moving target. The prompt described it as "March 2026" but the document itself carries no date.
- **Salt-registry replication:** SDK doc lists six default relays (`relay.nostr.watch`, `relaypag.es`, `monitorlizard.nostr1.com`, `relay.damus.io`, `relay.nostr.band`, `relay.primal.net`) plus a Breez-managed relay (auth via NIP-42 with key derived from a partner API key). None of these overlap with zap.cooking's current relay set. NIP-65 is used to advertise the user's chosen list.
- **Kind-1 collision risk:** if a user posts on Nostr generally with their `nostr_account` (e.g., they reuse the npub elsewhere), every casual post becomes ambient noise in their salt registry. Salt list reads must tolerate non-salt content. Implementations should treat the salt-registry account as machine-only and never expose it for posting.
- **PRF input length:** WebAuthn allows arbitrary `BufferSource`. Salt strings of any reasonable length are fine. There is no length limit defined in the spec.
- **Wallet/app keys hierarchy under per-salt mnemonic:** spec does not enumerate which BIP44 coin types or paths apps should claim within the per-salt tree. Convention will likely be: BIP-44 coin 1237 (Nostr) at account 0 for identity, BIP-44 coin 0 (Bitcoin) for on-chain, etc. Coordinated by convention rather than spec.

---

## 10. What this changes downstream

If the discrepancy in §8 is resolved per recommendation (option 1):

- **Task 2 (RP scoping):** the question is no longer "one ceremony covers everything?" but "do we share Breez's salt registry namespace, share their RP only, or run our own RP?" Sharing the RP still gives one-passkey-covers-both; sharing the salt is what gives one-PRF-covers-both for the wallet+identity case.
- **Task 4 (SDK surface):** must verify that Breez's SDK exposes either (a) the per-salt mnemonic so the host app can derive its own account-0 identity, or (b) a direct `getNostrIdentity(salt)` API. If neither, the host app implements the per-salt derivation itself but still uses the SDK's PRF wrapper.
- **Task 7 (coexistence):** the in-memory session model holds, but "derive nsec at login" specifically means "ceremony 1 (master) + ceremony 2 (zap-cooking salt) → mnemonic → account 0 → nsec," not a single derivation.
- **Task 9 (security):** per-salt independence is a real isolation property worth recording — compromising the wallet's salt-derived keys does not compromise the zap.cooking identity, even though they share a passkey.

---

## 11. Open questions to carry into later tasks

| # | Question | Where it lands |
|---|---|---|
| Q1 | Does Breez's reference SDK use one WebAuthn ceremony with `eval.first` + `eval.second` to fetch master + salt in one biometric prompt? | Task 4 |
| Q2 | What encoding does Breez's reference SDK use for salt strings (UTF-8 assumed)? | Task 4 / Task 5 |
| Q3 | What does Breez's SDK actually expose to host apps — raw PRF outputs, per-salt mnemonics, or only opaque wallet handles? | Task 4 |
| Q4 | If zap.cooking owns its own RP, can it still publish to the same salt registry that Breez reads from? (Yes, conceptually — the salt registry is just Nostr — but the *passkey* used to derive `account_master` would be different per RP, so the registries would be independent.) | Task 2 |
| Q5 | Does the spec's "PRF input never includes a server challenge" property create any replay-attack risk against the registration ceremony, or is the WebAuthn ceremony's own challenge sufficient? | Task 9 |
| Q6 | Is `keys.breez.technology` actually serving the three well-known files today? | ✅ Verified 2026-05-10 — see §12 |

---

## 12. Verification: live state of `keys.breez.technology` (snapshot 2026-05-10)

All three well-known files are served (HTTP 200):

- `/.well-known/webauthn` — Related Origins JSON listing 6 web origins, including `glow.breez.technology`, `glow-app.co`, `mi-pueblo-v2.pages.dev`, `bitlasso.xyz`, `savage-glow-web.vercel.app`, and `keys.breez.technology` itself.
- `/.well-known/apple-app-site-association` — `webcredentials.apps` lists 6 iOS bundle IDs across two team IDs (`F7R2LZH3W5` Breez, `7KA6NPATXZ` Dompet).
- `/.well-known/assetlinks.json` — 6 web targets and 6 Android packages including Glow (prod + dev), Breez SDK CLI, Havenwallet, and a placeholder `com.example.passkeyprf`.

**Implications for Task 2:**
- The mechanism is live and Breez is actively onboarding partner apps (not just running a single demo). Adding `zap.cooking` and the Capacitor app IDs would extend an existing list rather than bootstrap one.
- Onboarding requires **Breez to publish updated well-known files**. zap.cooking cannot self-serve its inclusion.
- The presence of `com.example.passkeyprf` (a sample) in production assetlinks suggests change-management on these files is informal. That is a small but real operational risk for Option A.
