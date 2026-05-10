# Task 5 — Web + Capacitor Implementation Path

**Status:** Complete. Carries Option B and Task 3's "native plugin required" finding.

**Premise:** zap.cooking owns `zap.cooking` as RP. Web (SvelteKit on Cloudflare Pages with `nodejs_compat`) handles auth ceremonies natively in modern browsers. Capacitor needs a native plugin to bridge `navigator.credentials` calls (specifically PRF) to OS credential APIs. Crypto pipeline runs entirely client-side.

---

## 1. Web (SvelteKit + Cloudflare Workers)

### 1.1 Server libraries — recommendation: SimpleWebAuthn

**`@simplewebauthn/server` v13+** is the de-facto Node/Web standard for the WebAuthn server side. Per [JSR @simplewebauthn/server docs](https://jsr.io/@simplewebauthn/server) it supports Cloudflare Workers via the `nodejs_compat` flag (officially "periodically tested but unofficially supported," meaning the maintainer doesn't run CI against Workers but the library works there).

Our setup is already a fit:
- `wrangler.jsonc` has `compatibility_flags: ["assets_navigation_prefers_asset_serving", "nodejs_compat"]` and `compatibility_date: 2025-01-01`. Per [Cloudflare's nodejs_compat docs](https://developers.cloudflare.com/workers/runtime-apis/nodejs/), this enables the polyfills SimpleWebAuthn relies on (`Buffer`, `crypto`, etc.).
- Node 22.x is declared as the runtime in `package.json` → matches SimpleWebAuthn's Node 20+ floor.

API surface we need (all from `@simplewebauthn/server`):
- `generateRegistrationOptions({ rpName, rpID, userName, userID, attestationType, authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' }, extensions: { prf: { eval: { first: ... }} } })`
- `verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin, expectedRPID, requireUserVerification: true })`
- `generateAuthenticationOptions({ rpID, userVerification: 'required', extensions: { prf: { eval: { first: ... }} } })`
- `verifyAuthenticationResponse({ response, expectedChallenge, expectedOrigin, expectedRPID, credential, requireUserVerification: true })`

**Alternatives considered and rejected:**
- `@hexagon/webauthn-server` (smaller, Deno-first) — less battle-tested, no official Workers test suite mention.
- Roll-your-own COSE/CBOR/attestation parsing — wildly more risk than benefit.
- WebAuthn-as-a-Service (Corbado, Hanko, Auth0) — adds a vendor dependency and a per-MAU cost for code we can run for free in Workers. Not worth the trade for an additive auth method on a Nostr app where we're already handling key material directly.

### 1.2 Browser library — `@simplewebauthn/browser`

Thin wrapper over `navigator.credentials.create()` / `.get()` that handles the JSON ↔ ArrayBuffer base64url plumbing. Using it instead of raw WebAuthn JS keeps our client code aligned with the server library and gets us PRF extension support for free.

### 1.3 PRF extension request shape (web)

Registration:
```js
const opts = await fetch('/api/auth/passkey/register/options', { method: 'POST' }).then(r => r.json());
opts.extensions = {
  prf: { eval: { first: utf8('zap.cooking') } },
  // OR if we batch:
  // prf: { eval: { first: MAGIC_BYTES, second: utf8('zap.cooking') } }
};
const reg = await startRegistration({ optionsJSON: opts });
```

Assertion (login):
```js
const opts = await fetch('/api/auth/passkey/login/options', { method: 'POST' }).then(r => r.json());
opts.extensions = { prf: { eval: { first: MAGIC_BYTES, second: utf8('zap.cooking') } } };
const assertion = await startAuthentication({ optionsJSON: opts });
const prfResults = assertion.clientExtensionResults?.prf?.results;
// prfResults.first = account_master, prfResults.second = root_key_for_zap_cooking_salt
```

The `eval.first` + `eval.second` batching is the PRF spec's primary cost optimization. Both calls share one ceremony / one biometric prompt. Good browsers support this; our reference implementations should emit both.

> ⚠️ **Open question carried from Task 3 (Q1):** does this batching survive through the Capacitor native plugin's bridge? On the web it Just Works.

### 1.4 New API routes to add

Mirror the existing `src/routes/api/*` pattern:

```
src/routes/api/auth/passkey/
  register/
    options/+server.ts   # POST → returns RegistrationOptionsJSON, stores challenge in KV
    verify/+server.ts    # POST → verifies attestation, persists credential, returns session
  login/
    options/+server.ts   # POST → returns AuthenticationOptionsJSON, stores challenge in KV
    verify/+server.ts    # POST → verifies assertion, returns session
  credentials/
    +server.ts           # GET (list user's credentials), DELETE (revoke)
```

Challenge state: existing `SHORTLINKS` / `GATED_CONTENT` KV bindings show the pattern. Add a `WEBAUTHN_CHALLENGES` KV namespace with TTL = 5 minutes per challenge.

---

## 2. Capacitor (iOS + Android)

### 2.1 Constraint summary (from Task 3)

- iOS WKWebView: `navigator.credentials` for `publicKey` triggers `NotAllowedError` because Capacitor doesn't have the `com.apple.developer.web-browser` entitlement (and won't get it).
- Android WebView: WebAuthn can be enabled via AndroidX WebKit 1.12.0+ but PRF passthrough is undocumented; safer to bypass the WebView for the ceremony.
- **Therefore:** native plugin bridges the WebAuthn ceremony to OS APIs and pipes the PRF result back into the WebView JS context.

### 2.2 Plugin choice — recommendation: spike Cap-go/capacitor-passkey first, fork or build if it falls short

[`Cap-go/capacitor-passkey`](https://github.com/Cap-go/capacitor-passkey) is the closest-fit existing plugin:
- Patches `navigator.credentials.create/get` so existing JS code Just Works after a one-line plugin import.
- Forwards extensions as JSON.
- Returns native credential objects shaped to match the WebAuthn API.
- Uses iOS `ASAuthorizationController` and Android Credential Manager under the hood.

**Plan:** in Phase C, spend ~1 day spiking the Cap-go plugin against a `zap.cooking`-scoped passkey with PRF. Test scenarios:
1. Register a passkey on iOS device (real iOS 18.4+); confirm `clientExtensionResults.prf.enabled === true`.
2. Authenticate; confirm `clientExtensionResults.prf.results.first` returns 32 bytes that match what the equivalent web ceremony produces.
3. Same on Android.

If the spike succeeds, we use Cap-go directly (with a small PR upstream if PRF needs explicit wiring). If the spike fails — most likely Android is the failure case — we fork and add explicit PRF support, contributing back upstream.

Fallback option: write our own thin Capacitor plugin specifically for our PRF use case. Either path is sub-week of work.

### 2.3 Native iOS code path

Inside the plugin, on iOS 18+:

```swift
let prfReg = ASAuthorizationPublicKeyCredentialPRFRegistrationInput(
  inputValues: ASAuthorizationPublicKeyCredentialPRFAssertionInput.InputValues(
    saltInput1: utf8("zap.cooking"),
    saltInput2: nil
  )
)
let request = provider.createCredentialRegistrationRequest(...)
request.extensions.prf = prfReg
```

For assertion (login) we'd use the analogous `ASAuthorizationPublicKeyCredentialPRFAssertionInput` with `saltInput1 = MAGIC_BYTES` and `saltInput2 = utf8("zap.cooking")`.

Pre-iOS-18 → graceful fallback. We surface `prf.enabled = false` to the JS layer; UI shows "Update to iOS 18.4+ to use passkey login here, or sign in with NIP-07 / nsec import."

### 2.4 Native Android code path

Inside the plugin, on Android (Credential Manager):

```kotlin
val credentialManager = CredentialManager.create(context)
val request = GetCredentialRequest.Builder()
  .addCredentialOption(GetPublicKeyCredentialOption(
    requestJson = """{"rpId": "zap.cooking", "challenge": "...", "extensions": {"prf": {"eval": {"first": "...", "second": "..."}}}}"""
  ))
  .build()
val result = credentialManager.getCredential(activity, request)
```

The PRF extension is supplied via the request JSON (Credential Manager's `requestJson` field is forwarded as-is to the credential provider). Whether the provider returns PRF output in the response depends on the provider — Google Password Manager does; some Android 14 providers may not. We surface availability to JS via the same `prf.enabled` flag.

### 2.5 JS-to-native interface

The plugin exposes:
```ts
import { Passkey } from '@cap-go/capacitor-passkey';

const reg = await Passkey.register({
  rpId: 'zap.cooking',
  challenge: '...',
  user: { id: '...', name: '...', displayName: '...' },
  pubKeyCredParams: [...],
  authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
  extensions: { prf: { eval: { first: 'base64url-bytes' } } }
});
// reg.clientExtensionResults.prf.results.first → base64url-encoded 32 bytes
```

Same shape as `@simplewebauthn/browser` for ergonomic parity. Ideally the plugin patches `navigator.credentials` so the same SimpleWebAuthn-based code works in both web and Capacitor builds without branching.

### 2.6 Capacitor build flag check

Existing build:
- `pnpm build` → web → Cloudflare Pages
- `pnpm build:android` (with `CAPACITOR=true`) → Android Capacitor build
- `build:mobile` → static build for iOS Capacitor

We'd add a runtime check `Capacitor.isNativePlatform()` to decide between `@simplewebauthn/browser` and the native plugin's API. Or rely on the plugin's `navigator.credentials` patch and use SimpleWebAuthn's API in both cases.

---

## 3. Crypto pipeline (PRF output → BIP32 → secp256k1 → nsec)

### 3.1 Library choices

zap.cooking already ships:
- `bip39: ^3.1.0` — Iancoleman's bip39 (CommonJS-ish; works in browser)
- `@noble/hashes: ^2.0.1`
- `@noble/ciphers: ^2.1.1`
- `nostr-tools: ^2.13.0` — uses `@noble/secp256k1` internally
- `bech32: ^2.0.0`

Add for the passkey pipeline:
- `@scure/bip32` (peer of `@scure/bip39`; pure JS, audited, ESM-clean) — **recommended** as the BIP32 library. The existing `bip39` package is fine for mnemonic generation but doesn't provide BIP32 derivation.
- Optionally swap `bip39` → `@scure/bip39` for consistency with `@scure/bip32`. Same author, same idiom, smaller bundle. Not a blocker if `bip39` stays.

### 3.2 Derivation pipeline (per spec, per Task 1)

```ts
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { HDKey } from '@scure/bip32';
import { getPublicKey, nip19 } from 'nostr-tools';

export async function deriveZapCookingNsecFromPrf(
  prfMaster: Uint8Array,    // 32 bytes from PRF(MAGIC_BYTES)
  prfSalt: Uint8Array        // 32 bytes from PRF(utf8("zap.cooking"))
): Promise<{ nsec: string; npub: string; saltRegistryPubkey: string }> {

  // Salt registry account (account 55) — derived from account_master
  const masterMnemonic = bip39.entropyToMnemonic(prfMaster, wordlist);
  const masterSeed = await bip39.mnemonicToSeed(masterMnemonic);
  const masterNode = HDKey.fromMasterSeed(masterSeed);
  const saltRegistryNode = masterNode.derive("m/44'/1237'/55'/0/0");
  const saltRegistryPrivkey = saltRegistryNode.privateKey!;
  const saltRegistryPubkey = bytesToHex(getPublicKey(saltRegistryPrivkey));

  // zap.cooking identity (account 0 of per-salt mnemonic)
  const saltMnemonic = bip39.entropyToMnemonic(prfSalt, wordlist);
  const saltSeed = await bip39.mnemonicToSeed(saltMnemonic);
  const saltNode = HDKey.fromMasterSeed(saltSeed);
  const identityNode = saltNode.derive("m/44'/1237'/0'/0/0");
  const identityPrivkey = identityNode.privateKey!;
  const npub = nip19.npubEncode(bytesToHex(getPublicKey(identityPrivkey)));
  const nsec = nip19.nsecEncode(identityPrivkey);

  return { nsec, npub, saltRegistryPubkey };
}
```

(Sketch — actual code goes in Phase C, not here.)

### 3.3 Workers compatibility

All listed libraries are pure JS / WASM-free / Workers-clean. `@scure/bip32` and `@scure/bip39` are explicitly designed for non-Node environments. `@noble/*` already works in Workers (we use it). nostr-tools works in Workers (we use it).

The derivation runs **only in the browser/Capacitor context** — never on the server. The server never sees the nsec or even the PRF output. It only sees the WebAuthn credential public key + counter for verification.

### 3.4 Salt registry write/publish

Once we have `saltRegistryPrivkey`, publish a kind-1 to whichever relays we want the salt indexed on:
- Our own relays: `relay.zap.cooking`, `pantry.zap.cooking` (private NIP-29), `garden.zap.cooking` (Pyramid invite-only — probably skip for salt registry, it's invite-only).
- A few large public relays for redundancy: `relay.damus.io`, `relay.primal.net`, `relay.nostr.band`.
- Optionally Breez's recommended set if we want the salt registry visible to spec-compatible apps.

Use existing `nostr-tools` `finalizeEvent` + `Relay`/`SimplePool` patterns already in our codebase.

### 3.5 Salt registry query (restore)

Given just the passkey at restore time:
1. Fire ceremony → PRF(MAGIC_BYTES) → derive `saltRegistryPubkey`.
2. Query relays: `{ kinds: [1], authors: [saltRegistryPubkey] }`.
3. Filter results: any `content === "zap.cooking"`? If yes, this user has signed up. Continue.
4. Fire second ceremony (or batched first) → PRF(utf8("zap.cooking")) → derive identity nsec.

Step 2 reuses our existing relay query infrastructure.

---

## 4. End-to-end flow shape (web, summary)

### Signup (new user)

1. UI: "Sign up with passkey." User clicks.
2. Client: `POST /api/auth/passkey/register/options` → server returns options + challenge ID.
3. Client: `startRegistration(options)` → browser prompts biometric → returns attestation + `clientExtensionResults.prf.enabled`.
4. Client: `POST /api/auth/passkey/register/verify` with attestation → server verifies, persists credential, returns 200 + session cookie.
5. Client: triggers a *separate assertion* to obtain the PRF outputs (the registration response carries `prf.enabled` but most platforms don't return PRF *outputs* during registration — they're only returned during assertion). This is the "pending bug area" of the spec; iOS 18.4+ and Chrome 132+ do support `prf.results` on creation, but to be portable we issue a `get()` immediately after `create()`.
6. Client: derive `account_master`, `nostr_account`, identity nsec from PRF outputs.
7. Client: publish `"zap.cooking"` salt event to relays signed by `nostr_account` privkey.
8. Client: hold derived nsec in memory for session lifetime.

### Return login (existing user)

1. UI: "Sign in with passkey."
2. Client: `POST /api/auth/passkey/login/options` → server returns auth options + challenge.
3. Client: `startAuthentication(options)` with `prf.eval.first = MAGIC_BYTES, prf.eval.second = utf8("zap.cooking")`.
4. Client: `POST /api/auth/passkey/login/verify` with assertion → server verifies, returns 200 + session cookie.
5. Client: derive identity nsec from PRF outputs (no relay query needed if we don't need the salt registry on every login — we already know which salt to use).
6. Client: hold nsec in memory.

### Restore (new device, same passkey synced via iCloud / Google PM)

1. UI: "Restore identity from passkey."
2. Same as login flow above. The synced passkey on the new device produces the same PRF outputs → same derived identity. Salt registry not strictly needed, but query it once to validate the user actually has a published salt registry (defensive).

---

## 5. Cloudflare-specific gotchas

| Concern | Mitigation |
|---|---|
| KV eventual consistency for challenges | Challenges are short-lived (~5 min) and used once. KV's ~60s eventual consistency is acceptable for "did this nonce ever exist?" because KV writes are read-your-write within the same colo; mismatches happen only across colos with very fast successive registrations, which is not our pattern. If it becomes an issue, switch to D1 for challenges. |
| Workers' 128 MB memory limit / 30s CPU limit | A WebAuthn verify does a few ECDSA verifies + CBOR parse — well under 100ms. Not a concern. |
| `nodejs_compat` polyfill weight | We already pay for it (Stripe SDK uses it). No additional cost. |
| SimpleWebAuthn requires `Buffer` | Polyfilled by `nodejs_compat`. Or `import { Buffer } from 'node:buffer'`. |
| Cron triggers | Not needed for passkey auth path. Existing cron config unaffected. |
| OG image rendering routes | Unaffected. |

---

## 6. Open questions / Phase C spikes

| # | Question | Effort |
|---|---|---|
| Q1 | Does `eval.first` + `eval.second` batching round-trip through `Cap-go/capacitor-passkey`? | 1 day, real device |
| Q2 | Does iOS 18.4 surface PRF outputs during `create()` via the native API, or do we always need a follow-up `get()`? | Half day, real iOS device |
| Q3 | Does Google Password Manager surface PRF outputs through Credential Manager's `GetPublicKeyCredentialOption` JSON? | Half day, real Android device |
| Q4 | Workers KV TTL precision for 5-min challenges — is 60s eventual consistency a problem in practice? | Half day, load test |
| Q5 | Should we store the salt-registry pubkey server-side as a "user_id"-style anchor, or only the WebAuthn credential ID? | Bake into Task 6 |

---

## 7. What changes in the codebase (high-level inventory, not code)

- New: `src/routes/api/auth/passkey/{register,login,credentials}/...`
- New: `src/lib/passkey/derive.ts` (the crypto pipeline of §3.2)
- New: `src/lib/passkey/saltRegistry.ts` (publish/query)
- New: `src/lib/passkey/session.ts` (in-memory nsec holder, auto-clear on tab unload)
- New: `wrangler.jsonc` KV binding `WEBAUTHN_CHALLENGES`
- New: `static/.well-known/{webauthn,apple-app-site-association,assetlinks.json}` (Task 8)
- New deps: `@simplewebauthn/server`, `@simplewebauthn/browser`, `@scure/bip32`, optionally `@scure/bip39` (replace `bip39`)
- New: Capacitor plugin (forked or new) — `capacitor-passkey-prf` or similar
- New: `src/lib/passkey/passkeyClient.ts` (one wrapper that uses SimpleWebAuthn on web and the native plugin on Capacitor)
- Modified: existing user/auth UI — add "Sign in with passkey" button alongside NIP-07 / NIP-46 / nsec import / QR
- Modified: members.zap.cooking schema (Task 6) — add `webauthn_credentials` table tied to existing user/pubkey records
