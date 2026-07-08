# Passkey vault (Phase 1) — manual test checklist

Feature: passkey-wrapped nsec vault replacing plaintext `nostrcooking_privateKey`
storage. Run on **Chrome desktop** (Google Password Manager or local profile
passkeys) and **Android Chrome** (GPM passkey). Status column: fill in per run.

**Test surface: `zap.cooking` / `staging.zap.cooking` ONLY.** rp.id is fixed to
`zap.cooking`; the feature is deliberately absent (no prompt, no settings card,
no unlock card) on previews (`*.pages.dev`), localhost, and any other origin —
seeing no passkey UI there is expected behavior, not a bug. Passkeys created by
pre-ruling preview builds are orphans bound to their preview origin; delete
them from your password manager.

Setup for most cases: log in by pasting an nsec (a throwaway test key) on a
browser profile with clean site data for zap.cooking.

## Enrollment & migration

| # | Steps | Expected | Chrome desktop | Android Chrome |
|---|-------|----------|----------------|----------------|
| 1 | Log in with pasted nsec | "Protect your key with a passkey" prompt appears (bottom card); copy says the passkey is NOT a backup and points to Settings → Security | ☐ | ☐ |
| 2 | Prompt → "Not now" | Prompt disappears; never reappears after reloads; `nostrcooking_privateKey` still in localStorage | ☐ | ☐ |
| 3 | Prompt → "Set up passkey" → complete both ceremonies | Success copy; `nostrcooking_vault_v1` present; `nostrcooking_privateKey` GONE; session still works (post a note) | ☐ | ☐ |
| 4 | Same as 3 but cancel the passkey sheet | No error banner; plaintext key untouched; no vault record | ☐ | ☐ |
| 5 | Settings → Security → "Set up passkey protection" (after dismissing prompt in 2) | Same behavior as 3 | ☐ | ☐ |

## Unlock / restore

| # | Steps | Expected | Chrome desktop | Android Chrome |
|---|-------|----------|----------------|----------------|
| 6 | After enrollment, reload the app | Not logged in; login overlay auto-opens with "Unlock with passkey" on top, other methods below | ☐ | ☐ |
| 7 | Unlock with passkey | Logged in as the same account; localStorage has NO `nostrcooking_privateKey`; vault record still present | ☐ | ☐ |
| 8 | Reload → cancel the passkey sheet | Overlay stays open, no error banner, all other login methods clickable; vault record intact | ☐ | ☐ |
| 9 | After 8, paste the same nsec | Logged in; still NO plaintext key written (adopted vault); vault record intact | ☐ | ☐ |
| 10 | Reload → dismiss overlay (X) | Anonymous browsing works; Login button re-opens overlay with unlock card | ☐ | ☐ |

## Post-migration functionality (in-memory key)

| # | Steps | Expected | Chrome desktop | Android Chrome |
|---|-------|----------|----------------|----------------|
| 11 | While unlocked: open a DM conversation | Decrypts without errors | ☐ | ☐ |
| 12 | While unlocked: marketplace → message a seller | Encrypt/send works | ☐ | ☐ |
| 13 | While unlocked: wallet → create a relay backup (NWC or Spark seed) | Backup creation allowed and succeeds (exercises `canCreateNostrBackup`/`getPrivateKey` in-memory path) | ☐ | ☐ |
| 14 | Settings → Security → Reveal Private Key | nsec revealed from memory, matches the original key | ☐ | ☐ |

## Removal / downgrade

| # | Steps | Expected | Chrome desktop | Android Chrome |
|---|-------|----------|----------------|----------------|
| 15 | Settings → Security → "Remove passkey protection…" → confirm → complete passkey ceremony | Plaintext key restored in localStorage; vault record gone; session continues as privateKey; backup warning shown before ceremony | ☐ | ☐ |
| 16 | Same but cancel the ceremony | Nothing changes: record present, no plaintext | ☐ | ☐ |

## Conflict / replace flows

| # | Steps | Expected | Chrome desktop | Android Chrome |
|---|-------|----------|----------------|----------------|
| 17 | With a vault enrolled (locked), paste a DIFFERENT account's nsec | "Replace saved login?" confirmation; Cancel → nothing changes; Confirm → vault deleted, new account logged in with plaintext (legacy) | ☐ | ☐ |
| 18 | With a vault enrolled, "Create Profile" (fresh keys) | Plain-language "saved login for another account" confirmation before proceeding | ☐ | ☐ |
| 19 | With a vault enrolled, Google Drive restore of the SAME account | Logs in silently adopting the vault; no plaintext written | ☐ | ☐ |
| 20 | With a vault enrolled, Google Drive restore of a DIFFERENT account | Replace confirmation, then legacy login on confirm | ☐ | ☐ |

## Phase 2 — cross-device sign-in (requires PASSKEY_SYNC_ENABLED = true build)

Prereqs: staging or production only (previews have no passkey UI by design);
`VAULT_SYNC` bound and `VAULT_SYNC_CHALLENGE_SECRET` set in the environment.

| # | Steps | Expected | Status |
|---|-------|----------|--------|
| P2-1 | Enroll with "Enable sign-in on other devices" checked (default) | Exactly TWO passkey prompts (create + verify); Settings shows sync On; server has the blob | ☐ |
| P2-2 | Enroll with the toggle unchecked | Two prompts; no network calls to /api/vault-sync; Settings shows sync Off | ☐ |
| P2-3 | New-device sign-in, same ecosystem: Safari↔Safari (iCloud) | Device B: "Sign in with passkey" → one biometric → signed in as the real identity; localStorage has the record, NO plaintext key; subsequent reloads unlock locally (no network) | ☐ |
| P2-4 | Same, Chrome desktop ↔ Android Chrome (GPM) | Same as P2-3 | ☐ |
| P2-5 | Cross-ecosystem miss (enrolled in iCloud, try on Android/GPM) | Passkey not offered by the provider — EXPECTED, not a bug; user falls through to nsec/other login | ☐ |
| P2-6 | Hybrid/QR cross-device assertion (scan QR to phone) | If the provider drops PRF: clean "did not provide the required key material" error, normal methods still available, nothing persisted | ☐ |
| P2-7 | Settings → toggle sync OFF | One passkey confirmation (disclosed in copy); blob gone (verify: sign-in fails on a cleared second device); toggle Off | ☐ |
| P2-8 | Settings → toggle sync back ON | One passkey confirmation (disclosed in copy); blob re-uploaded; new-device sign-in works again | ☐ |
| P2-9 | Remove passkey protection while sync is on | Single ceremony (no extra prompt for the delete); server blob gone; local downgrade as Phase 1 | ☐ |
| P2-10 | Pre-Phase-2 vault (enrolled before this build): Settings sync area | "Re-create passkey & enable" card with orphan-passkey + extra-prompt copy; completing it enables sync; old provider passkey deletable | ☐ |
| P2-11 | Enrollment with the network blocked (devtools offline after page load) | Enrollment still succeeds locally; sync retries silently on next unlock (verify with devtools online: PUT fires during unlock, single prompt) | ☐ |
| P2-12 | Conflict-replace (different account's nsec over a synced vault) | Local record replaced after confirm; NO vault-sync network call; original owner's other devices still sign in (R4) | ☐ |

## Non-regression

| # | Steps | Expected | Chrome desktop | Android Chrome |
|---|-------|----------|----------------|----------------|
| 21 | NIP-07 extension login + logout | Unchanged | ☐ | n/a |
| 22 | NIP-46 bunker paste login + reload restore | Unchanged | ☐ | ☐ |
| 23 | Logout while enrolled | Logged out; vault record survives; next load shows unlock overlay | ☐ | ☐ |
| 24 | iOS Capacitor build (simulator ok) | No passkey UI anywhere: no prompt, no settings card, login form unchanged | n/a | n/a (iOS) |
| 25 | Legacy user (plaintext key, never enrolls) across reloads | Behavior identical to before this change | ☐ | ☐ |
