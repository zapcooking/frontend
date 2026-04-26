import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Vitest configuration.
 *
 * `clientTag.test.ts` and `zapAmount.test.ts` predate vitest in this
 * repo — they're standalone tsx scripts that use `console.assert` and
 * have no `describe` / `it` blocks. Vitest can't discover tests inside
 * them and reports "No test suite found". They're excluded here so
 * `pnpm test` runs cleanly; the underlying scripts remain runnable
 * with `npx tsx <file>` per the comment at the top of each file. A
 * future cleanup can port them to vitest's API.
 *
 * Standalone config (not merged from vite.config.ts) because the main
 * vite config wires up the SvelteKit plugin + Cloudflare-targeted SSR
 * options that aren't relevant for unit-testing pure-TS modules. We
 * just need the `$lib` alias matched to SvelteKit's default so test
 * files can import via the same path the app code uses.
 */
export default defineConfig({
	resolve: {
		alias: {
			$lib: path.resolve('./src/lib'),
			$app: path.resolve('./.svelte-kit/dev/runtime/app')
		}
	},
	test: {
		include: ['src/**/*.test.ts'],
		exclude: ['src/lib/clientTag.test.ts', 'src/lib/zapAmount.test.ts', 'node_modules/**']
	}
});
