import { describe, expect, it } from 'vitest';
import { hlsJsConfig, pickHlsEngine } from './hlsEngine';

describe('pickHlsEngine', () => {
  it('prefers hls.js on Safari so LL-HLS parts can be ignored', () => {
    expect(pickHlsEngine({ nativeHls: true, hlsJsSupported: true })).toBe('hlsjs');
  });

  it('uses hls.js where there is no native HLS (Chrome, Firefox)', () => {
    expect(pickHlsEngine({ nativeHls: false, hlsJsSupported: true })).toBe('hlsjs');
  });

  it('falls back to native HLS when hls.js cannot run (iPhone before iOS 17.1)', () => {
    expect(pickHlsEngine({ nativeHls: true, hlsJsSupported: false })).toBe('native');
  });

  it('reports no engine when neither is available', () => {
    expect(pickHlsEngine({ nativeHls: false, hlsJsSupported: false })).toBe('none');
  });
});

describe('hlsJsConfig', () => {
  it('turns low-latency mode off where a native player exists (Apple)', () => {
    expect(hlsJsConfig(true).lowLatencyMode).toBe(false);
  });

  it('keeps hls.js defaults for low-latency elsewhere', () => {
    expect(hlsJsConfig(false).lowLatencyMode).toBe(true);
  });

  it('keeps the existing buffer settings', () => {
    expect(hlsJsConfig(true)).toMatchObject({ enableWorker: false, backBufferLength: 15, maxBufferLength: 20 });
  });
});
