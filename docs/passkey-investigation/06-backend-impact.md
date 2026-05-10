# Task 6 — Backend Impact

**Status:** Complete. Scope: zap.cooking-controlled surfaces only — Cloudflare Workers (SvelteKit `+server.ts` routes) and the pantry API (Postgres). Members/relay code on `pantry.zap.cooking` is owned by us, so schema changes there are in scope.

---

## 1. What the server needs to store

For each registered passkey credential, persist:

| Field | Type | Source | Why |
|---|---|---|---|
| `credential_id` | bytea (CBOR-encoded credential ID, ~16–256 bytes) | Returned by authenticator at registration | Primary identifier for the credential; what `allowCredentials` uses at login |
| `public_key` | bytea (COSE-encoded EC2/OKP key, typically 77 bytes for ES256) | Registration response | Used to verify assertion signatures |
| `counter` | bigint | Registration + each authentication | Monotonic counter for clone-detection; some authenticators always return 0 (synced passkeys). We accept that and rely on credential-binding for replay defense. |
| `aaguid` | uuid (16 bytes) | Registration response | Identifies the authenticator model (Apple Keychain, Google PM, 1Password, YubiKey 5, etc.). Useful for analytics and provider-specific UX hints. |
| `transports` | text[] (e.g. `["internal", "hybrid"]`) | Registration response | Tells the browser at login time how to reach the authenticator (platform / cross-device QR / NFC) |
| `nostr_pubkey` | text (hex) | Derived client-side at registration; sent to server | Binds this credential to the user's Nostr identity. **The derived nsec is never sent.** |
| `salt_registry_pubkey` | text (hex) | Derived client-side; sent to server | Optional; lets us look up users by their salt-registry account if needed. Could be omitted for v1. |
| `device_label` | text (nullable, user-editable) | Set by user post-registration ("My iPhone") | UX nicety — credential listing |
| `created_at` | timestamptz | Server-assigned | Audit |
| `last_used_at` | timestamptz | Updated on each successful auth | Audit + UX ("last signed in 2 days ago") |
| `revoked_at` | timestamptz (nullable) | Set if user revokes | Soft-delete for audit trail |

**Critically, the server does NOT store:**
- The derived nsec (it's a client secret, never sent over the wire)
- The PRF outputs (same)
- The per-salt mnemonics (same)
- The passkey itself (lives in the user's authenticator — server only sees the public key)
- The user's biometric data (never leaves the device)

### Schema sketch (Postgres on pantry.zap.cooking)

```sql
CREATE TABLE webauthn_credentials (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id   bytea NOT NULL UNIQUE,
  public_key      bytea NOT NULL,
  counter         bigint NOT NULL DEFAULT 0,
  aaguid          uuid,
  transports      text[] DEFAULT '{}',
  nostr_pubkey    text NOT NULL,                    -- hex, 64 chars
  salt_registry_pubkey text,                         -- hex, 64 chars, optional
  device_label    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz,
  revoked_at      timestamptz,
  CHECK (length(nostr_pubkey) = 64)
);

CREATE INDEX webauthn_credentials_nostr_pubkey_idx ON webauthn_credentials (nostr_pubkey) WHERE revoked_at IS NULL;
CREATE INDEX webauthn_credentials_credential_id_idx ON webauthn_credentials (credential_id) WHERE revoked_at IS NULL;
```

A nostr_pubkey can have multiple credentials (one per device). At login, the user types their npub *or* we use a `mediation: "discoverable"` flow where the browser presents all matching credentials and the resolved credential ID tells us the user.

### Challenge state (Cloudflare KV, not Postgres)

```
KV namespace: WEBAUTHN_CHALLENGES
Key: <random uuid>
Value: { type: "register"|"login", challenge: <base64url>, npub?: string, created_at: <unix> }
TTL: 300 seconds
```

KV is the right tool: short-lived, single-write, single-read per ceremony, eventual consistency tolerable for ~5-minute nonces because each challenge is bound to a single user agent and used immediately.

---

## 2. New endpoints (mapped to SvelteKit routes)

All under `src/routes/api/auth/passkey/`.

### Registration

**`POST /api/auth/passkey/register/options`** — body: `{ npub?: string }` (npub optional for first-time signup)
1. Generate a 32-byte challenge.
2. Persist `{ type: "register", challenge, npub }` to `WEBAUTHN_CHALLENGES` KV with 300s TTL. Return KV key as `challengeId`.
3. Build `PublicKeyCredentialCreationOptions` via `@simplewebauthn/server.generateRegistrationOptions`:
   - `rpName: "Zap Cooking"`, `rpID: "zap.cooking"`
   - `userName: npub ?? randomUserId()`, `userID: pubkey-bytes-or-random`, `userDisplayName: "Zap Cooking"`
   - `attestationType: "none"` (see §6 — we don't use attestation for v1)
   - `authenticatorSelection: { userVerification: "required", residentKey: "preferred" }`
   - `extensions: { prf: { eval: { first: utf8("zap.cooking") } } }` (eval used at create-time to probe PRF capability; full results come at assertion)
   - `excludeCredentials`: existing credentials for this npub if present
4. Return `{ optionsJSON, challengeId }`.

**`POST /api/auth/passkey/register/verify`** — body: `{ challengeId, attestation, npub, saltRegistryPubkey? }`
1. Fetch challenge from KV by `challengeId`. If missing/expired → 410 Gone.
2. Run `verifyRegistrationResponse` with `expectedChallenge`, `expectedOrigin: "https://zap.cooking"`, `expectedRPID: "zap.cooking"`, `requireUserVerification: true`.
3. If `verified: true`:
   - INSERT into `webauthn_credentials` with the returned `credentialID`, `credentialPublicKey`, `counter`, `aaguid`, `transports`, plus the npub (already-derived client-side) and optional saltRegistryPubkey.
   - Delete the challenge from KV.
   - Issue a session (JWT signed by Workers env secret, or server-side session in KV — match the rest of the auth model on zap.cooking; we don't currently maintain server sessions, see §3 below).
4. Return `{ success: true, credentialId, sessionToken? }`.

### Authentication

**`POST /api/auth/passkey/login/options`** — body: `{ npub? }` (optional; supports discoverable credentials)
1. Generate challenge → KV.
2. Build `PublicKeyCredentialRequestOptions`:
   - `rpID: "zap.cooking"`, `userVerification: "required"`
   - `allowCredentials`: if `npub` provided, list that user's credential IDs (with their `transports`); else `[]` (let browser present discoverable credentials).
   - `extensions: { prf: { eval: { first: MAGIC_BYTES, second: utf8("zap.cooking") } } }` — both PRF inputs batched.
3. Return `{ optionsJSON, challengeId }`.

**`POST /api/auth/passkey/login/verify`** — body: `{ challengeId, assertion }`
1. Fetch challenge from KV → 410 if missing.
2. Look up credential by `assertion.id` → 404 if missing/revoked.
3. Run `verifyAuthenticationResponse` with the stored `credentialPublicKey`, `credentialID`, `counter`, `expectedChallenge`, `expectedOrigin`, `expectedRPID`, `requireUserVerification: true`.
4. If `verified: true`:
   - Update `last_used_at` and `counter` (if non-zero increment).
   - Delete challenge from KV.
   - Issue session.
5. Return `{ success: true, npub: credential.nostr_pubkey, sessionToken }`.

The client uses `npub` to derive its in-memory nsec (already done client-side via PRF). The server's response just confirms the npub the client should expect.

### Credential management

**`GET /api/auth/passkey/credentials`** — auth required → list this npub's credentials with `device_label`, `aaguid`-derived provider name, `last_used_at`, `created_at`.

**`PATCH /api/auth/passkey/credentials/:id`** — body: `{ device_label }` → rename a credential.

**`DELETE /api/auth/passkey/credentials/:id`** — soft-delete (set `revoked_at`). Requires the user's npub to own that credential. Optional safety: forbid deleting the last credential without a confirmation step (otherwise the user is locked out unless they have one of the existing auth methods configured).

---

## 3. Integration with the existing user model

zap.cooking's user model is **npub-based** — there is no traditional user account; the user's Nostr pubkey *is* their identity. Membership is keyed by pubkey in pantry.zap.cooking's `members` table (see `src/lib/membershipApi.server.ts`). NIP-05, profiles, recipes, and cookbook entries are all keyed by npub on Nostr itself.

This works in our favor:

- A passkey credential is just another way to **acquire** the npub's signing key (the nsec) at session start. It doesn't create a new "user account" in our DB beyond the credential row.
- No need for password reset, email recovery, etc. — there are no passwords.
- A passkey-derived npub is indistinguishable from any other npub once it's in memory. Existing event-publish, signing, and posting paths work without modification.
- Membership lookup is unchanged: `lookupMember(passkeyDerivedNpub, apiSecret)` — same call, same result.

### Session model

zap.cooking does not currently maintain server sessions for normal Nostr signing — the client holds the signing key (NIP-07/NIP-46/nsec) in memory and posts events directly to relays. The server is mostly stateless w.r.t. user identity (modulo membership lookups, which are stateless API calls).

For passkey login we have two options:

**Option a — No server session.** Treat passkey login as "the client now has a signed-in nsec in memory." Server doesn't track who's logged in. Same as today's NIP-07/NIP-46 flows. Login/verify endpoint just returns `{ verified: true, npub }` and the client takes it from there.

**Option b — Server session.** Issue a JWT or KV-backed session token. Endpoints that today don't require auth could optionally check it (e.g., `/api/membership` could verify the caller is who they say they are). Adds server-side session lifetime management.

**Recommendation:** **Option a for v1.** It matches the rest of the app's auth model and avoids introducing server-side session state that didn't exist. If specific endpoints later need authenticated server access, add it then.

---

## 4. How the derived nsec maps to the user

- Client derives nsec in memory at login (Task 5 §3.2).
- Client knows its own npub from the derivation; server confirms the npub stored against the credential matches.
- For all subsequent app behavior, the npub is the user identity, indistinguishable from any other npub flow.
- **First-time signup:** the client derives the nsec, derives the npub, then includes the npub in the `register/verify` payload. Server stores it with the credential. There is no membership row created automatically — that's a separate step (existing payment flow).

---

## 5. Rate limiting and abuse defenses

| Surface | Threat | Defense |
|---|---|---|
| `register/options` | Floods of challenge generation eating KV quota | Cloudflare WAF rate limit per IP: 30/min; per-Cloudflare-Worker-cf-connecting-ip header. KV TTL caps storage anyway. |
| `register/verify` | Brute-forcing challenges | Challenge ID is a 128-bit UUID; one-shot consumption; 300s TTL. Brute force not feasible. |
| `login/options` with `npub` enumeration | Discovering whether an npub has registered | Always return options whether or not the npub exists; populate `allowCredentials` from a fake plausible list if not registered (constant-time UX) — or accept that this isn't a strong privacy guarantee since npubs are public on Nostr. |
| `login/verify` | Replay of captured assertion | WebAuthn binds assertion to the random challenge + RP origin; replay isn't possible unless the original challenge was reused. We don't reuse. Counter increment helps for non-synced authenticators. |
| `credentials/:id` deletion | Account lockout via stolen session cookie | Require a recent passkey assertion to delete (i.e., re-authentication step before deletion). |
| Generic | Bot signup spam | Cloudflare Turnstile on the registration form, optional; or rely on the biometric requirement to slow attackers (real biometric for each fake account is expensive). |

---

## 6. Attestation policy

WebAuthn attestation lets a server cryptographically verify the authenticator model (e.g., "this is a real YubiKey, not a software wallet pretending to be one"). Most consumer use cases don't need it.

**Recommendation: `attestationType: "none"` for v1.**

Rationale:
- We don't restrict to specific authenticator models — any PRF-capable platform authenticator is fine.
- Synced passkeys (Apple Keychain, Google PM) often return no attestation or a "self" attestation that's not cryptographically meaningful.
- Privacy-preserving — we don't track AAGUIDs against device databases.
- We still capture the AAGUID returned in the credential properties, for analytics/provider hints, even with `attestationType: "none"`.

If we ever ship a "high-security mode" (e.g., for high-value accounts), reconsider with `attestationType: "direct"` and an FIDO Metadata Service lookup.

---

## 7. Replay protection summary

WebAuthn already provides robust replay protection by design:
1. Server-issued challenge (random 32 bytes, one-shot, 5-minute TTL).
2. Challenge bound into `clientDataJSON` and signed by authenticator.
3. RP origin bound into `clientDataJSON` and verified by server.
4. RP ID bound into `authenticatorData` and verified by server.
5. Counter incremented on each use (when authenticator supports it).

Our additional layer: KV-stored challenges deleted on use → can't be reused even within the 5-minute TTL.

---

## 8. Endpoint changes summary

| Endpoint | Surface | New? |
|---|---|---|
| `POST /api/auth/passkey/register/options` | Workers | New |
| `POST /api/auth/passkey/register/verify` | Workers | New |
| `POST /api/auth/passkey/login/options` | Workers | New |
| `POST /api/auth/passkey/login/verify` | Workers | New |
| `GET /api/auth/passkey/credentials` | Workers | New |
| `PATCH /api/auth/passkey/credentials/:id` | Workers | New |
| `DELETE /api/auth/passkey/credentials/:id` | Workers | New |
| `POST /api/members/{pubkey}/credentials` | pantry.zap.cooking (new) | New — internal endpoint Workers calls to persist the credential row |
| `GET /api/members/{pubkey}/credentials` | pantry.zap.cooking (new) | New — internal lookup |
| `DELETE /api/members/{pubkey}/credentials/:id` | pantry.zap.cooking (new) | New |
| `GET /api/members/{pubkey}` | pantry.zap.cooking (existing) | Unchanged |

The split: Workers do WebAuthn protocol work + KV challenge state; pantry stores credential rows in Postgres. Workers call pantry over its existing authenticated internal API (Bearer token, same pattern as `lookupMember`).

---

## 9. KV namespaces to add to wrangler.jsonc

```jsonc
"kv_namespaces": [
  // existing
  { "binding": "SHORTLINKS", "id": "..." },
  { "binding": "GATED_CONTENT", "id": "..." },
  { "binding": "NOURISH_FLAGS", "id": "..." },
  // new
  { "binding": "WEBAUTHN_CHALLENGES", "id": "<create via wrangler kv namespace create>" }
]
```

---

## 10. Open questions

| # | Question | Resolution |
|---|---|---|
| Q1 | Server session model — opt a or b? | Recommend (a) for v1; revisit if specific endpoints need it. |
| Q2 | Should we store `salt_registry_pubkey` in v1? | Optional. Useful for "find users by their nostr_account" admin queries. Cheap to add now; costly to backfill later. Recommend storing. |
| Q3 | How many credentials per npub? Cap? | Suggest soft cap of 10; hard cap of 50. Real users have 1-3 devices. |
| Q4 | Re-auth before destructive credential ops? | Yes — fresh passkey assertion required to delete a credential or change account email. |
| Q5 | What does "logout" mean in v1? | Drop the in-memory nsec. Browser closes the tab → same effect. No server-side session to invalidate (per Q1). |
| Q6 | Pantry schema migration — when? | Part of Phase C; standalone migration before app-side changes ship. |
