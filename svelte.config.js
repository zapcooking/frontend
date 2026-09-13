import adapterCloudflare from '@sveltejs/adapter-cloudflare';
import adapterVercel from '@sveltejs/adapter-vercel';
import adapterStatic from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Use static adapter for mobile/Capacitor builds, Vercel for web deployment, Cloudflare as fallback
const isCapacitor = process.env.CAPACITOR === 'true';
const isStaticAdapter = process.env.ADAPTER === 'static';
const adapter =
  isCapacitor || isStaticAdapter
    ? adapterStatic({
        pages: isCapacitor ? 'dist' : 'build',
        assets: isCapacitor ? 'dist' : 'build',
        fallback: 'index.html',
        precompress: false,
        strict: true,
        // Don't try to prerender dynamic routes - they'll be handled client-side
        prerender: {
          entries: [],
          handleHttpError: 'warn'
        }
      })
    : process.env.VERCEL
      ? adapterVercel()
      : adapterCloudflare({
          // Excluded from SvelteKit Worker so Cloudflare applies redirect routing
          // for LNURL endpoints defined in root _redirects (proxied to breez.tips).
          routes: {
            include: ['/*'],
            exclude: ['<all>', '/.well-known/lnurlp/*', '/lnurlpay/*']
          }
        });

/**
 * Report-only CSP directives.
 *
 * Typed loosely on purpose: SvelteKit's `Csp.SchemeSource` union omits
 * `wss:`, which the CSP spec allows and which we need for Nostr relay
 * connections. The emitted header is correct at runtime; only the type
 * is short. csp.test.ts asserts the shape instead.
 *
 * @type {any}
 */
const cspReportOnly = {
  'default-src': ['self'],
  // SvelteKit hashes the inline script IT injects (hydration), but not
  // the ones in src/app.html — those are ours to declare. Order here:
  // theme bootstrap, fetch interceptor, JSON-LD.
  //
  // These are content hashes: editing app.html invalidates them. That
  // silent-breakage risk is why csp.test.ts recomputes them from
  // app.html and fails if they drift.
  //
  // The JSON-LD block is a data block, not executable script, so most
  // browsers never check it against script-src. Its hash is included
  // anyway so enforcing the policy later cannot quietly break
  // structured data on a browser that does.
  'script-src': [
    'self',
    'sha256-qcZmwq07vWNn5ZauV94XXX/jdJANrJDL/eXSfIaHFSc=',
    'sha256-O1WCjsIYQjIDYZDkln/ClIQsHZwGqAgth96xr5mS/Q8=',
    'sha256-gXQRzOfEF9ICX1ARzegNXE7MR/gA6nlSg8mmiPpqMao='
  ],
  'style-src': ['self', 'unsafe-inline'],
  'font-src': ['self', 'https://fonts.gstatic.com'],
  'img-src': ['self', 'data:', 'blob:', 'https:'],
  'media-src': ['self', 'blob:', 'https:'],
  'connect-src': ['self', 'https:', 'wss:'],
  'frame-src': ['https://www.youtube-nocookie.com', 'https://www.youtube.com'],
  'object-src': ['none'],
  'base-uri': ['self'],
  'form-action': ['self'],
  'worker-src': ['self', 'blob:'],
  // Required: the spec (and SvelteKit) reject a report-only policy
  // with nowhere to report to. See src/routes/api/csp-report.
  'report-uri': ['/api/csp-report']
};

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: [vitePreprocess({})],

  kit: {
    adapter: adapter,
    // Content-Security-Policy, REPORT-ONLY for now.
    //
    // Uses SvelteKit's own CSP support rather than a hand-written header in
    // hooks.server.ts: with SSR on, SvelteKit injects its own inline
    // hydration script into every page, and its content varies per page and
    // per build. Only SvelteKit can hash those, so a hand-rolled header
    // would report a violation on literally every page load and drown out
    // the real signal. `mode: 'hash'` also keeps the bot-OG path and any
    // cached HTML working, which nonces would not.
    //
    // Honest limits of this policy:
    //   * `connect-src https: wss:` is irreducible — relay lists are chosen
    //     by the user and LNURL callbacks resolve to arbitrary hosts. The
    //     win here is script/frame/object/base-uri, not exfiltration
    //     prevention.
    //   * `style-src 'unsafe-inline'` is required by the inline `style="…"`
    //     attributes used throughout the components.
    //
    // Report-only means violations are logged to the browser console and
    // nothing is blocked. Flip to `directives` (from `reportOnly`) to
    // enforce, only after a production soak confirms the report is clean.
    csp: {
      mode: 'hash',
      reportOnly: cspReportOnly
    },
    version: {
      // Poll _app/version.json so long-lived tabs detect new deploys.
      // Cloudflare Pages drops the previous deploy's immutable assets, so
      // without this, stale clients 404 on chunk imports during client-side
      // navigation (broken tabs/500s until a hard refresh).
      // Paired with the $updated guard in +layout.svelte.
      pollInterval: 60000
    }
  }
};

export default config;
