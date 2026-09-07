# Roster/history v2 implementation review

Base: main `b78d77fa`. Branch: `feat/cheffys-table-roster-v2`. Prepared September 6, 2026 for review before PR creation.

## Delivered scope

Open Kitchen draws three distinct guests in random order from the existing five. New `SavedService` v2 records capture the ordered IDs for **both Open Kitchen and Daily**. Daily generation is unchanged. The v1 reader, guest data and scoring rules are separate frozen snapshots; v2 uses those same frozen cooking rules with its captured roster. The public evaluator, score weights, customer definitions and `RecordBook.version` are unchanged.

The chosen old-client behavior is **(a): omit unsupported v2 records until upgrade**. Tests exercise the original parser, merge, sync, cache and RecordBook calculations, proving v2 contributes no history entries, service count, best score, Daily score or lessons on an old client. The same relay records restore correctly on upgrade. New clients write a separate v2 cache and import v1 caches without rewriting them, protecting unsynced v2 records from old-client cache writes. The existing latest-100 relay window still applies; older clients can see fewer compatible records as v2 records fill that window.

The [format and compatibility contract](roster-history-v2.md) documents validation, cache ownership, deduplication and unchanged Nostr addressing/acknowledgment behavior. No navigation button, Daily variety, streak, timing interface, scoring variation or progression is included.

## Automated evidence

- Full repository suite: **125 files, 1,732 tests passed**.
- Final focused suite: **6 files, 105 tests passed**, including 72 roster/history tests. All 60 ordered rosters round-trip in both v2 modes with identical complete service results; 365 Daily dates match the original algorithm.
- Full legacy Open Kitchen and Daily fixtures were generated from unmodified main, not from the new implementation. Both original services and their complete RecordBooks match.
- Snapshot comparison confirmed both frozen modules are identical to main after removing the provenance header and normalizing the relative import path.
- Coverage includes malformed/missing/duplicate/unknown/sparse roster IDs, malformed remote records, detached snapshots, immutable-ID deduplication, isolated/corrupt caches, late legacy imports, account changes during decryption/signing/publishing, partial acknowledgments and retry queues.
- Svelte check: **0 errors, 150 warnings in 47 files**, with no Cheffy's Table diagnostics. Changed TypeScript and QA scripts pass ESLint and Prettier.

## Browser and build evidence

- **14 viewport/theme combinations, 112 screenshots:** 375, 390, 430, 768, 1024, 1280 and 1440px in light/dark mode. Every configuration completed a service and verified guest order, total score and all three ratings against the Service Book both before and after reload. The run served all five guests across 11 distinct rosters, with zero page errors or horizontal game overflow. Representative phone and desktop arrival/book screenshots were visually inspected.
- **19 interaction scenarios passed**, including offline v2 saves, guest-independent Cook/Serve actions, same-identity Daily v2 capture/book display, account switching during serving, missing-signer failure, restart confirmation and unchanged Daily tickets. Existing keyboard, focus, preferences, navigation and recipe/companion scenarios also pass.
- The profile script ran at 375, 820 and 1280px. HUD controls measured **44×46px**; there was no overflow or animation still running after settling. In the 1.9-second development-server samples, p95 frame intervals were **17.5–17.7ms**. The 1280px sample observed two long tasks (77ms and 122ms) and a maximum frame interval of 134.2ms; phone/tablet samples observed no long tasks. These are local headless observations, not a physical-device performance guarantee or a production regression comparison.
- **Production build passed:** `SKIP_ENV_VALIDATION=1 pnpm build`, using the default Cloudflare adapter. The game route chunk is 200.0 kB (59.3 kB gzip), plus 49.2 kB CSS (9.1 kB gzip), excluding shared Zap chunks and the unchanged artwork. No production dependency or lockfile changed.

Browser QA uses isolated Chromium contexts and synthetic public keys without signers. The recipe success/error states are local fixtures. No real signed history event or social post is published. The local preview uses the repository's supported static adapter because the Cloudflare development runtime encountered SQLite state errors; the production build is verified separately with the default adapter.

## Reproduction

```sh
pnpm test
pnpm check
pnpm exec vitest run src/lib/cheffys-table/{service,presentation,history,serviceBook,nostrHistory,rosterHistory}.test.ts
SKIP_ENV_VALIDATION=1 pnpm build
```

Run browser QA against a separate, stable Vite server; checks/builds that regenerate `.svelte-kit` and source edits must finish before browser QA begins:

```sh
ADAPTER=static pnpm dev --host 127.0.0.1 --port 5190
TABLE_QA_URL=http://127.0.0.1:5190/cheffys-table node scripts/qa/cheffys-table/matrix.mjs
TABLE_QA_URL=http://127.0.0.1:5190/cheffys-table node scripts/qa/cheffys-table/interactions.mjs
TABLE_QA_URL=http://127.0.0.1:5190/cheffys-table node scripts/qa/cheffys-table/profile.mjs
```

Set `TABLE_PLAYWRIGHT_MODULE` when using a Playwright installation outside the checkout, and `TABLE_QA_OUTPUT` to retain screenshots and JSON results. QA selectors use the current Cook/Serve action rather than a fixed guest name. Matrix assertions compare the played guest names, score and ratings with the saved Service Book before and after reload.
