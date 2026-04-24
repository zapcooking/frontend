# NIP-46 Signer Compatibility Matrix

Living document. Each time a contributor pairs zapcooking with a NIP-46 signer, record the result here so we can point users to a known-good list and catch regressions early.

Tracked by issue [#334](https://github.com/zapcooking/frontend/issues/334).

## Why this exists

NIP-46 JSON-RPC messages between app and signer are encrypted. Older signers use NIP-04; newer signers (notably Primal's mobile signer) use NIP-44 and may reject NIP-04. Zapcooking relies on `NDKNip46Signer` from `@nostr-dev-kit/ndk` to handle this. Without a documented test matrix, silent pairing or signing failures against specific signers can ship unnoticed.

## How to record a result

For each pairing attempt, copy the template below, fill in the fields, and add it to the relevant signer section. Keep entries in reverse chronological order (newest first).

```
- **Date:** YYYY-MM-DD
- **Tester:** handle or npub
- **App build:** commit sha or branch
- **Signer app version:** e.g. Amber 3.2.1
- **Platform:** iOS 18.x / Android 14 / Desktop Chrome 129 / …
- **Pairing URI:** bunker:// / nostrconnect:// / QR scan
- **Results:**
  - [ ] Initial pairing completes within 60 s on local wifi
  - [ ] `get_public_key` returns the user's actual npub (not the signer's own pubkey)
  - [ ] `sign_event` on a kind-1 note succeeds; signed event publishes to a relay
  - [ ] NIP-44 encrypt / decrypt round-trip against a test peer (if applicable)
  - [ ] Reconnect after app restart restores session from localStorage without re-pairing
  - [ ] Logout and re-pair with the same signer succeeds, no stale state
- **Notes:** any surprises, error messages, or workarounds
```

---

## Amber (Android)

_No test results recorded yet._

## Primal (iOS)

_No test results recorded yet._

## Primal (Android)

_No test results recorded yet._

## Other signers

_No test results recorded yet._

---

## Known issues under investigation

_None recorded yet._

## Related

- [#331](https://github.com/zapcooking/frontend/pull/331) — bunker login UX and NIP-46 handshake fixes
- [#333](https://github.com/zapcooking/frontend/issues/333) — extend handshake timeout for real-world flows
- [#335](https://github.com/zapcooking/frontend/issues/335) — login box UX redesign
