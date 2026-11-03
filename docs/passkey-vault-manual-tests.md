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
| 2 | Prompt → "Not now" | Prompt disappears for 30 days (`nostrcooking_vault_prompt_dismissed` holds an ISO timestamp; set it 31 days back in devtools and reload → prompt returns); `nostrcooking_privateKey` still in localStorage | ☐ | ☐ |
| 2b | Prompt → "Don't ask again" | Prompt disappears and never reappears after reloads (`nostrcooking_vault_prompt_dismissed` = `never`; a legacy `1` behaves the same); enrollment still reachable in Settings → Security | ☐ | ☐ |
| 2c | Prompt → "Set up passkey" with "Sign in on my other devices" checked (default) | As P2-1: two passkey prompts, Settings shows sync On, server has the blob. Unchecked → as P2-2 | ☐ | ☐ |
| 3 | Prompt → "Set up passkey" → complete both ceremonies | Success copy; `nostrcooking_vault_v1` present; `nostrcooking_privateKey` GONE; session still works (post a note) | ☐ | ☐ |
| 4 | Same as 3 but cancel the passkey sheet | No error banner; plaintext key untouched; no vault record | ☐ | ☐ |
| 5 | Settings → Security → "Turn on passkey protection" (after dismissing prompt in 2) | Same behavior as 3 | ☐ | ☐ |

## Backup gate before enrollment (all paths)

KeyBackupGate renders the nsec (masked, Reveal/Copy), the npub, and "Download
backup file" in front of every enrollment button. It is satisfied by a
download, a clipboard copy that actually succeeded, or — existing users only —
ticking "I already have my nsec backed up somewhere safe". Signup never shows
that checkbox. There is no component-test infra for LoginOverlay; the signup
rows below are the regression check for the extraction.

| # | Steps | Expected | Chrome desktop | Android Chrome |
|---|-------|----------|----------------|----------------|
| G-1 | Login-time prompt (row 1) | Prompt shows the backup gate above the buttons; "Set up passkey" is DISABLED with the "Save your key to continue…" hint; no "Back up first" link | ☐ | ☐ |
| G-2 | Prompt → "Download backup file" | File `zapcooking-keys-YYYY-MM-DD.txt` contains npub + nsec + safety notes; "Set up passkey" enables | ☐ | ☐ |
| G-3 | Prompt → Reveal → Copy (clipboard allowed) | "Copied" toast; button enables. Deny clipboard permission first: "Could not copy" toast and button STAYS disabled | ☐ | ☐ |
| G-4 | Prompt → tick "I already have my nsec backed up" | Button enables; un-tick → disabled again (unless a download/copy also happened) | ☐ | ☐ |
| G-5 | Settings → Security (plaintext session) | Same gate and same enable rules as G-1..G-4 in front of "Turn on passkey protection"; cancel the passkey sheet after enabling → plaintext key still present | ☐ | ☐ |
| G-6 | Settings → Security while ENROLLED (unlocked passkey session) | "Download key backup" button next to "Turn off passkey protection"; downloads the same file from the in-memory key; absent for nip07/nip46 sessions and when locked | ☐ | ☐ |
| G-7 | Signup regression: Create Profile → (Secure step skipped or done) → "Save your backup key" | Step 1 looks and behaves as before: Reveal/Copy, npub Copy, Download; "Next" disabled until download or successful copy; NO "I already have…" checkbox; regenerate keys → gate resets | ☐ | ☐ |
| G-8 | Signup regression: close the modal mid-step-1, reopen, Create Profile again | Fresh keys, gate reset, Next disabled | ☐ | ☐ |

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
| 15 | Settings → Security → "Turn off passkey protection" → "Unlock & turn off" → complete passkey ceremony | Plaintext key restored in localStorage; vault record gone; session continues as privateKey; backup warning shown before ceremony with a working "Download key backup" button in the confirmation row; notice reads "Passkey protection is off…" | ☐ | ☐ |
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

Note on failed blob deletes (P2-7/P2-9): if the server DELETE fails, the
orphaned blob is not retried — it remains assertion-gated (unreadable without
the passkey ceremony) and expires via the 370-day KV TTL. This is by design,
not data loss.

| # | Steps | Expected | Status |
|---|-------|----------|--------|
| P2-1 | Enroll with "Enable sign-in on other devices" checked (default) | Exactly TWO passkey prompts (create + verify); Settings label reads "Sign in on other devices: On"; server has the blob | ☐ |
| P2-2 | Enroll with the toggle unchecked | Two prompts; no network calls to /api/vault-sync; Settings label reads "Sign in on other devices: Off" | ☐ |
| P2-3 | New-device sign-in, same ecosystem: Safari↔Safari (iCloud) | Device B: "Sign in with passkey" → one biometric → signed in as the real identity; localStorage has the record, NO plaintext key; subsequent reloads unlock locally (no network) | ☐ |
| P2-4 | Same, Chrome desktop ↔ Android Chrome (GPM) | Same as P2-3 | ☐ |
| P2-5 | Cross-ecosystem miss (enrolled in iCloud, try on Android/GPM) | Passkey not offered by the provider — EXPECTED, not a bug; user falls through to nsec/other login | ☐ |
| P2-6 | Hybrid/QR cross-device assertion (scan QR to phone) | If the provider drops PRF: clean "did not provide the required key material" error, normal methods still available, nothing persisted | ☐ |
| P2-7 | Settings → toggle sync OFF | One passkey confirmation (disclosed in copy); blob gone (verify: sign-in fails on a cleared second device); label reads "Sign in on other devices: Off" and the control shows Off | ☐ |
| P2-8 | Settings → toggle sync back ON | One passkey confirmation (disclosed in copy); blob re-uploaded; new-device sign-in works again; label reads "Sign in on other devices: On" | ☐ |
| P2-9 | "Turn off passkey protection" while sync is on | Single ceremony (no extra prompt for the delete); server blob gone; local downgrade as Phase 1 | ☐ |
| P2-10 | Pre-Phase-2 vault (enrolled before this build): Settings sync area | "Re-create passkey & enable" card with orphan-passkey + extra-prompt copy (label shows no On/Off state for these records — unchanged); completing it enables sync; old provider passkey deletable | ☐ |
| P2-11 | Enrollment with the network blocked (devtools offline after page load) | Enrollment still succeeds locally; sync retries silently on next unlock (verify with devtools online: PUT fires during unlock, single prompt) | ☐ |
| P2-12 | Conflict-replace (different account's nsec over a synced vault) | Local record replaced after confirm; NO vault-sync network call; original owner's other devices still sign in (R4) | ☐ |

## Phase 3 — passkey-first signup (requires PASSKEY_SIGNUP_ENABLED + PASSKEY_SYNC_ENABLED = true build)

| # | Steps | Expected | Status |
|---|-------|----------|--------|
| P3-1 | Full signup, Safari desktop: Create Profile → Secure your account (sync checked) → two biometric prompts → backup (download) → profile → land. **Then immediately "Sign in with passkey" on the paired iPhone.** | The launch-story demo end to end: signed up with a fingerprint, signed in on the phone with a face. No plaintext key in desktop localStorage at any point (verify devtools). Backup banner reads "Passkey created… this key is your account". | ☐ |
| P3-2 | Same on Chrome desktop → Android phone (GPM) | Same | ☐ |
| P3-3 | Skip path: tap "Skip for now" | Remainder of signup is byte-identical to today (plaintext path); Settings enrollment still offered later | ☐ |
| P3-4 | Cancel the biometric sheet mid-step | Stays on the step, no error banner; retry works; skip still available | ☐ |
| P3-5 | Failure recovery: provider without PRF (e.g. security key selected) | Friendly error + orphan-passkey note as a separate line; continue → account created on plaintext path | ☐ |
| P3-6 | Unsupported browser (e.g. Firefox ESR) or preview origin | Secure step never renders — flow identical to today, not a disabled step | ☐ |
| P3-7 | Conflict at signup: browser holds another account's vault → Create Profile | "Replace saved login?" dialog BEFORE the secure step; confirm → local record replaced (no network call), step proceeds; cancel → step skipped, plaintext signup | ☐ |
| P3-8 | Sync checkbox unchecked at signup | Enrolled locally, zero /api/vault-sync traffic (devtools network) | ☐ |
| P3-9 | Abandon the modal right after enrolling (before backup) | User lands logged in (passkey session); Settings shows enrolled vault; nsec reveal available for backup | ☐ |
| P3-10 | Hybrid enrollment at signup, Chrome desktop: at the create sheet pick the cross-device option and use a phone (Android, or iPhone on iOS 18.4+) | Pointer line ("You can also set this up with your phone…") visible under the button on Chrome desktop ONLY — absent on Safari and on mobile. Enrollment completes after TWO phone round-trips (create + verify-get; iPhone = QR scan each); vault + sync behave as P3-1/P3-2. Note the resulting desktop vault unlocks via the phone each time (QR per unlock on iPhone) until multi-passkey lands — expected, document don't fix | ☐ |

## Non-regression

| # | Steps | Expected | Chrome desktop | Android Chrome |
|---|-------|----------|----------------|----------------|
| 21 | NIP-07 extension login + logout | Unchanged | ☐ | n/a |
| 22 | NIP-46 bunker paste login + reload restore | Unchanged | ☐ | ☐ |
| 23 | Logout while enrolled | Logged out; vault record survives; next load shows unlock overlay | ☐ | ☐ |
| 24 | iOS Capacitor build (simulator ok) | No passkey UI anywhere: no prompt, no settings card, login form unchanged | n/a | n/a (iOS) |
| 25 | Legacy user (plaintext key, never enrolls) across reloads | Behavior identical to before this change | ☐ | ☐ |
