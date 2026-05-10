# Task 4 — Breez SDK Integration Surface

**Status:** Complete. Conclusion: under Option B (own RP) the Breez SDK is **not on the auth path** for zap.cooking — we implement the spec's derivation algorithms directly. The SDK becomes relevant only if/when zap.cooking adds a wallet integration, which is a separate Phase-D decision.

---

## 1. What Breez exposes for partner apps

Per [Breez SDK Spark Passkey guide](https://sdk-doc-spark.breez.technology/guide/passkey.html):

### Three API surfaces

| Method | Purpose | Returns |
|---|---|---|
| `Passkey.get_wallet(label)` | Derive a wallet keyset from the passkey + a label string (the "salt" in spec terms; defaults to `"Default"`) | A wallet object with **`seed` (BIP39 mnemonic)** plus opaque wallet handles |
| `Passkey.list_labels()` | Query Nostr (via SDK's relay list, signed by the salt-registry account derived from the passkey) for the user's published salts | List of label strings |
| `Passkey.store_label(label)` | Publish a label to Nostr as a kind-1 event signed by the salt-registry account | confirmation |

### Configuration flag

`enablePasskey: true` in the SDK init — for React Native this auto-adds the `webcredentials:keys.breez.technology` Associated Domains entitlement on iOS. Web/Android still need separate well-known coordination with `keys.breez.technology`.

### Platform PRF provider abstraction

The SDK delegates the actual WebAuthn ceremony to a `PasskeyPrfProvider` interface that the host implements per platform:

- `derive_prf_seed(salt) -> 32 bytes`
- `is_prf_available() -> bool`

This is the seam between "SDK orchestrates BIP39/BIP32/Nostr lookup" and "OS provides PRF output via WebAuthn." The SDK ships PRF providers for its own supported environments (RN with native bridges to ASAuthorizationController / Credential Manager, and WASM with browser `navigator.credentials`).

### What it does NOT expose

- **Raw PRF output** is not returned to the host — it stays inside the SDK's derivation pipeline. (The host's `PasskeyPrfProvider.derive_prf_seed` *produces* it, but if the host implements that itself it could capture it. Native SDK-provided providers don't pipe it back out.)
- **`account_master`** is not exposed.
- **`nostr_account` keypair** (the salt registry signer) is not exposed — it's used internally.
- **Per-salt root_key** is not exposed.
- **Per-salt mnemonic IS exposed** — that's the `wallet.seed` field on the result of `get_wallet(label)`.

So if a partner app holds the per-salt mnemonic (the `seed`), it can derive anything else under that mnemonic, including the NIP-06 nostr identity at `m/44'/1237'/0'/0/0`. That's the partner's escape hatch.

---

## 2. SDK distribution channels

| Package | Targets | Relevant to zap.cooking? |
|---|---|---|
| `@breeztech/breez-sdk-spark` | Browser/Node WASM | Could fit SvelteKit web — but not under Option B |
| `@breeztech/breez-sdk-spark/web` | Browser-only WASM with `await init()` | Web entrypoint |
| `@breeztech/breez-sdk-spark-react-native` | React Native, native bridges | Not used (we're Capacitor + SvelteKit, not RN) |
| `breez-sdk-spark-flutter` | Flutter | Not relevant |
| `breez-sdk-spark-go` | Go | Not relevant |

For a hypothetical Capacitor app using the SDK, you'd use the WASM web build inside the WebView and supply your own `PasskeyPrfProvider` that calls a native plugin (back to Task 3's plugin question).

---

## 3. Why Option B makes the SDK optional

Under Option B (own RP `zap.cooking`):

- Our WebAuthn credentials are scoped to `zap.cooking`, not `keys.breez.technology`. PRF outputs from our credentials are completely independent from PRF outputs the Breez SDK would derive (different rpID → different CredRandom → different PRF).
- Therefore: even if we used the Breez SDK locally, the "wallet" it derived from our PRF would not be the same as a Breez/Glow wallet derived from a `keys.breez.technology` PRF. They'd be two separate wallets backed by the same passkey *credential family* but bound to different RPs.
- For our auth needs we need: PRF output → BIP39 → BIP32 → secp256k1 → Nostr nsec. Every step is well-served by lightweight libraries (`@scure/bip39`, `@scure/bip32`, `@noble/secp256k1`, `nostr-tools`). Pulling in the SDK as a transitive dependency just to walk three derivation steps is overkill, adds WASM weight, and ties our auth uptime to the SDK's release cadence.
- The Nostr salt registry write/read is also small (publish a kind-1, query kind-1 by author). We have working Nostr code throughout the codebase.

**Decision:** implement the spec's derivation logic directly in our own code under Option B. Do not depend on the Breez SDK for auth.

---

## 4. Why following the spec keeps us interoperable

We won't be cryptographically interoperable with Breez (different RP = different keys, fundamentally), but we **should follow the spec's derivation paths and salt-registry format anyway**, because:

1. If a user later wants to import a zap.cooking-derived identity into a third-party app that follows the same spec, they can.
2. If the user exports the per-salt mnemonic (via the spec's optional BIP39 export), it'll be a standard 24-word phrase that any spec-compliant app recognizes.
3. The salt registry on Nostr is queryable by anyone using the spec — discoverability is automatic.

So: follow the spec religiously, just bind it to our own RP. Specifically:

- PRF magic = `0x4e594f415354525453414f594e` ("NYOASTRTSAOYN") — same as Breez. Don't change.
- Salt registry account = `m/44'/1237'/55'/0/0` from BIP39(account_master) — same.
- Per-salt mnemonic = BIP39(PRF(passkey, salt)) — same.
- zap.cooking identity = `m/44'/1237'/0'/0/0` from BIP39(PRF(passkey, "zap.cooking")) — same.
- Salt event = kind-1, content = salt string — same.

The only thing we differ on is the rpID. Everything downstream of the PRF call is identical to Breez's spec.

---

## 5. When the Breez SDK *does* become relevant

If/when zap.cooking adds a Breez Lightning wallet integration (separate from the auth question), the SDK is the right tool for the wallet itself — payment routing, Lightning state, on-chain ops, etc. The wallet would have its own passkey under `keys.breez.technology` (or its own provided `PasskeyPrfProvider`), independent from our auth credential.

That's a Phase-D-or-later question. Not in scope here. Noting it for completeness so we don't conflate the two surfaces.

---

## 6. Open questions that closed

| # | Question | Answer |
|---|---|---|
| Q1 | Does Breez's SDK use one WebAuthn ceremony with `eval.first` + `eval.second` for master + salt? | The PrfProvider abstraction takes one salt per call. The SDK appears to call PRF twice (master + label) when `get_wallet(label)` is invoked. Whether the JS bridge can batch them is up to the host's PrfProvider implementation. Under Option B, we control this and can batch in our own plugin. |
| Q2 | Salt encoding? | Spec is silent; SDK uses the label string directly as PRF input — UTF-8 bytes. Convention. |
| Q3 | Does SDK expose what we need? | Per §1: yes (per-salt mnemonic via `wallet.seed`), but Option B makes this moot. |
| Q4 | Can a non-Breez RP publish to the same registry Breez reads? | Yes if zap.cooking decided to publish to Breez's salt registry under Breez's `nostr_account` — but we **can't** because we don't have access to Breez's passkey-derived `nostr_account`. We have our own. Salt registries are isolated per-RP by construction. |

---

## 7. Implications carried forward

- **Task 5 (implementation path)** — confirms we need:
  - Web: SimpleWebAuthn server (Workers) + client wrapper around `navigator.credentials` with PRF extension.
  - Capacitor: native plugin (fork or new) per Task 3.
  - Crypto pipeline: `@scure/bip39`, `@scure/bip32`, `@noble/secp256k1`, `nostr-tools`. No Breez SDK dependency.
- **Task 6 (backend)** — unchanged.
- **Task 9 (security)** — note that we're not relying on Breez's SDK and so don't inherit its release risk for auth. We do inherit the **spec's** maturity risk (one production reference app, version 0.9.1).
