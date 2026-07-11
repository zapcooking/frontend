import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
	resolve: {
		alias: {
			$lib: path.resolve('./src/lib'),
			'$env/dynamic/private': path.resolve('./src/test/envMock.ts')
		}
	},
	test: {
		include: ['tmp/nourish-backfill/run.manual.ts'],
		testTimeout: 2_400_000,
		hookTimeout: 60_000
	}
});
