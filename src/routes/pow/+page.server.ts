import { dev } from '$app/environment';
import { loadPowPage } from '$lib/shipped/pageLoad.server';
import type { PowPayload } from '$lib/shipped/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ platform, url, setHeaders }) =>
  loadPowPage({
    platform,
    url,
    setHeaders,
    // `dev` is false at compile time in production builds, so this import
    // is dead code there and the fixture is never bundled.
    loadDevFixture: dev
      ? async () =>
          (await import('$lib/shipped/fixtures/dev-summary.json')).default as unknown as PowPayload
      : null
  });
