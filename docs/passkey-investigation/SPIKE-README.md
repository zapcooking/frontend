# Phase C.0 Spike — Runbook

> ⚠️ **Branch:** `spike/passkey-prf-validation`
> **Throwaway code. Do NOT merge to main.** This harness exists only to validate that `@capgo/capacitor-passkey` (v8.3.0) round-trips a WebAuthn PRF ceremony on real iOS 18.4+ and Android 14+ devices, scoped to rpID `zap.cooking`.

---

## What this branch contains

| File | Purpose |
|---|---|
| `src/routes/spike/passkey/+page.svelte` | The harness UI — six buttons that exercise PRF registration and assertion |
| `capacitor.config.ts` (modified) | Adds `plugins.CapacitorPasskey` config (`origin: https://zap.cooking`, `domains: [zap.cooking, www.zap.cooking]`, `autoShim: true`) |
| `package.json` (modified) | Adds `@capgo/capacitor-passkey` v8.3.0 dependency |

That's it. No server endpoints, no real auth flow, no derivation pipeline, no UI integration with the rest of the app. The harness page is reachable at `/spike/passkey` only on this branch.

**No real user data is touched.** All PRF inputs are SHA-256 of fixed dummy strings. Any passkey credential created during the spike is a test artifact unrelated to any real zap.cooking user.

---

## Pre-flight checklist (run once before Day 1)

1. **Plugin and config installed** ✅ already in this branch.
2. **Well-known files live in production** ✅ from #384. Verify quickly:
   ```bash
   curl -sI https://zap.cooking/.well-known/apple-app-site-association | grep -i content-type
   curl -sI https://zap.cooking/.well-known/assetlinks.json            | grep -i content-type
   curl -sI https://zap.cooking/.well-known/webauthn                   | grep -i content-type
   ```
   All three should report `content-type: application/json`.
3. **Run `npx cap sync ios && npx cap sync android`** before the first build. The plugin's auto-config hook will:
   - Create/update `ios/App/App/App.entitlements` adding `webcredentials:zap.cooking`
   - Wire `CODE_SIGN_ENTITLEMENTS` in the Xcode project
   - Inject `asset_statements` metadata into Android `AndroidManifest.xml` and a generated string resource
   - These changes are real native-project edits. Review the `git status` after sync. They will be committed on this spike branch — that's intentional, since they're the artifacts the spike validates.
4. **iOS device:** iPhone running iOS 18.4 or later, signed into iCloud with iCloud Keychain enabled, registered with Apple Developer account `Z26TJQZZWC`.
5. **Android device:** Phone running Android 14 (API 34) or later, with Google Password Manager set as the default passkey provider.
6. **Android signing:** the AssetLinks file at zap.cooking is bound to the **production** signing certificate. If you build from Android Studio with the debug keystore, `delegate_permission/common.get_login_creds` will not validate and the OS will refuse to create a passkey for `zap.cooking`. Two options:
   - **Recommended:** sign the spike build with the production keystore (matches what's deployed to Play Store).
   - **Alt:** temporarily add the debug keystore SHA-256 to `static/.well-known/assetlinks.json` on a separate branch, deploy, and remember to revert before `chore/passkey-well-knowns` was tied to anything else. Cleaner to just sign with prod.

---

## Build and install

### iOS

```bash
pnpm build:mobile          # static SvelteKit build for Capacitor
npx cap sync ios           # syncs WebView assets + auto-configures entitlements
open ios/App/App.xcworkspace
# In Xcode: select your real device, Product → Run
```

Once the app launches, navigate inside the app's WebView to the spike page. Easiest way: paste this into Safari on the device's URL bar to open via deep link, OR temporarily add a homepage button that links to `/spike/passkey`, OR (simplest) point the Capacitor app at a local dev server during the spike via `capacitor.config.ts` `server.url` and navigate there.

If using `server.url` for ease of iteration, use the Mac's LAN IP and `pnpm dev --host 0.0.0.0 --https`. The HTTPS requirement is real for WebAuthn — self-signed cert is OK on iOS if you trust it via Settings.

### Android

```bash
pnpm build:android
npx cap sync android
# Open android/ in Android Studio
# Run on real device, signed with the cert whose SHA matches assetlinks.json
```

Same notes apply for `/spike/passkey` access.

### Web (smoke test only — not the real validation)

```bash
pnpm dev
# Open https://localhost:<port>/spike/passkey
```

The web smoke test is useful for confirming the JS harness logic is sound, but it tests against `rpId: zap.cooking` which won't validate from `localhost` origin. To actually run the harness on the real RP from a browser, you'd need to either:
- Deploy the spike branch to a Cloudflare Pages preview at `*.frontend-hvd.pages.dev` (still wrong rpID) — or
- Test from `https://zap.cooking/spike/passkey` after merging (which we are explicitly NOT doing for this throwaway).

The actually meaningful surface for this spike is **Capacitor iOS and Capacitor Android**, where the app's bundle ID is the WebAuthn relying-party association.

---

## Day 1 — single-device PRF (iOS first)

Open the harness in the Capacitor iOS build. Confirm the env line says `Capacitor ios` and `Plugin loaded: ✅ yes`.

| Step | Button | Expected result | Abort signal |
|---|---|---|---|
| 1.4 | "1. Register passkey (PRF input A)" | Face ID prompt → success → `prf.enabled: true` in result panel | Registration succeeds but `prf.enabled !== true` |
| 1.5 | "2. Assert with input A → OUT_A" | Face ID → success → 32-byte PRF output displayed (first 8 bytes hex shown by default) | Assertion succeeds but `prf.results.first` is undefined or not 32 bytes |
| 1.7 | "3. Assert with input B → OUT_B" | Face ID → 32-byte output, **different** from OUT_A | OUT_B equals OUT_A (broken PRF) |
| 1.8 | "4. Assert with input A again → OUT_A_repeat" | Face ID → 32-byte output, **identical** to OUT_A | Same input gives different output across runs (broken determinism) |

The "Day 1 comparisons" section auto-shows MATCH/DIFFER badges as steps complete.

**STOP and report at the abort signal.** Don't continue to Day 2 if Day 1 fails. Click "📋 Copy report snippet" and paste into a draft `SPIKE-RESULT.md`.

---

## Day 2 — Android repeat

Same steps, on the Android Capacitor build. Confirm env says `Capacitor android` and plugin loaded.

If anything is missing or off (specifically: PRF outputs missing or malformed):
1. Open Chrome DevTools remote inspection on the device (`chrome://inspect`)
2. In the spike page, expand the failing step's "Raw clientExtensionResults JSON" panel
3. Copy that JSON into the report
4. **STOP.** This is either a "fork the plugin" or "Android ecosystem isn't ready" finding — do not push past EOD trying to make it work.

Day 2 is also the point at which we'd discover whether `delegate_permission/common.get_login_creds` validation is working. If creating a passkey for `zap.cooking` fails outright on Android, suspect the signing-cert mismatch from the pre-flight checklist before suspecting the plugin.

---

## Day 3 — cross-platform determinism

This is the recovery-scenario test. It validates that PRF outputs are byte-for-byte identical across devices that share the same synced passkey. If they're not, our recovery model is broken.

### iOS: iPhone → iPad

1. **iPhone:** click "5. Register passkey (DETERMINISM input)", then "6. Assert with DETERMINISM input → OUT". Capture the full 32-byte hex (toggle "Show full PRF outputs").
2. **Wait ~1 minute for iCloud Keychain sync.** Verify on the iPad that the credential is present (Settings → Passwords → search for `zap.cooking`).
3. **iPad:** open the same Capacitor iOS spike build (same TestFlight/dev install). Open `/spike/passkey`. **Click only step 6** ("Assert with DETERMINISM input"). The OS picker should show the synced passkey.
4. **Compare the 32-byte hex outputs side-by-side.** They must match exactly.

### Android: phone → second device (or Chrome on desktop)

1. **Phone:** click "5. Register" then "6. Assert". Capture the 32-byte hex.
2. **Wait for Google Password Manager sync** (usually near-immediate; can take a minute).
3. **Second device** (second Android phone with same Google account, OR Chrome on desktop signed into the same account): navigate to a context that can run the harness. For Chrome desktop: deploy the spike branch to a `preview` URL and visit there — note that the rpID will differ, so this leg of Day 3 is technically validating the cross-device-via-Google-PM property within whatever rpID the preview hosts. For a faithful test, use a second Android device with the same Capacitor build.
4. **Click only step 6.** Compare hex outputs — must match.

### Failure mode

If outputs differ across devices in either ecosystem, the recovery story is broken. **Abort the spike, recommend re-evaluation in `SPIKE-RESULT.md`.**

---

## Decision matrix → `SPIKE-RESULT.md`

| Spike outcome | Recommendation |
|---|---|
| All three days clean across both platforms | **Proceed** with `@capgo/capacitor-passkey` in Phase C |
| iOS works, Android PRF returns malformed | **Fork** the plugin's Android side; contribute upstream |
| iOS works, Android PRF entirely absent | **Wait** — ship iOS-first, defer Android until ecosystem catches up |
| PRF outputs differ across synced devices in either ecosystem | **Abort** — recovery model is broken; re-evaluate architecture |
| Any other failure mode | Document and present options to Seth |

The harness's "📋 Copy report snippet" button produces a markdown table you can paste directly into `SPIKE-RESULT.md` as Day-1/2/3 evidence sections. Add prose around it (env, devices used, plugin commit hash, your interpretation) and the recommendation.

---

## After the spike

Regardless of outcome:

1. Write `docs/passkey-investigation/SPIKE-RESULT.md` with the findings.
2. **Do not merge this spike branch.** Open a `docs(passkey): Phase C.0 spike result` PR against main containing only `SPIKE-RESULT.md`. Phase C will write the real implementation from a clean starting point informed by — but not built on — this throwaway code.
3. Delete the spike branch after the result PR merges.

The `capacitor.config.ts` plugin block, the `@capgo/capacitor-passkey` dependency, the iOS entitlements file, and the Android `asset_statements` metadata generated during the spike are valid Phase C inputs but should be re-introduced through Phase C planning rather than carried over wholesale from this branch.

---

## Cap-go plugin gotchas worth knowing in advance

These are things the README on `Cap-go/capacitor-passkey` calls out that may bite during the spike:

- **Conditional mediation returns `false`** on Capacitor — autofill-style passkey UX is unsupported. We don't use it; not a blocker.
- **Android `clientDataJSON.origin`** is the app's `android:apk-key-hash:...`, not `https://zap.cooking`. If we ever verify origin server-side (we don't, in this spike), we'd need to allow both.
- **iOS 17.4+** uses the browser-style client-data API — the configured HTTPS origin is reflected in `clientDataJSON.origin`. Good for us.
- **Plugin auto-shim must be called once at startup.** The harness calls `CapacitorPasskey.autoShimWebAuthn()` in the page's `onMount`. If you see "Plugin loaded: ❌ no" in the env panel, the import or shim install failed — check the bootstrap error.

---

## When in doubt

- Capture the failing step's raw JSON.
- Don't try to "make it work" past an abort signal.
- Three days max. End of Day 3 = decision time.
