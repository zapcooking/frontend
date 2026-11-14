/**
 * Hostnames on which the temporary Go live gate pages (/dev/live-publish,
 * /dev/live-watch) are allowed to work: preview deployments and local dev.
 * Production, and every other hostname, is refused.
 *
 * The other pages under /dev gate on import.meta.env.PROD, which is also
 * true for preview builds, so these gate on the hostname instead.
 */
export function isGateHost(hostname: string): boolean {
  return hostname.endsWith('.pages.dev') || hostname === 'localhost' || hostname === '127.0.0.1';
}
