# Task 8 — Mobile Platform Setup

**Status:** Complete. Concrete file contents and locations for Option B (own RP `zap.cooking`).

**Pre-existing facts** (from `capacitor.config.ts`, `android/app/build.gradle`, `android/variables.gradle`):
- iOS bundle ID / Android applicationId / Android namespace: `cooking.zap.app`
- Apple Team ID: `Z26TJQZZWC` (used in samples below).
- Android compileSdk: 36, minSdk: 24, targetSdk: 36, JDK 17
- AndroidX WebKit: 1.14.0 (already past the 1.12.0 floor needed for in-WebView WebAuthn — though we're using a native plugin path anyway, this is good headroom)

---

## 1. Files served from zap.cooking (Cloudflare Pages)

All three live under `static/.well-known/` so Cloudflare Pages serves them at `/.well-known/<name>` with no rewrites needed.

### 1.1 `static/.well-known/webauthn` (Related Origins)

Required only if we ever want to authenticate against `zap.cooking` from *other* origins (e.g., `www.zap.cooking`, an `app.zap.cooking` subdomain, a marketing landing page). For v1 with one origin, this file is optional.

```json
{
  "origins": [
    "https://zap.cooking"
  ]
}
```

If we add subdomains/aliases later, append them here. Chrome enforces a 5-eTLD+1-label cap, so we have plenty of headroom on our own domain.

**Content-Type:** `application/json` (no file extension on the path).

**Cloudflare Pages note:** the file path `.well-known/webauthn` (no extension) needs `_headers` configuration to serve as JSON, since Pages defaults to `application/octet-stream` for unknown types. Add to `static/_headers`:

```
/.well-known/webauthn
  Content-Type: application/json
```

### 1.2 `static/.well-known/apple-app-site-association`

```json
{
  "applinks": {
    "details": []
  },
  "webcredentials": {
    "apps": [
      "Z26TJQZZWC.cooking.zap.app"
    ]
  }
}
```

The `applinks` section is empty for passkey purposes; we'd populate it if we wanted Universal Links to open URLs in the app, which is unrelated to this work. **`webcredentials.apps`** is the part that matters: it tells iOS that the bundle ID `Z26TJQZZWC.cooking.zap.app` is allowed to share passkeys with `zap.cooking`.

If we ship a separate dev/staging bundle ID (e.g., `cooking.zap.app.dev`), add it to the array.

**Content-Type:** `application/json`. Add to `static/_headers`:

```
/.well-known/apple-app-site-association
  Content-Type: application/json
```

### 1.3 `static/.well-known/assetlinks.json`

```json
[
  {
    "relation": [
      "delegate_permission/common.handle_all_urls",
      "delegate_permission/common.get_login_creds"
    ],
    "target": {
      "namespace": "android_app",
      "package_name": "cooking.zap.app",
      "sha256_cert_fingerprints": [
        "<PROD_RELEASE_SIGNING_CERT_SHA256>"
      ]
    }
  },
  {
    "relation": [
      "delegate_permission/common.handle_all_urls",
      "delegate_permission/common.get_login_creds"
    ],
    "target": {
      "namespace": "android_app",
      "package_name": "cooking.zap.app",
      "sha256_cert_fingerprints": [
        "<DEBUG_SIGNING_CERT_SHA256>"
      ]
    }
  }
]
```

The SHA-256 cert fingerprints come from `keytool -list -v -keystore <path>` for both the release keystore (production) and the debug keystore (local dev). Both are needed if we test on dev builds. **`delegate_permission/common.get_login_creds`** is the line that matters for passkey sharing.

**Content-Type:** `application/json` (already correct; this one has the `.json` extension so Pages auto-detects).

**Verification after deployment:**
- iOS: Apple's CDN re-fetches AASA. Verify with `https://app-site-association.cdn-apple.com/a/v1/zap.cooking`.
- Android: `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://zap.cooking&relation=delegate_permission/common.get_login_creds` will return the parsed file.

---

## 2. iOS app changes

### 2.1 Add Associated Domains entitlement

Create `ios/App/App/App.entitlements`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTD/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.developer.associated-domains</key>
  <array>
    <string>webcredentials:zap.cooking</string>
  </array>
</dict>
</plist>
```

**Wire it into Xcode:** in `ios/App/App.xcodeproj`, set the target's **"Code Signing Entitlements"** build setting to `App/App.entitlements` for both Debug and Release. Then in the project's **Signing & Capabilities** tab, the "Associated Domains" capability shows up automatically once the entitlement file is referenced.

### 2.2 Apple Developer portal config

In the Identifiers section of the Apple Developer portal, the App ID for `cooking.zap.app` must have the **Associated Domains** capability checked. (One-time provisioning step.)

### 2.3 Capacitor config (no change required)

`capacitor.config.ts` doesn't need modification — Associated Domains is an Xcode-level entitlement, not a Capacitor plugin config.

### 2.4 Native plugin (per Task 3 / Task 5)

The chosen plugin (likely a fork of `Cap-go/capacitor-passkey`) installs into `ios/App/Pods/` via CocoaPods (`npx cap sync ios`). It requires no additional Xcode configuration beyond the entitlement above and the iOS 18 deployment target check (see §2.5).

### 2.5 Deployment target

Current Capacitor 8 default is iOS 14. PRF requires iOS 18+. Either:
- **Bump deployment target to iOS 18.** Drops support for any user on iOS 17 or earlier. Per Apple analytics, iOS 18 adoption was over 80% within 4 months of release; by zap.cooking's Phase C ship date this should be acceptable.
- **Keep deployment target at 14, runtime-check for iOS 18.** Users on older OSes don't see the passkey button; they fall back to NIP-07/NIP-46/nsec import.

**Recommendation:** runtime check, keep wider OS support. Show passkey only when `if #available(iOS 18, *)`.

---

## 3. Android app changes

### 3.1 Verify SHA-256 cert fingerprint

Production:
```bash
keytool -list -v -keystore <path-to-release-keystore.jks> -alias <alias>
```

Look for `SHA256:` in output. Strip colons, paste into `assetlinks.json`. Repeat for debug keystore (typically `~/.android/debug.keystore`, alias `androiddebugkey`, password `android`).

### 3.2 Update `build.gradle` dependencies

Add to `android/app/build.gradle` `dependencies` block (assuming we go with Cap-go/capacitor-passkey or a similar plugin):

```gradle
implementation "androidx.credentials:credentials:1.6.0-beta02"
implementation "androidx.credentials:credentials-play-services-auth:1.6.0-beta02"
// androidx.webkit:1.14.0 is already declared in variables.gradle
```

(The chosen plugin will likely add these via its own `build.gradle`. If we fork/build our own, we add directly here.)

### 3.3 Manifest

No changes required to `AndroidManifest.xml` for passkeys — Credential Manager is invoked via the SDK, not via manifest declarations. Existing `android.permission.INTERNET` is sufficient.

If we ever want to support deep-linked sign-in (i.e., a user in a browser is redirected into the app to complete a passkey ceremony), we'd add intent filters. Not needed for v1.

### 3.4 Min/target SDK

- `minSdkVersion = 24` (Android 7) — ❌ insufficient for passkeys (which need API 28 = Android 9). Bump to 28 *or* runtime-check API level before showing passkey UI. Recommend runtime check; bumping minSdk excludes legitimate users.
- `targetSdkVersion = 36` — ✅ fine.
- `compileSdkVersion = 36` — ✅ fine.

### 3.5 Capacitor sync

After plugin install:
```
pnpm cap sync android
```

This regenerates the gradle dependency graph and copies plugin assets.

---

## 4. WebView vs. native API decision (final)

Per Task 3 §4: we use a native plugin on both platforms. The Capacitor WebView never sees a `navigator.credentials` call for passkey ops — the plugin intercepts at the JS layer (or we route around it explicitly in our auth code) and routes to `ASAuthorizationController` (iOS) / `CredentialManager` (Android). The PRF result is plumbed back as plain bytes to the WebView's JS context and consumed by our derivation pipeline (Task 5 §3).

This decision is **independent** of whether iOS WKWebView or Android WebView would *eventually* support PRF directly. We don't need to revisit it unless Apple grants the web-browser entitlement to non-browsers (unlikely) or Google formally documents PRF passthrough through `WebSettingsCompat` and we test it works (possible, but our plugin path doesn't lose anything by being there).

---

## 5. Verification checklist (post-Phase C deployment)

| Check | How |
|---|---|
| AASA reachable | `curl https://app-site-association.cdn-apple.com/a/v1/zap.cooking` returns the JSON |
| AssetLinks reachable | `curl 'https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://zap.cooking&relation=delegate_permission/common.get_login_creds'` returns our app |
| Webauthn well-known reachable | `curl https://zap.cooking/.well-known/webauthn` returns JSON with `"origins": [...]` and `Content-Type: application/json` |
| iOS app gets passkey prompt | Real iOS 18.4+ device; tap "Sign in with passkey"; biometric prompt fires |
| iOS PRF result returns | Plugin logs show `clientExtensionResults.prf.results.first` length = 32 bytes |
| Android app gets passkey prompt | Real Android device with Google Password Manager; biometric prompt fires |
| Android PRF result returns | Plugin logs show same |
| Web-derived nsec === iOS-derived nsec === Android-derived nsec for same passkey | Cross-device test with synced iCloud Keychain (web Safari + iOS) and Google PM (web Chrome + Android). Same passkey credential → same PRF → same nsec. |

---

## 6. Rollout order (Phase C suggestion)

1. Deploy the three well-known files first. They're inert — no code path uses them until passkey ops happen.
2. Verify with the curl commands above.
3. Build/deploy the SvelteKit web changes (auth routes, derivation pipeline, UI). Web users can register/login on `zap.cooking` browser immediately.
4. Add the iOS entitlement, plugin, and runtime PRF check. Ship as a new App Store version. Users on iOS 18+ get passkey login; older iOS users fall back to existing methods.
5. Add the Android plugin and runtime API-28+ check. Ship as a new Play Store version. Same fallback story.
6. Monitor: passkey signup conversion vs. existing methods, PRF unavailable rates by platform, credential count distribution per user.

---

## 7. Open questions

| # | Question | Resolution |
|---|---|---|
| Q1 | Do we need a separate dev/staging Android keystore SHA in assetlinks for QA testing? | Yes — include both prod and debug fingerprints. |
| Q2 | Apple Team ID | `Z26TJQZZWC` (filled in) |
| Q3 | Should we serve the well-known files from CF Workers or static? | Static is simpler; Pages serves directly. Workers only if we ever need to vary by request (we don't). |
| Q4 | Capacitor 8.x compatibility with the chosen plugin? | The Cap-go plugin targets Capacitor 5+; Capacitor 8 is compatible per the plugin's `peerDependencies`. Verify in spike. |
| Q5 | Should we do a TestFlight/internal-track rollout before public release? | Yes — passkey behavior on real devices is the riskiest part. Recommend at least 1 week TestFlight + Play internal track before promoting. |
