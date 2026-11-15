/** Go live KV keys are separate per environment (preview and production share one namespace). */
import { describe, it, expect } from 'vitest';
import { liveEnvSegment, liveKvKey, liveReportRateScope } from './config';
import { adminActionError, displayedMode } from './adminClient';

describe('liveKvKey', () => {
  it('keeps the unprefixed production names (live:off is unchanged)', () => {
    for (const prefix of [undefined, 'zc-live-', 'garbage', '']) {
      expect(liveEnvSegment(prefix)).toBe('');
      expect(liveKvKey(prefix, 'off')).toBe('live:off');
      expect(liveKvKey(prefix, 'hosting_mode')).toBe('live:hosting_mode');
      expect(liveReportRateScope(prefix)).toBe('live-report');
    }
  });

  it('names every preview key with the environment', () => {
    const p = 'zc-live-preview-';
    expect(liveEnvSegment(p)).toBe('preview');
    expect(liveKvKey(p, 'off')).toBe('live:preview:off');
    expect(liveKvKey(p, 'hosting_mode')).toBe('live:preview:hosting_mode');
    expect(liveKvKey(p, 'alert:abc')).toBe('live:preview:alert:abc');
    expect(liveKvKey(p, 'access-alert')).toBe('live:preview:access-alert');
    expect(liveReportRateScope(p)).toBe('live-preview-report');
  });

  it('never gives preview and production the same key', () => {
    for (const name of ['off', 'hosting_mode', 'alert:x', 'access-alert']) {
      expect(liveKvKey('zc-live-preview-', name)).not.toBe(liveKvKey('zc-live-', name));
    }
  });
});

describe('admin page helpers', () => {
  it('gives every failure a visible message', () => {
    expect(adminActionError({ status: 503, error: 'not_written' })).toBe(
      'The hosting mode could not be saved. Nothing changed. Try again. (HTTP 503, not_written)'
    );
    expect(adminActionError({ status: 502 })).toBe('The action failed. (HTTP 502)');
    expect(adminActionError({ status: 418, error: 'weird' })).toBe('The action failed. (HTTP 418, weird)');
    expect(adminActionError('network')).toMatch(/Couldn't reach the server/);
  });

  it('shows the mode last switched to, even while the KV read lags', () => {
    expect(displayedMode('members', 'approved')).toEqual({ mode: 'approved', applying: true });
    expect(displayedMode('approved', 'approved')).toEqual({ mode: 'approved', applying: false });
    expect(displayedMode('members', null)).toEqual({ mode: 'members', applying: false });
  });
});
