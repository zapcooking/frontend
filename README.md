# Explore community promises review evidence

Product commit: `155e1299a5152040b90edb9349b1ffe868987f82`. Product PR is based on PR #916 (`feat/explore-editorial-palette`). This separate evidence branch contains review artifacts only; it is not deployed or part of the product diff.

The six viewport screenshots show 360px, 768px and 1440px in light and dark themes. Full-page versions are also included. All screenshot recipe names, cook names and food content are deterministic **test fixtures**, using existing local food assets. They are not a representation of current production content or real named members. The shipped proof row uses existing public recipe-author data, with no fallback/sample identities.

Verified: 54 layout/theme/data-state cases without horizontal overflow; missing, duplicate, invalid and long author names; all four existing rotating headlines; no-JavaScript rendering; keyboard focus; accessibility-tree plain strikethrough equivalent; unchanged external requests, cookies and storage; import recovery/reload/handoff with mocked extraction responses; 109 landing tests; zero type errors; production Cloudflare build and actual built server response containing new text/cache headers/no app hydration.

Lighthouse accessibility is 96/100 for main, the editorial base and this change at 360px/1440px in both themes. Existing failures are unchanged. See comparison JSON and Lighthouse report.

The approved rendering choice preserves runtime cached SSR (`prerender=false`), not build-time prerendering. Live production privacy/terms could not be independently fetched due to the environment proxy; claims were verified against code and checked-in policy sources. Actual VoiceOver on macOS/iOS is still pending. Repository-wide lint has pre-existing failures; changed components pass, and the Explore page's existing parser issue is unchanged.
