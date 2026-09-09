# Open Kitchen variety and SavedService v2

Implementation scope approved after the replayability investigation: randomize only new Open Kitchen rosters, capture ordered guest IDs in **both** service modes, freeze v1 interpretation, and stop before opening the PR. Daily variety, streaks, timing UI, scoring variation and progression are separate work.

## Generation and restoration

New Open Kitchen services sample three distinct guests without replacement from the existing five. Every ordered roster is possible (5 × 4 × 3 = 60). Each service draws independently, so consecutive services can repeat; the UI does not promise otherwise. The shared customer array is not shuffled or mutated.

Daily uses the existing UTC-date algorithm in this change. Its ordered IDs are nevertheless saved in v2, so later Daily variety will not require another format change just to reconstruct the guests served.

All newly completed services produce this encrypted application payload:

```json
{
  "version": 2,
  "id": "a-per-service-UUID",
  "completedAt": "2026-09-06T12:00:00.000Z",
  "mode": "service",
  "date": "2026-09-06",
  "roster": ["robin", "alex", "maya"],
  "dishes": ["three validated dish objects in the same order"]
}
```

The example abbreviates the unchanged dish objects. `roster` must contain exactly three unique, known, case-sensitive guest IDs. Missing/duplicate/unknown IDs reject the record before scoring. Restoration builds the service from those IDs; it never calls the live `startService()`, draws randomness, or derives the roster again from the date. The writer checks that the completed reviews correspond to the service's roster and saves a detached copy of the IDs and dishes.

## Frozen v1 interpretation

`legacy/serviceV1.ts` and `legacy/historyV1.ts` are snapshots from main `b78d77fa`. Only provenance comments and the snapshot's relative import path differ from their originals. v1 records go directly through the frozen parser and restoration path. Extra roster fields on a v1 record are ignored by that parser; they cannot opt the record into newer behavior.

v2 adds roster capture and shares the frozen v1 dish validation, evaluator and customer definitions. This keeps both supported formats stable if live game generation or definitions change later. A future change to scoring or guest definitions must introduce an explicit compatible record/rules version; changing generation alone is safe because v2 stores the actual IDs.

The public `evaluate()` function, score weights, existing customer definitions, `serve()`, `nextCustomer()` and `RecordBook.version` remain unchanged.

## Old-client policy: choice (a), explicit omission until upgrade

An old client rejects `version: 2` in `parseRun()`. Its `mergeHistory()` drops that record. Therefore **v2 services are absent from that client's merged/device history, service count, best score, lessons and Daily scores**. This is accepted graceful degradation until it upgrades, not tolerant raw pass-through and not merely a display error. Unknown future versions are likewise skipped by this client rather than guessed or scored.

The frozen old-client code is exercised directly in the tests: loading a mixed v1/v2 relay result preserves only v1; a v2-only result yields an empty RecordBook. Upgrading and restoring the same relay records recovers v2 with its original roster and results.

Omission does not delete remote history: Nostr uses a separate immutable run ID/address for each service, and the old client has no delete/replace-all operation. Its unknown records never enter the queue to be republished. A relay query still has the existing latest-100-event bound, so an old client can see fewer compatible remote services as newer v2 events fill that window. This limitation is part of the accepted downgrade behavior.

## Local cache isolation

New clients write `cheffys-table:history:v2:<owner>`. They also read and merge the existing `cheffys-table:history:v1:<owner>` cache, without changing it. Both include a separate `guest` scope.

- Import does not rewrite a v1 payload to v2 or assign old guest results to a signed-in identity.
- Supported records are normalized, deduplicated by immutable run ID, and bounded to the newest 100. An acknowledged copy retains its acknowledged status.
- Every identity load re-reads the legacy cache, so a service completed in an older tab can still appear after upgrading.
- An old client can rewrite/drop entries in its v1 cache, but cannot overwrite the v2 cache it does not know about. An upgraded client finds its locally saved v2 runs even if they were never successfully uploaded.
- A malformed or inaccessible cache does not prevent reading the other cache. A failed local write retains the existing honest save-failure behavior.

Browser caches remain plaintext. Cache versioning provides compatibility isolation, not protection from another person with access to the browser profile. Clearing browser data can remove unsynced runs as before.

## Nostr contract

The `cheffys-table-v1` app namespace stays unchanged; its suffix is not the encrypted payload version. Kind 30078, the `d=cheffys-table-v1:<run ID>` address, app/client/encryption tags, identity validation, encryption selection, relay discovery and acknowledgment rules are unchanged. Both v1 and v2 can be restored from this namespace. Only the decoded supported payloads reach history merging/scoring.

A run is still saved locally before upload. Only a successful relay acknowledgment marks it synced. Denial/offline/partial failure keeps remaining work pending. Generation guards ignore late callbacks after account changes, and retries retain the same run ID and roster.

## Verification

Coverage includes all 60 ordered rosters in both v2 modes; 365 dates compared with the old Daily algorithm; complete v1 service and Daily fixtures generated with unmodified main; no restoration-time randomness or dependence on mutable live customer definitions; malformed IDs/dishes/versions; old-client omission and recovery after upgrade; isolated caches and late legacy imports; immutable-ID deduplication; mixed-version partial acknowledgments; account switches during publish/decrypt; and the existing encryption/identity/queue regressions.

Browser QA uses guest-independent Cook/Serve selectors. It verifies saved v2 rosters for both modes, matches played guest names to the Service Book, and checks reload fidelity. Synthetic identities have no signer; no real relay publication is performed by QA.

Final check results and reproduction commands are recorded in the [implementation review](roster-history-v2-validation.md).
