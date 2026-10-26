# ESLint before/after comparison

Read-only ESLint API lintText comparison of every changed Svelte/TypeScript/JavaScript source file against base 970d0f48, using the same absolute filePath. Messages compared as multisets of ruleId, severity, and message; source line/column locations are ignored. No files were formatted or edited.

- Files checked: 20
- Introduced messages: 0
- Resolved messages: 0
- Errors: 45 before, 45 after
- Warnings: 0 before, 0 after

| File | Before errors/warnings | After errors/warnings | Introduced | Baseline parser limitation |
| --- | ---: | ---: | ---: | --- |
| `src/components/Header.svelte` | 1/0 | 1/0 | 0 | None |
| `src/components/MobileSearchOverlay.svelte` | 0/0 | 0/0 | 0 | None |
| `src/components/NoteContent.svelte` | 13/0 | 13/0 | 0 | None |
| `src/components/RichTextNostr.svelte` | 5/0 | 5/0 | 0 | None |
| `src/components/TagsSearchAutocomplete.svelte` | 9/0 | 9/0 | 0 | None |
| `src/components/auth/SignInCard.svelte` | 10/0 | 10/0 | 0 | None |
| `src/components/auth/signInContrast.test.ts` | 0/0 | 0/0 | 0 | None |
| `src/components/landing/LandingImportHero.svelte` | 0/0 | 0/0 | 0 | None |
| `src/components/landing/LandingMembership.svelte` | 1/0 | 1/0 | 0 | None |
| `src/hooks.server.ts` | 0/0 | 0/0 | 0 | None |
| `src/lib/landing/authContext.ts` | 0/0 | 0/0 | 0 | None |
| `src/lib/landing/import.client.js` | 0/0 | 0/0 | 0 | None |
| `src/lib/landing/importEnhancement.test.ts` | 0/0 | 0/0 | 0 | None |
| `src/lib/landing/membership.client.js` | 0/0 | 0/0 | 0 | None |
| `src/lib/landing/membership.test.ts` | 0/0 | 0/0 | 0 | None |
| `src/lib/landing/route.test.ts` | 0/0 | 0/0 | 0 | None |
| `src/lib/landing/route.ts` | 0/0 | 0/0 | 0 | None |
| `src/routes/+layout.svelte` | 6/0 | 6/0 | 0 | None |
| `src/routes/explore/+page.server.ts` | 0/0 | 0/0 | 0 | None |
| `src/routes/explore/page.server.test.ts` | 0/0 | 0/0 | 0 | None |

A file with an existing parser failure cannot receive complete rule analysis. Such failures are listed above rather than counted as a clean lint pass. The repository-wide pnpm lint command also runs Prettier before ESLint; this comparison does not imply that the repository formatting gate passes.

## Prettier before/after comparison

Every changed file was checked with `Prettier.check`, using the same resolved repository config and absolute filepath for base 970d0f48 and the working file. The legacy ignored `pluginSearchDirs` option was omitted to suppress duplicate warnings; no formatting options were changed. No source files were written.

- Files checked: 21
- Passing before/after: 12/12
- Existing failures among changed files: 9
- Newly failing files: 0
- Resolved failures: 0

| File | HEAD | Working | New failure |
| --- | --- | --- | --- |
| `src/components/Header.svelte` | Fail | Fail | No |
| `src/components/MobileSearchOverlay.svelte` | Fail | Fail | No |
| `src/components/NoteContent.svelte` | Fail | Fail | No |
| `src/components/RichTextNostr.svelte` | Fail | Fail | No |
| `src/components/TagsSearchAutocomplete.svelte` | Fail | Fail | No |
| `src/components/auth/SignInCard.svelte` | Fail | Fail | No |
| `src/components/auth/signInContrast.test.ts` | Pass | Pass | No |
| `src/components/landing/LandingImportHero.svelte` | Pass | Pass | No |
| `src/components/landing/LandingMembership.svelte` | Pass | Pass | No |
| `src/hooks.server.ts` | Pass | Pass | No |
| `src/lib/landing/authContext.ts` | Pass | Pass | No |
| `src/lib/landing/import.client.js` | Pass | Pass | No |
| `src/lib/landing/importEnhancement.test.ts` | Pass | Pass | No |
| `src/lib/landing/membership.client.js` | Pass | Pass | No |
| `src/lib/landing/membership.test.ts` | Pass | Pass | No |
| `src/lib/landing/route.test.ts` | Fail | Fail | No |
| `src/lib/landing/route.ts` | Fail | Fail | No |
| `src/lib/themes/palettes.css` | Pass | Pass | No |
| `src/routes/+layout.svelte` | Fail | Fail | No |
| `src/routes/explore/+page.server.ts` | Pass | Pass | No |
| `src/routes/explore/page.server.test.ts` | Pass | Pass | No |
