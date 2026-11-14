/** The phone-gate page must never be usable on a production hostname. */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

import { isGateHost, load } from './+page';

describe('/dev/live-publish host gate', () => {
  it('allows preview deployments and local dev only', () => {
    for (const host of [
      '06b656da.frontend-hvd.pages.dev',
      'feat-live-publish-relay.frontend-hvd.pages.dev',
      'localhost',
      '127.0.0.1'
    ]) {
      expect(isGateHost(host)).toBe(true);
    }
    for (const host of [
      'zap.cooking',
      'www.zap.cooking',
      'staging.zap.cooking',
      'pages.dev.evil.example',
      'evilpages.dev'
    ]) {
      expect(isGateHost(host)).toBe(false);
    }
  });

  it('redirects to the home page on production', () => {
    const run = (host: string) =>
      (load as any)({ url: new URL(`https://${host}/dev/live-publish`) });
    expect(() => run('zap.cooking')).toThrow();
    try {
      run('www.zap.cooking');
    } catch (thrown: any) {
      expect(thrown.status).toBe(307);
      expect(thrown.location).toBe('/');
    }
    expect(run('abc.frontend-hvd.pages.dev')).toEqual({});
  });
});
