# ESLint before/after comparison

Read-only ESLint API lintText comparison of every changed Svelte/TypeScript/JavaScript source file against base 80c9d1ec, using the same absolute filePath. Messages compared as multisets of ruleId, severity, and message; source line/column locations are ignored. No files were formatted or edited.

- Files checked: 4
- Introduced messages: 0
- Resolved messages: 0
- Errors: 2 before, 2 after
- Warnings: 0 before, 0 after

| File | Before errors/warnings | After errors/warnings | Introduced | Baseline parser limitation |
| --- | ---: | ---: | ---: | --- |
| `src/components/BottomNav.svelte` | 0/0 | 0/0 | 0 | None |
| `src/components/CreateMenuButton.svelte` | 0/0 | 0/0 | 0 | None |
| `src/components/Header.svelte` | 1/0 | 1/0 | 0 | None |
| `src/routes/feed/+page.svelte` | 1/0 | 1/0 | 0 | None |

A file with an existing parser failure cannot receive complete rule analysis. Such failures are listed above rather than counted as a clean lint pass. The repository-wide pnpm lint command also runs Prettier before ESLint; this comparison does not imply that the repository formatting gate passes.

## Prettier before/after comparison

Every changed file was checked with `Prettier.check`, using the same resolved repository config and absolute filepath for base 80c9d1ec and the working file. The legacy ignored `pluginSearchDirs` option was omitted to suppress duplicate warnings; no formatting options were changed. No source files were written.

- Files checked: 5
- Passing before/after: 2/2
- Existing failures among changed files: 3
- Newly failing files: 0
- Resolved failures: 0

| File | HEAD | Working | New failure |
| --- | --- | --- | --- |
| `src/components/BottomNav.svelte` | Fail | Fail | No |
| `src/components/CreateMenuButton.svelte` | Pass | Pass | No |
| `src/components/Header.svelte` | Fail | Fail | No |
| `src/lib/themes/palettes.css` | Pass | Pass | No |
| `src/routes/feed/+page.svelte` | Fail | Fail | No |
