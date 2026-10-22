# PR #753 review response & Lazarus spec recommendations — handoff

**Date:** 2026-09-25
**PR:** [zapcooking/frontend#753](https://github.com/zapcooking/frontend/pull/753) — Lazarus data recovery replaces NIP-78 account backup (branch `feat/lazarus-data-recovery`, HEAD `e8b263c2`)
**Review:** Copilot review with 7 findings (3 high, 4 medium). All 7 verified as legitimate, fixed, tested, and replied to on the PR threads.
**Spec:** [dmnyc/lazarus](https://github.com/dmnyc/lazarus), SPEC.md at **0.5.0-draft**. Reference implementation: [dmnyc/jumble-spark](https://github.com/dmnyc/jumble-spark), branch `feat/lazarus-data-recovery`.

---

## 1. Current state — READ FIRST

- **All fixes are in the working tree, uncommitted.** Per AGENTS.md, the user commits/pushes manually.
- **Commit exactly these 8 files** (7 changed + this doc):
  - `src/lib/lazarus/source.ts`
  - `src/lib/lazarus/lazarusPublish.ts`
  - `src/lib/lazarus/recovery.ts`
  - `src/lib/lazarus/source.test.ts`
  - `src/lib/lazarus/recovery.test.ts`
  - `src/components/LazarusRecoverySection.svelte`
  - `src/components/LazarusDeltaPanel.svelte`
  - `docs/lazarus/pr753-review-handoff.md` (this file, if wanted in the repo)
- **Do NOT sweep in** the unrelated pre-existing local changes: `src/routes/+layout.svelte`, `vite.config.ts`, `src/lib/devConsoleMirror.ts` (untracked), `.zcode/`, `AGENTS.md`, `gui-test-screenshots/`.
- **Verification status at handoff:** Lazarus suite 74/74 passing (66 original + 8 new); full suite 2155/2155; `svelte-check` at pre-existing baseline (the one remaining error is `src/routes/api/stripe/webhook/renewalRetry.test.ts:94`, untouched by this PR).
- **All 7 GitHub replies are posted** (comment ids `4109870235`–`4109872099`). Threads intentionally left **unresolved** so the reviewer can verify against the eventual push. Resolve them after pushing.
- Files were deliberately **not** prettier-reformatted: the Lazarus files are hand-formatted, CI lint is soft-fail (`continue-on-error: true`), and reformatting would pollute the review diff. Don't run `prettier --write` on them.

## 2. What was fixed, per finding

| # | Finding (severity) | Fix |
|---|---|---|
| 1+2 | Pre-sign re-read fails open: `fetchLatestLazarusVersion` returned `undefined` for both "no current event" and "all write relays unreachable", so a restore could sign against a stale event (high ×2) | `fetchLatestLazarusVersion` counts usable answers and **throws** when zero write relays answered (an empty-but-fulfilled read is a real answer). `publishLazarusRecovery` aborts before signing with new `LazarusPublishError('current-unreadable', …)`. Deliberate asymmetry (explained in the PR reply): partial answers proceed — one successful read establishes current. |
| 3 | Scan path trusted relay events; a filter-ignoring relay could inject a foreign event as a restore candidate (high) | `fetchVersions` filters every relay answer to `pubkey === scanned account && kind === requested kind` before candidates, responding-relay counts, or paging cursors. Foreign-only answer = no answer. `fetchLatestLazarusVersion` got the kind check too. (Signatures were already verified by SimplePool in transit.) |
| 4 | Delta panel always used the default empty `privateTags` map — encrypted private items never shown in review (medium) | Review-time decryption mirroring jumble-spark: on review open (and after a pre-sign "changed" event), `LazarusRecoverySection.ensureReviewDecrypted` decrypts chosen + current via `encryptionService.decrypt` (local key / NIP-07 nip04+nip44 / NIP-46 with denial circuit-breaker), parses with `parsePrivateTags`, feeds into `computeLazarusDelta`, re-ranks via `applyLazarusPrivateTags`. Restore buttons disabled while decrypting. NIP-46 oversize decrypts skipped via `fitsNip46Request`. When decryption is impossible: stays estimated + explicit warning (spec's flagged tier). |
| 5 | `publishedRelays` took every URL in `ndk.pool.relays` (incl. scan connections) (medium) | Now maps the `Set<NDKRelay>` that `event.publish()` resolved with — the write relays that actually took the event. |
| 6 | Profile delta compared a fixed field whitelist; extensible fields (`pronouns`, `bot`, client fields) could silently revert (medium) | `computeLazarusProfileChanges` compares the **union of keys** in both contents (well-known fields first in display order, then sorted extras); non-string values shown as JSON. |
| 7 | `SimplePool.close([])` closes nothing — pool sockets leaked per recovery-screen teardown (medium) | `closeLazarusScanPool` calls `destroy()` (closes all connections); pool recreated lazily. Confirmed against nostr-tools `AbstractSimplePool`. |

New tests: 3 in `recovery.test.ts` (profile extras, non-string values), 5 in `source.test.ts` (foreign-event drop ×2, pool destroy, fail-closed re-read, empty-answer-resolves-undefined).

**Not ported from jumble-spark (deliberate, noted in PR reply):** background row-by-row decryption of all listed versions, and the persistent decrypted-content cache (jumble's indexedDb). Review-time decryption closes the approval gap; row counts stay honest ranges.

## 3. Spec recommendations (dmnyc/lazarus)

Assessment: **4 of the 7 findings warrant spec amendments** (two as normative MUSTs); the other 3 are client implementation details. Quoted spec gaps verified against SPEC.md @ 0.5.0-draft on 2026-09-25.

### 3.1 Recover: the unreachable re-read (from findings 1+2) — highest priority

Spec mandates the re-read and defines the changed case, but is **silent on the unreachable case** — exactly where zap failed open. Add to *Recover*:

> If the current version cannot be established — no write relay produced a usable answer — the recovery MUST NOT proceed; the implementation reports an error the user may retry. A read that answered with zero events is a usable answer (nothing newer exists); a timed-out or failed read is not. A partial set of answers suffices: an edit from another client propagates to the user's write relays, so any successful read establishes the current version.

The last sentence codifies the partial-answer rule — otherwise each implementation invents it. The spec's own changelog says "silent drift between implementations is the failure mode."

### 3.2 Scan: client-side validation of relay answers (from finding 3)

Spec specifies filters and dedup-by-id but never requires validating returned events — it implicitly trusts relays to honor filters. A hostile relay can inject a foreign event that the user's explicit click then signs as their own content (defeats the spirit of "your keys your publish"). Add to *Scan*, before dedup:

> Relays are untrusted: a relay MAY return events that do not match the filter. Implementations MUST discard events whose pubkey is not the scanned account's or whose kind is not the requested kind — before they can become candidates, affect item counts, move a paging cursor, or count as an answering relay. A relay whose answer contains no matching events has not answered.

### 3.3 Kind registry: profile delta must cover all fields (from finding 6) — spec text CAUSED this bug

The delta rule is right ("the list of fields that would change") but the registry's example — "Show field-level diffs between candidates and current (name, picture, nip05, about)" — is what the vendored core implemented, whitelist and all. **jumble-spark carries the identical bug** (`computeLazarusProfileChanges` in its `src/services/lazarus/recovery.ts`). Amend the registry note:

> Show field-level diffs covering every field that would change. Profile content is extensible (pronouns, bot, client-specific fields) and a restore replaces the whole content, so a fixed whitelist can report "no changes" while reverting fields it never compared. Well-known fields may be ordered first for display; non-string values are shown as JSON.

### 3.4 Delta rule: close the flagged-tier loophole (from finding 4)

A client can ship estimated counts (conformant) while never feeding decrypted items into the review delta, satisfying the letter of "the delta MUST state that private items are uncounted" even when decryption was possible. Add one clarifying sentence to *The delta rule*:

> The uncounted disclosure is for private items that could not be decrypted — no key available, or a decrypt request beyond a remote signer's caps — not for items the implementation chose not to attempt. When a reviewed version's private items can be decrypted, the delta SHOULD include them.

Optionally extend the NIP-46 size-cap language from signing to **decrypt** requests (both jumble and zap apply `fitsNip46Request` on decrypt; currently convention, not spec).

### 3.5 Not spec-worthy

- Finding 5 (published-relay count in success message) — UI truthfulness; "Success is judged on the user's write relays" is already correct.
- Finding 7 (`close([])`) — nostr-tools API misuse, no protocol content.
- Note: findings 1–3's fixed code lives in zap's adapter (`source.ts`), not the vendored core — jumble's adapters need their own audit against the new rules.

### 3.6 Process notes for the spec PR

- Spec versions test vectors with itself; each amendment should land **with vectors** (e.g. relay serves foreign event → not a candidate; re-read unreachable → recovery refuses).
- Ranking rules change only with a version bump → this is a **0.6.0-draft** changelog entry, not a patch to 0.5.0.

## 4. Recommended sequence

1. **Commit + push** the 8 files above (resolves nothing yet).
2. **Resolve the 7 PR threads** after push, referencing the commit.
3. **Spec PR** against dmnyc/lazarus (§3 language + vectors + 0.6.0-draft changelog).
4. **Fix jumble-spark**: port the `computeLazarusProfileChanges` union-of-keys fix to its vendored core (same bug), and audit its adapters against §3.1/§3.2 (fail-closed re-read, event validation).
5. **zap re-vendor check**: once the spec lands, zap's hand-patched `recovery.ts` becomes the conformant version — re-vendor from jumble at that point rather than keeping a permanent local divergence (see the vendoring note in the file headers: "Re-vendor on spec 1.0 rather than hand-patch").

## 5. Open / optional follow-ups

- Browser-verify the review-time decryption flow in the running app (NIP-07 and local-key paths) — unit tests cover the pure core; the wiring was type-checked and suite-verified only.
- Background row decryption + persistent decrypted-content cache (jumble parity) — skipped deliberately, see §2.
- Consider adding `LazarusPublishError` code handling by code value (UI currently uses `.message` only) if error-specific UX is ever needed.
