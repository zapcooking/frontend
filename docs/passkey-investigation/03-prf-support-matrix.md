# Task 3 — PRF Support Landscape

**Status:** Complete. Carries the major Capacitor finding into Task 5.

**TL;DR:** PRF is broadly supported in modern desktop browsers, iOS 18+, Android Chrome, Apple/Google/1Password/Dashlane password managers. **The blocking unknown for Capacitor was real and the answer is unfavorable**: iOS WKWebView restricts the WebAuthn JS API to apps holding the "web browser entitlement" (Capacitor apps don't qualify), and while Android WebView gained WebAuthn support in AndroidX WebKit 1.12.0+, PRF extension support specifically inside that pathway is undocumented and untested. **Phase C will need a Capacitor native plugin that bridges to `ASAuthorizationPublicKeyCredentialPRFRegistrationInput/AssertionInput` on iOS and Credential Manager on Android.** No off-the-shelf Capacitor plugin currently advertises PRF.

---

## 1. Browser support (web context, not WebView)

Snapshot as of May 2026, per [Yubico PRF support matrix](https://developers.yubico.com/Developer_Program/WebAuthn_Starter_Kit/Browser_Support_Matrix.html), [chromestatus 5138422207348736](https://chromestatus.com/feature/5138422207348736), [Corbado PRF tracker](https://www.corbado.com/blog/passkeys-prf-webauthn), and Apple developer docs.

| Browser | Platform | PRF supported? | Min version | Notes |
|---|---|---|---|---|
| Chrome | macOS | ✅ | 132 | Via iCloud Keychain (platform authenticator) and 1Password browser-extension passkeys |
| Chrome | Windows | ✅ create | 147 | PRF-on-create needs `WEBAUTHN_API_VERSION_8`; assertion supported earlier. Windows Hello support evolving. |
| Chrome | Linux | ✅ | recent | Via 1Password / phone-based passkeys |
| Chrome | Android | ✅ | recent | Via Google Password Manager — most mature mobile PRF surface |
| Chrome | ChromeOS | ✅ | recent | |
| Edge | all | ✅ | tracks Chromium | |
| Safari | macOS 15 | ✅ | 18 | Via iCloud Keychain only — **no external security keys (YubiKey) PRF on Safari** |
| Safari | iOS 18 | ✅ | 18 | Via iCloud Keychain only. Early iOS 18 had a data-loss bug across cross-device auth; fixed in iOS 18.4. |
| Safari | iPadOS 18 | ✅ | 18 | Same as iOS; iPadOS 26.4 still has a security-key PRF bug |
| Firefox | macOS | ✅ | 139 | Via iCloud Keychain |
| Firefox | Windows | ✅ | 148 (assertion fully) | Creation backported to 147. |
| Firefox | Linux | ✅ | recent | |
| Firefox | Android | ❌ | n/a | Firefox for Android has no Credential Manager bridge for PRF |
| Samsung Internet | Android | ✅ | recent | Via Google Password Manager |

**For zap.cooking's web origin (`zap.cooking` over Cloudflare Pages):** assume PRF works in any modern browser-and-passkey-provider combo a real user would have. The relevant exclusions are old browsers, Firefox/Android, and external security keys on Safari.

---

## 2. Platform OS native PRF APIs

These are the APIs a Capacitor native plugin would call (because we cannot use the WebView's `navigator.credentials` directly — see §4).

| Platform | API | Min OS | Notes |
|---|---|---|---|
| iOS | `ASAuthorizationPublicKeyCredentialPRFRegistrationInput` / `Output` | iOS 18.0 | Inputs are 32-byte salts. Same eval.first/eval.second model as web PRF. |
| iOS | `ASAuthorizationPublicKeyCredentialPRFAssertionInput` / `Output` | iOS 18.0 | Used in get-assertion (login). |
| iOS | Static `checkForSupport()` | iOS 18.0 | Lets the app detect at runtime whether the platform authenticator can satisfy PRF. |
| macOS | Same as iOS | macOS 15.0 | |
| Android | Credential Manager API + `androidx.credentials` | Android 9 (API 28) for passkeys; Credential Manager API 1.6.0+ | PRF extension support is **not officially advertised** as a top-level feature in Android Credential Manager docs as of May 2026. Some apps wire it through manually via the publicKeyCredential request JSON. Provider-dependent. |
| Android | `androidx.webkit` `WebSettingsCompat.setWebAuthenticationSupport()` | WebKit 1.12.0 | Enables the WebView to expose `navigator.credentials` to JS — but PRF passthrough behavior is undocumented. |

Sources for §2: [Apple Developer: ASAuthorizationPublicKeyCredentialPRFRegistrationInput](https://developer.apple.com/documentation/authenticationservices/asauthorizationpublickeycredentialprfregistrationinput-swift.struct), [Android Developers: Credential Manager + WebView](https://developer.android.com/identity/sign-in/credential-manager-webview).

---

## 3. Password manager / credential provider support

This determines whether a user's chosen credential store can hold a passkey that satisfies PRF requests for our RP.

| Provider | PRF (registration) | PRF (assertion) | Source |
|---|---|---|---|
| Apple iCloud Keychain | ✅ iOS 18+/macOS 15+ | ✅ | Apple docs; live in Safari/Chrome on Apple platforms |
| Google Password Manager | ✅ | ✅ | Most mature mobile PRF target |
| 1Password (browser ext + native) | ✅ | ✅ | [1Password docs] (and confirmed by Breez SDK note) |
| Dashlane | ✅ (via YubiKey on browser ext today) | ✅ | Dashlane uses PRF themselves for vault decryption; mobile PRF still rolling out |
| Bitwarden | ❌ | ❌ | Confirmed by [Bitwarden's PRF blog post](https://bitwarden.com/blog/prf-webauthn-and-its-role-in-passkeys/) and Breez SDK note |
| KeePassXC | ❌ | ❌ | Per Breez SDK note |
| Microsoft Authenticator (cross-device) | partial | partial | Improving; treat as unreliable for now |
| YubiKey (FIDO2 security key) | ✅ on Chrome/Edge/Firefox | ✅ on Chrome/Edge/Firefox | **Not on Safari** (iOS or macOS) |
| Phone-as-authenticator (caBLE/cross-device) | partial | partial | Provider-dependent at the other end |

**Practical implication for zap.cooking:** if a user's passkey lives in Bitwarden, KeePass, or another non-PRF provider, our login won't work for them. We need to communicate clearly at signup that the user must store the passkey somewhere that supports PRF. The system prompts on iOS/Android/macOS naturally route to platform managers (Apple Keychain / Google PM) which all support PRF, so the failure mode is mostly the "I use Bitwarden by choice" power user.

---

## 4. The Capacitor question — answered

The prompt called this "the known unknown that determines whether a native plugin is needed." It is. The answer is **yes, a native plugin is needed.**

### iOS WKWebView

- WebKit's WebAuthn implementation in WKWebView is restricted to apps with the **"Web Browser entitlement"** (`com.apple.developer.web-browser`), an Apple-controlled entitlement granted only to alternative browsers under EU DMA rules. Capacitor apps don't have it and won't get it.
- Practical observation reported by multiple developers: calling `navigator.credentials.create()` or `.get()` for `publicKey` inside Capacitor's WKWebView throws `NotAllowedError` immediately ([Web3Auth community thread on Capacitor passkey issues](https://web3auth.io/community/t/passkey-support-in-capacitor-hybrid-apps-android-ios-request-for-guidance-and-permission-to-fork/10983)).
- **Conclusion:** iOS Capacitor must call native `ASAuthorizationController` APIs through a plugin. The plugin then exposes the PRF result back to the WebView's JS context.

### Android WebView

- AndroidX WebKit 1.12.0+ introduced `WebSettingsCompat.setWebAuthenticationSupport()`, which lets a WebView's `navigator.credentials` route to Credential Manager. So WebAuthn-in-WebView is no longer impossible on Android.
- **PRF support through this pathway is undocumented.** The WebKit docs list standard passkey ops; no mention of PRF. Likely it does pass extensions through (since WebKit usually proxies the JSON), but this is unverified. We should not bet on it without testing.
- Even if it works, the `mediation:"conditional"` flow is explicitly unsupported in the WebKit pathway, which means autofill-style passkey UX won't work from inside the WebView.
- **Conclusion:** safest path is the same as iOS — call Credential Manager natively from a plugin and pipe the PRF result back to the WebView. Avoids the WebKit-version dependency and the unknown about PRF passthrough.

### Existing Capacitor plugins surveyed

| Plugin | Last meaningful update | PRF advertised? | Notes |
|---|---|---|---|
| [`Cap-go/capacitor-passkey`](https://github.com/Cap-go/capacitor-passkey) | 2025 | ❌ (generic extension passthrough mentioned, untested for PRF) | "Patches `navigator.credentials.create/get`" — closest in spirit to what we want |
| [`Argo-Navis-Dev/capacitor-passkey-plugin`](https://github.com/Argo-Navis-Dev/capacitor-passkey-plugin) | 2025 | ❌ | Cross-platform, no PRF mention |
| [`@darkedges/capacitor-native-webauthn`](https://www.npmjs.com/package/@darkedges/capacitor-native-webauthn) | small | ❌ | Generic native bridge |
| [`@joyid/capacitor-native-passkey`](https://www.npmjs.com/package/@joyid/capacitor-native-passkey) | proprietary fit | ❌ | Tied to JoyID's flow |

**No off-the-shelf Capacitor plugin advertises PRF support in May 2026.** Plan to either:
1. Fork `Cap-go/capacitor-passkey` and add PRF input/output plumbing through the iOS/Android native layer, or
2. Build a thin in-house plugin specifically for our PRF use case.

The fork-Cap-go path is faster if their generic extension JSON passthrough actually round-trips PRF correctly. Worth a one-day spike in Phase C to confirm before committing.

---

## 5. Cross-cutting risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| User's passkey provider doesn't support PRF (Bitwarden, KeePass) | Medium for power users, low overall | Login broken for that user | Detect at registration via `getClientExtensionResults().prf?.enabled` and fail gracefully with explanation |
| User on Android with Firefox | Low | Login broken | Recommend Chrome/Edge in error message |
| User on iOS Safari with YubiKey (no platform PRF) | Very low for our user base | Login broken | Recommend platform passkey, or fall back to NIP-07/NIP-46/nsec import |
| iOS WKWebView entitlement landscape changes | Low, but interesting | Could simplify our plugin | Keep an eye on Apple developer release notes; not a Phase B blocker |
| Android WebView PRF passthrough silently broken | Medium | Plugin would have to backstop | Native plugin path bypasses this — recommended regardless |
| iOS 18.0–18.3 cross-device PRF data-loss bug | Already shipped | Could affect early adopters | Communicate iOS 18.4+ as recommended floor |
| Future spec change to PRF salt prefix | Very low | Would invalidate existing keys | Pin to current behavior; design for non-rotation |

---

## 6. Implications for downstream tasks

- **Task 5 (implementation path)** must include a native Capacitor plugin (fork or new) with PRF passthrough on both iOS and Android. The web/SvelteKit implementation can use SimpleWebAuthn directly because real browsers support PRF natively.
- **Task 6 (backend)** is unaffected — the server doesn't care which client surface produced the credential, only that the assertion verifies.
- **Task 7 (coexistence)** should explicitly call out the "your passkey provider must support PRF" caveat in the user-facing copy at signup.
- **Task 8 (mobile config)** must include both Apple Associated Domains for `webcredentials:zap.cooking` and Android Digital Asset Links pointing at our domain (already in Task 2 plan), plus the plugin's native dependencies (`androidx.credentials`, `androidx.credentials:credentials-play-services-auth`).
- **Task 9 (security review)** should note the `NotAllowedError` failure surface — at minimum it gives an attacker an oracle for "user is on iOS Capacitor without our plugin loaded," which is informational but mostly harmless.

---

## 7. Open questions

| # | Question | Where to answer |
|---|---|---|
| Q1 | Does Cap-go/capacitor-passkey's "extensions passthrough" actually round-trip PRF correctly on iOS and Android? | Phase C spike, ~1 day |
| Q2 | What % of our active mobile users are on iOS 18.0–18.3 vs. 18.4+? Affects how loudly we communicate the OS-version floor. | members.zap.cooking analytics |
| Q3 | Is there meaningful demand for in-WKWebView PRF (i.e., should we lobby Apple to expand the entitlement)? | Out of scope; long-term |
| Q4 | Does Google Password Manager surface PRF capability flags through Credential Manager, or do we infer from the assertion result? | Phase C spike alongside Q1 |
