# Explore import resilience and mobile performance

The import form works before app hydration and when app chunks fail. Explore still pays for the shared app runtime, so it does **not** preserve the previous unhydrated landing page's loading cost.

## Controlled production Lighthouse comparison

Medians of three fresh browser runs per revision. Baseline is main `b416b7f7`, before the shared-shell change. The after build includes the PR919 follow-up source recorded in `after-source.json`; only any explicitly recorded test-only changes occurred after the build snapshot.

| Metric | Main, unhydrated Explore | After, shared app shell |
| --- | ---: | ---: |
| LCP | 2.27 s | 10.56 s |
| Total blocking time | 24 ms | 519 ms |
| JavaScript transfer bytes (gzip + transfer overhead) | 3,398 | 1,082,133 |
| JavaScript resource bytes (decoded) | 12,815 | 3,163,809 |
| Script requests | 4 | 188 |
| Performance score | 90 | 43 |
| Accessibility score | 95 | 95 |

Lighthouse12.8.2, Chromium, 360×800 mobile emulation with DPR1 and Moto G Power user agent. Simulated throttling is 150ms RTT, 1638.4Kbps throughput and 4× CPU. Both revisions use isolated production builds, the same local Node SSR/static server with gzip, no Cloudflare KV data, mocked-unavailable local APIs, and blocked external browser HTTPS/WSS endpoints. The server runs the existing public discovery fallback without edge-cache/KV bindings; those services were unavailable and the captured page remained in its empty-data state. Each run starts a new browser. Final paired runs were taken after typecheck and other browser fixtures finished. `main-*`, `after-*`, and `initial-*` diagnostic runs taken earlier are retained locally but excluded from these medians.

The remaining scored accessibility failure is the existing viewport zoom restriction, present in both revisions. This automated score does not certify VoiceOver behavior.

These are controlled local measurements, not production field measurements or a real phone/Cloudflare edge test. The landing content is the graceful empty-data state, so the LCP element is text rather than a loaded recipe photograph. HTTP transport, live data/images, real authentication, relay/provider connections, and the production cache path can change the numbers. The JavaScript byte increase is concrete evidence of the new shared runtime dependency even with external connections blocked.

## Early import behavior

`import.client.js` is a self-contained independent module, emitted as a small same-origin asset in the SSR head. It has no Svelte/auth/wallet imports. A controller stored on the form with `Symbol.for` lets the hydrated component adopt that same enhancement instead of registering another listener or cancelling its request.

- With all app chunks blocked, the public import button still enables, submits exactly one mocked POST, and renders the existing limit feedback.
- When app hydration is delayed until a POST is in flight, the app adopts the exact same controller, preserves the busy state, and produces one POST. The shared Feed navigation still works afterward.
- Svelte owns cleanup after adoption. Before adoption a removal observer aborts the request; an immediate connectivity check also blocks a response that settles before the observer microtask. No stale handoff or redirect occurs.
- Eight unit tests pass, including unmount cancellation, late-success suppression, early-controller adoption, preserved errors/typed input, and response/removal ordering. ESLint and Prettier pass for the changed import source and tests.

Evidence: `import-browser-results.json`, `import-app-blocked-360.png`, `import-browser.mjs`, and the independent reviewer reproduction in the sibling landing-audit artifacts. The test extractor is mocked; no real recipe import, account, credentials, or payment action is performed.

The built early asset is about 6KB uncompressed / 2.3KB gzipped. This restores independent form readiness; it does not remove the shared application's larger JavaScript payload.
