/** The viewer gate page must never be usable on a production hostname. */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

import { load } from './+page';

describe('/dev/live-watch host gate', () => {
  const run = (host: string) =>
    (load as any)({ url: new URL(`https://${host}/dev/live-watch?id=${'a'.repeat(32)}`) });

  it('works on preview deployments and local dev', () => {
    for (const host of ['095729d9.frontend-hvd.pages.dev', 'localhost', '127.0.0.1']) {
      expect(run(host)).toEqual({});
    }
  });

  it('redirects to the home page everywhere else, production included', () => {
    for (const host of [
      'zap.cooking',
      'www.zap.cooking',
      'staging.zap.cooking',
      'pages.dev.evil.example'
    ]) {
      let thrown: any = null;
      try {
        run(host);
      } catch (e) {
        thrown = e;
      }
      expect(thrown?.status).toBe(307);
      expect(thrown?.location).toBe('/');
    }
  });
});
