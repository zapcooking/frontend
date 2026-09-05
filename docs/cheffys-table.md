# Cheffy’s Table

Direct route: `/cheffys-table`. No navigation entry is added. This is the native Svelte version of the Cheffy’s Table prototype, using a dedicated kitchen shell within Zap, the shared Cheffy avatar, recipe discovery and chat draft integration. The shell keeps authentication mounted and restores normal Zap navigation when leaving.

Players build three dishes from 20 illustrated ingredients, choose cooking method, kitchen time, serving style and garnish, then learn from each guest’s review. Complexity earns a bonus only when the dish succeeds. Daily services use a UTC date to choose the same guests. The pantry artwork is an original generated illustration, bundled locally without third-party image requests. Game cooking minutes are a simulation with prepared proteins and bases, not food-safety instructions.

## Identity and persistence

- Guest and each Nostr public key have separate local-storage histories. Existing prototype history is not silently claimed by an account.
- All three guest reviews must be completed before a service is saved. A login, logout or account change starts a fresh service and loads that account’s local history. It also cancels delayed plating and ignores outstanding results for the previous identity.
- Signed-in completion first saves locally, then attempts relay backup using Zap’s existing signer, encryption service and NIP-65 outbox relay discovery. Missing signer, denied requests, offline operation and unacknowledged publishes leave the run pending. Use **Sync now** in the **Service Book** to retry and restore another device’s records; this can prompt the signer to decrypt each service. Guest history is device-only.
- Kind `30078`, `d=cheffys-table-v1:<run UUID>`, `t=cheffys-table-v1`, encryption method and Zap client tags. Each run has its own replaceable address, so retries do not add duplicate services and separate devices do not overwrite one shared history document. The payload is encrypted to the signed-in identity with NIP-44 preferred and the existing NIP-04 fallback supported.
- Scores, dish choices and feedback are not public feed posts. Nostr authorship, timestamps and app tags remain visible to relays. Local browser backup is plaintext, scoped by identity; it is not protection from someone with access to the browser profile.
- The latest 100 saved services are retained/displayed locally and requested during restore. Summary scores and lessons are calculated from that window. Remote records are not deleted when the local window rolls forward.
- Version 1 payloads store ID, completion timestamp, mode, UTC service date and three validated dish choices. Reviews/scores are recomputed using the matching cooking rules; keep those rules stable for this payload version or introduce an explicit migration/versioned evaluator. These are personal client-generated game scores, not cheat-resistant leaderboard results.

## Experience architecture

The route orchestrates a presentation reducer and the Service Book lifecycle. Station, pantry, live pass, guest reactions, finale and native sheets live in component-scoped Svelte files. The small shared stylesheet owns kitchen tokens, primitives and responsive layout. The scoring model and history/relay adapters remain independent.

See the [experience audit](cheffys-table/experience-audit.md) and [redesign validation report](cheffys-table/validation.md) for the design decisions, reproducible browser checks and rollout limits.

## Verification

`pnpm test -- src/lib/cheffys-table` covers gameplay, input validation, score recalculation, deduplication, bounded history, identity separation, partial failures, account changes during asynchronous work, encryption denial, Nostr event structure, relay acknowledgements and restore filtering.

Also run `pnpm check` and `SKIP_ENV_VALIDATION=1 pnpm build` (the latter bypasses missing local deployment secrets only).

Before production rollout, exercise a real supported signer: play as guest, sign in and complete a service, approve encryption/signing, restore on a second browser, deny a signer request then retry, and switch accounts during plating or sync. Automated tests use mocked signer/relay transports and do not publish from a real identity.
