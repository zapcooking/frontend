# ESLint before/after comparison

Read-only ESLint API lintText comparison of every changed Svelte/TypeScript/JavaScript source file against HEAD, using the same absolute filePath. Messages compared as multisets of ruleId, severity, and message; source line/column locations are ignored. No files were formatted or edited.

- Files checked: 16
- Introduced messages: 0
- Resolved messages: 0
- Errors: 18 before, 18 after
- Warnings: 0 before, 0 after

| File | Before errors/warnings | After errors/warnings | Introduced | Baseline parser limitation |
| --- | ---: | ---: | ---: | --- |
| `src/components/Header.svelte` | 1/0 | 1/0 | 0 | None |
| `src/components/MobileSearchOverlay.svelte` | 0/0 | 0/0 | 0 | None |
| `src/components/TagsSearchAutocomplete.svelte` | 9/0 | 9/0 | 0 | None |
| `src/components/landing/LandingImportHero.svelte` | 0/0 | 0/0 | 0 | None |
| `src/components/landing/LandingMembership.svelte` | 1/0 | 1/0 | 0 | None |
| `src/lib/landing/import.client.ts` | 0/0 | 0/0 | 0 | None |
| `src/lib/landing/importEnhancement.test.ts` | 0/0 | 0/0 | 0 | None |
| `src/lib/landing/membership.client.js` | 0/0 | 0/0 | 0 | None |
| `src/lib/landing/membership.test.ts` | 0/0 | 0/0 | 0 | None |
| `src/lib/landing/meta.ts` | 0/0 | 0/0 | 0 | None |
| `src/lib/landing/route.test.ts` | 0/0 | 0/0 | 0 | None |
| `src/lib/landing/route.ts` | 0/0 | 0/0 | 0 | None |
| `src/routes/+layout.svelte` | 6/0 | 6/0 | 0 | None |
| `src/routes/explore/+page.server.ts` | 0/0 | 0/0 | 0 | None |
| `src/routes/explore/+page.svelte` | 1/0 | 1/0 | 0 | Parsing error: Unexpected keyword or identifier. |
| `src/routes/explore/page.server.test.ts` | 0/0 | 0/0 | 0 | None |

A file with an existing parser failure cannot receive complete rule analysis. Such failures are listed above rather than counted as a clean lint pass. The repository-wide pnpm lint command also runs Prettier before ESLint; this comparison does not imply that the repository formatting gate passes.

## Prettier before/after comparison

Every changed file was checked with `Prettier.check`, using the same resolved repository config and absolute filepath for HEAD and the working file. The legacy ignored `pluginSearchDirs` option was omitted to suppress duplicate warnings; no formatting options were changed. No source files were written.

- Files checked: 18
- Passing before/after: 11/11
- Existing failures among changed files: 7
- Newly failing files: 0
- Resolved failures: 0

| File | HEAD | Working | New failure |
| --- | --- | --- | --- |
| `src/components/Header.svelte` | Fail | Fail | No |
| `src/components/MobileSearchOverlay.svelte` | Fail | Fail | No |
| `src/components/TagsSearchAutocomplete.svelte` | Fail | Fail | No |
| `src/components/landing/LandingImportHero.svelte` | Pass | Pass | No |
| `src/components/landing/LandingMembership.svelte` | Pass | Pass | No |
| `src/lib/landing/exploreThemes.css` | Pass | Pass | No |
| `src/lib/landing/import.client.ts` | Pass | Pass | No |
| `src/lib/landing/importEnhancement.test.ts` | Pass | Pass | No |
| `src/lib/landing/membership.client.js` | Pass | Pass | No |
| `src/lib/landing/membership.test.ts` | Pass | Pass | No |
| `src/lib/landing/meta.ts` | Fail | Fail | No |
| `src/lib/landing/route.test.ts` | Fail | Fail | No |
| `src/lib/landing/route.ts` | Fail | Fail | No |
| `src/lib/themes/palettes.css` | Pass | Pass | No |
| `src/routes/+layout.svelte` | Fail | Fail | No |
| `src/routes/explore/+page.server.ts` | Pass | Pass | No |
| `src/routes/explore/+page.svelte` | Pass | Pass | No |
| `src/routes/explore/page.server.test.ts` | Pass | Pass | No |
