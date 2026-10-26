# PR #919: Original colors and Explore audit follow-up

Product commit: `80c9d1ec2a9fce99b532eb3ee3e8fe85aa5e4ea2`. All product changes are in PR #919; it has not been merged. This report supersedes the initial PR report's cache and search descriptions.

## Original colors

Zap Original restores the historical brand primary: **#ec4700 light / #ff5722 dark**, including the Cheffy ring and filled actions. NoteContent hashtags restore their separate historical orange text, fills, and hover colors; RichText uses those same hashtag roles. Other six styles in both modes are unchanged: 648 existing-token comparisons, 84 component records, and 24 hashtag hover records pass.

Per the user's clarification, both the dark page and notes are lighter: page approximately **#151d2c**, mixed from the existing gray palette; notes **#1f2937**. The drawer remains #1f2937. Light page backgrounds remain white.

Bright brand actions use **#111827 labels** for readable contrast (4.62:1 light / 5.61:1 dark). The optional white-versus-dark-label question received no answer before implementation; the recommended dark-label assumption was stated in chat. Small Explore copy uses a separate readable orange and the import-panel link uses secondary text. Sign-in retains its original contrast-safe white-label action pairing. Geometry and typography are unchanged in 588 sampled properties. See [color report](colors/README.md).

## Audit disposition

| Finding | Result |
| --- | --- |
| 1. Notification permission on first Explore visit | Fixed. Skip launch permission flow on a landing route, with a second guard after the dynamic import. Real browser checks record 0 permission calls on Explore; Feed's existing launch flow remains the positive control. |
| 1. Full-app startup performance | Measured; **substantial unresolved regression**, detailed below. No claim that the old landing speed is preserved. |
| 2. Cached HTML referring to deleted chunks | Fixed for new responses: Explore HTML and route data use **Cache-Control: no-store**. Public aggregate/KV caching remains. Existing preview entries retain their old bounded TTL during rollout; response headers cannot revoke already-cached entries. |
| 3. Membership invitations flashing during restoration | Fixed using readonly, layout-instance auth snapshots. Initial cached-session waits and loading states remain unknown; settled logout is authoritative before storage cleanup. Actual delayed NIP07 restoration shows no membership invitation flash, one uncached status POST, and no signing. |
| 4. Workers failures | Prior PR branch failures confirmed. Both Workers failed on PR #918 and passed on main with the **identical Git tree**. Current main is green. This establishes that the pattern predates #919; the exact Cloudflare cause remains unconfirmed without its authenticated logs. |
| 5. Explore-specific header search | Removed with explicit user approval. Header, mobile search and autocomplete match main/Feed byte-for-byte. Keyword, tag and user search behavior is shared; secret-key blocking remains. |
| 6. Skip to content | Restored in the shared layout. First Tab/Enter focuses the content and resets nested scroll; native no-JS fragment navigation works; no extra main landmark. |
| 7. Import blocked by app hydration | Fixed. A ~6KB raw / ~2.3KB gzipped independent module enhances the SSR form. Hydration adopts the same controller/request. With 171 app scripts blocked, import still enables and submits one mocked POST. |

The shared Header still renders public Sign in / Join free controls in SSR and briefly uses them during the legacy auth-store loading transition. That existing Feed/Header behavior is unchanged; the membership fix applies to the page's invitation section. This limitation is explicitly captured in the [restoration report](membership/membership-restoration.md).

## Mobile performance: unresolved cost

Three fresh runs per revision, with other browser/typecheck work stopped, using isolated production builds and identical simulated mobile conditions:

| Metric | Main before shared shell | Current PR |
| --- | ---: | ---: |
| LCP | 2.27 s | 10.56 s |
| Total blocking time | 24 ms | 519 ms |
| JavaScript transfer | 3,398 B | 1,082,133 B |
| Decoded JavaScript | 12,815 B | 3,163,809 B |
| Script requests | 4 | 188 |
| Performance score | 90 | 43 |
| Accessibility score | 95 | 95 |

These are controlled local Lighthouse 12.8.2/Chromium measurements at 360×800 with simulated mobile throttling, gzip, unavailable public data/APIs, and blocked external connections. The LCP is text in the empty-data state. They are not live production field measurements. The large shared-runtime payload is a remaining review concern; a further change to how guest navigation/runtime initializes is needed to recover the former lightweight landing performance. See [full methodology and import resilience](performance/REPORT.md).

## Verification

- Production Cloudflare-adapter build passes on a source snapshot exactly matching the final commit.
- Type check: **0 errors / 124 existing warnings**.
- **198 focused tests pass**; after the final color-only refinement, the 41 relevant auth/import/membership tests pass again. Type-bearing code was unchanged by that refinement.
- Changed-file before/after checks find **0 introduced ESLint messages and 0 newly failing Prettier files**. Existing lint/format debt remains; no full-repository clean-lint claim is made.
- Built HTML contains real Explore content, one shared footer/title, the early import module, and the skip link. HTML/data return no-store for guest and synthetic-cookie requests, with no private marker or Set-Cookie.
- Browser tests cover permission behavior, skip navigation with/without JS, delayed membership restoration/logout, import with app chunks blocked, in-flight hydration adoption, and immediate form-removal races. Independent review found and verified the fix for a success continuation that could outrun MutationObserver teardown.
- Existing wallet/auth/payment implementation is reused. Tests use synthetic public identities/providers and do not send funds or sign events. Live data success, real payment integration, VoiceOver, native apps, and other browser engines are not certified here.

Reports: [shell checks](shell/REPORT.md), [independent review](independent-review.md), [Workers evidence](workers.md), [production headers](production-headers.json), [production rendering](production-results.json).
