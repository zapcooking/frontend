# Meal Plan Event Contract (v1)

**This document is the frozen cross-platform contract.** The Android client ports against it
verbatim — the `RecipeBookmarkRepository` ↔ `cookbookStore.ts` pairing is the model. Web
implementation: `src/lib/mealplan/` + `src/lib/services/plannerService.ts`. Changes require a new
`schemaVersion` and an update to this document in both repos.

## Event envelope

| Field | Value |
|---|---|
| kind | `30078` (NIP-78 application-specific data, addressable/replaceable per d-tag) |
| d-tag | `mealplan-{isoWeekYear}-W{ww}` — e.g. `mealplan-2026-W29` |
| tags | `['d', …]` and `['client', 'Zap Cooking']` — **nothing else** (see "No plaintext recipe tags") |
| content | NIP-44 self-encrypted JSON payload (encrypted to the author's own pubkey) |
| relays | The user's NIP-65 outbox write relays, falling back to the app's default pool. Never routed specially; no relay-side policy distinguishes `mealplan-` events (verified against members-relay filter policy). |

### d-tag definition

The week identifier is the **ISO 8601 week of the user's local wall-clock date**:

- Weeks start **Monday**.
- The year component is the **ISO week-numbering year** (`getISOWeekYear` semantics), NOT the
  calendar year. Example: 2026 is a 53-week ISO year — Jan 1–3 2027 belong to `2026-W53`, and
  Dec 29 2025 belongs to `2026-W01`.
- The week number is zero-padded to two digits (`W%02d`): `W01`–`W52`/`W53`.
- "Current week" is resolved from the device's local timezone. The same instant can fall in
  different weeks on devices in different timezones; this is accepted — the plan follows the
  user's wall clock.

### No plaintext recipe tags (deviation from the grocery contract)

Grocery lists expose linked recipes as plaintext `a` tags. Meal plans deliberately do **not**:
a plaintext coordinate plus a week-stamped d-tag would tell any relay operator what the user is
cooking and when, violating the hub's privacy posture ("readable by no one but the user").
All recipe coordinates live only inside the encrypted payload. Nothing requires relay-side
queryability: fetches are exact `#d` lookups and grocery generation runs client-side after
decryption.

### Replacement and deletion

- Saving a week publishes a new event with the same d-tag; relays replace per NIP-01
  addressable-event rules (newest `created_at` wins).
- Deletion is NIP-09: kind `5` with an `a` tag `30078:{pubkey}:mealplan-{week}` (and an `e` tag
  for the known event id when available).

## Encrypted payload (schemaVersion 1)

```json
{
  "schemaVersion": 1,
  "week": "2026-W29",
  "days": {
    "mon": {
      "slots": {
        "breakfast": { "type": "recipe", "a": "30023:<pubkey>:<dTag>", "title": "Shakshuka" },
        "lunch":     { "type": "text", "text": "Leftovers" },
        "dinner":    { "type": "recipe", "a": "30023:<pubkey>:<dTag>" },
        "snack":     { "type": "text", "text": "Fruit" }
      },
      "notes": "optional per-day note"
    }
  },
  "notes": "optional per-week note",
  "createdAt": 1789000000,
  "updatedAt": 1789000123
}
```

### Contract rules

1. `schemaVersion` is required and is `1` for this contract. Readers encountering
   `schemaVersion > 1` MUST treat the plan as **read-only** (render what they understand, never
   write back), so newer clients can extend the schema without older clients destroying data.
2. `week` mirrors the d-tag's week id (`{isoWeekYear}-W{ww}`) so the decrypted payload is
   self-describing. On conflict the d-tag wins.
3. `days` keys are `mon|tue|wed|thu|fri|sat|sun` (ISO order). Every day is optional; an absent
   day means nothing planned.
4. `slots` keys are exactly `breakfast|lunch|dinner|snack`. Every slot is optional.
5. A slot entry is a tagged union:
   - `{ "type": "recipe", "a": "<kind:pubkey:dTag>", "title": "<optional snapshot>" }` — `a` is a
     kind-30023 coordinate. `title` is an optional denormalized display snapshot so grids render
     offline; the coordinate stays authoritative and resolvers should refresh the title when the
     recipe is available.
   - `{ "type": "text", "text": "<free text>" }` — non-recipe entries ("Leftovers", "Eating out").
     Text slots are skipped by grocery generation.
6. `notes` (per-day and per-week) are optional free text.
7. `createdAt` / `updatedAt` are unix seconds. `createdAt` is preserved across saves; `updatedAt`
   is stamped on every save.
8. **Readers MUST ignore unknown fields and writers MUST preserve them on round-trip** (parse →
   edit known fields → re-serialize keeps unrecognized keys intact) within the same
   `schemaVersion`.
9. Invalid slot entries (unknown `type`, missing `a`/`text`) are dropped on read, never fatal;
   a malformed payload as a whole reads as "no plan" but MUST be surfaced distinctly from an
   empty week (see decrypt-failure rule below).

### Decrypt failures are not empty weeks

A fetch that finds an event but cannot decrypt or parse it MUST surface a distinguishable
"decrypt failed" result, not silently report "no plan" — browser-extension and remote signers can
deny decryption (the web client trips a session circuit breaker after repeated denials), and the
UI must be able to say "couldn't unlock this week" instead of showing an empty grid.

### NIP-46 durability caveat

Remote (NIP-46) signers perform the NIP-44 encryption on the signer's side. Some remote signers
have been observed producing ciphertext that a later session cannot decrypt. Matching the
grocery contract, clients **write anyway** for NIP-46 users; this caveat is accepted and
documented rather than blocked. If this policy changes it changes for grocery and meal plans
together.

## Cross-platform test fixtures

Language-neutral JSON vectors under `src/test/fixtures/` are the **single source of truth** for
parser / week / schema / grocery-generation behavior shared with Android. Web Vitest suites and
Android JUnit suites both consume these files. **Fixture changes REQUIRE a matching Android
update** — Android's copies under `app/src/test/resources/fixtures/` must checksum-match the
hashes below. Unilateral edits on either side fail the Android checksum drift tests.

| File | sha256 |
|---|---|
| `ingredient-parser.vectors.json` | `cc7e0ecae3ee8fac51e3ce46502fc758a30c9022b6a3f3765d49c42914b3ab81` |
| `week.vectors.json` | `de5c75e648548f0fe38ebe021a03da17a1f3a977ec7b103642bbf0fd066faf30` |
| `mealplan-schema.vectors.json` | `d8a34927d30a8a636bbc84ed3a384ee5f975d65827ae3302aceffb0239373e18` |
| `grocery-generation.vectors.json` | `090faff2b486886c0c14fe83e3a4fe48f2b3de8ddff375f18f1e5c1d125508d0` |

Notes:

- `ingredient-parser.vectors.json` pins quirks (plural singularization `"2 cups"` → `"2 cup"`,
  comma-suffix retention `"eggs, beaten"`) — they are the contract, not bugs to "fix" on one
  platform.
- `mealplan-schema.vectors.json` case `default-missing-fields` asserts `createdAt > 0` (wall
  clock), not a fixed timestamp.
- After editing any fixture file, recompute sha256 (`shasum -a 256`) and update this table **and**
  the Android copies in the same change set (or a paired Android PR that lands immediately after).
