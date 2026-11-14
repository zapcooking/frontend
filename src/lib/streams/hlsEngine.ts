/**
 * Which engine plays an HLS stream, and how hls.js is configured for it.
 *
 * Safari (macOS, iPadOS, iOS) plays HLS natively through AVPlayer. zap.stream
 * serves Low-Latency HLS (EXT-X-PART, PRELOAD-HINT, byte-range parts), and
 * its origin answers some of AVPlayer's partial-segment requests with
 * HTTP 416, which AVPlayer treats as fatal — the stream freezes or never
 * plays. The Zap Cooking iOS app fixed this by stripping the LL-HLS tags so
 * AVPlayer falls back to whole segments.
 *
 * A web page cannot rewrite the playlists the native player fetches, but
 * hls.js with `lowLatencyMode: false` ignores the parts and loads whole
 * segments — the same effect. hls.js runs wherever Media Source Extensions
 * do, including iPhone Safari 17.1+ (ManagedMediaSource), so it is preferred
 * even where native HLS exists. Native HLS stays the fallback for browsers
 * that cannot run hls.js (older iPhones).
 */

export type HlsEngine = 'hlsjs' | 'native' | 'none';

export function pickHlsEngine(support: { nativeHls: boolean; hlsJsSupported: boolean }): HlsEngine {
  if (support.hlsJsSupported) return 'hlsjs';
  if (support.nativeHls) return 'native';
  return 'none';
}

/**
 * Whole segments wherever a native player exists (it is the Apple case that
 * needs the LL-HLS parts ignored); other browsers keep hls.js's default.
 */
export function hlsJsConfig(nativeHls: boolean) {
  return {
    enableWorker: false,
    backBufferLength: 15,
    maxBufferLength: 20,
    lowLatencyMode: !nativeHls
  };
}
