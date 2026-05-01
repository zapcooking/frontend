/**
 * Project-wide HTML sanitizer.
 *
 * Uses plain `dompurify` (browser DOM) rather than `isomorphic-dompurify`
 * (jsdom-on-node). All sinks routing through this helper render in
 * browser-side contexts, and Cloudflare Workers (production runtime)
 * don't reliably support jsdom even with `nodejs_compat` — at best a
 * heavy bundle, at worst an SSR runtime crash. SSR returns empty rather
 * than raw, which is strictly safer than the prior `browser ? sanitize
 * : raw` pattern (a blank flash on hydration is preferable to an SSR
 * XSS). Hydration re-renders with the real sanitized output.
 *
 * The hook is registered on DOMPurify's shared singleton at module
 * load. Anywhere else in the app that imports `dompurify` directly
 * inherits it. Keep the policy: do NOT import dompurify directly
 * elsewhere in src/ — funnel through `sanitizeHTML` so changes here
 * propagate.
 */
import DOMPurify from 'dompurify';

const SANITIZE_CONFIG = {
  ADD_ATTR: ['target']
};

const isBrowser = typeof window !== 'undefined';

if (isBrowser) {
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName === 'A' && node.getAttribute('target') === '_blank') {
      node.setAttribute('rel', 'noopener noreferrer nofollow ugc');
    }
  });
}

export function sanitizeHTML(html: string): string {
  if (!isBrowser) return '';
  return DOMPurify.sanitize(html, SANITIZE_CONFIG);
}
