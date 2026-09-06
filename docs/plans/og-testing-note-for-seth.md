# Note for Seth — testing PR #634 (OG social cards)

Paste-ready message + testing steps for
[zapcooking/frontend#634](https://github.com/zapcooking/frontend/pull/634).

---

Heads up on #634 — the important bit for testing.

The bug: our OG tags were only served to user-agents on a hardcoded crawler
allowlist. No Nostr client is on that list, so Amethyst, Primal, Damus etc.
all got the placeholder card ("Recipe" + the logo) instead of the real title
and photo. Since our links get shared on Nostr more than anywhere, that was
the audience we were missing. This PR drops the UA gate and injects the
resolved tags into the normal page for everyone.

**When you test it, use a non-crawler UA.** Testing with
`facebookexternalhit` will pass on main too and prove nothing — that path
already worked.

```bash
URL="https://<deploy>/r/naddr1qvzqqqr4gupzpmnw5yatnljuff5w47d35d87q99xddqpzlzsac4xzn6vm22ekmn5qq2hg6r994sku7t5dp5kueeddakk2mr9w36x2v5zva6"

curl -s -A "Amethyst/1.0" "$URL" | grep -E 'og:(title|image)'
curl -s -A "Amethyst/1.0" "$URL" | grep -c 'property="og:title"'   # must be 1
```

Before: `og:title` = "Recipe", `og:image` = social-share.png.
After: "The Anything Omelette" + the real photo, exactly one tag set.

Also worth a look: `/note1…`, `/reads/…`, `/npub1…`, and that a normal
browser still renders the page fine.

The real end-to-end test is posting a recipe link in a Nostr client and
seeing the card — that's the one I couldn't run, and it's the original
symptom, so it's the one that actually matters.

Two things to know going in: this adds roughly 300ms to SSR on those routes
(relay resolution), but it also removes `no-store`/`Vary: User-Agent`, so
those pages become edge-cacheable, which should more than pay it back. And
`/s/` shortlinks still return a bare 302 with no tags — most fetchers follow
the redirect so it's fine in practice, but making them self-describing is a
separate call since it'd cost humans redirect speed.

---

## Background (not for the message — context if asked)

**Root cause.** Recipe/note/reads/profile pages derive OG from a
*client-fetched* event (no `+page.server.ts`, deliberately — that caused
#454). During SSR the event is null, so the page emits static placeholders.
The real metadata only existed inside `maybeRenderBotOg`, gated on
`isCrawler()` — a ~30-entry UA regex in `recipeOgHtml.server.ts`.

Evidence, same URL on production before the fix:

| UA | `og:title` | `og:image` |
|---|---|---|
| `facebookexternalhit/1.1` | "The Anything Omelette" | the real photo |
| `Amethyst/1.0` | "Recipe" | social-share.png |
| `Primal` | "Recipe" | social-share.png |
| `Mozilla/5.0` | "Recipe" | social-share.png |

This is also why the earlier round of work
(`docs/plans/og-missing-images-fix.md` — image dimensions, NIP-92 `imeta`
detection) didn't fix the reported symptom: it improved the *contents* of a
branch Nostr clients never entered.

**Why not widen the regex.** Whack-a-mole — many preview fetchers send a
generic UA or none, indistinguishable from a browser.

**Commits.**
- `bff2685e` — drop the UA gate, inject resolved tags for everyone
- `e1dd1e39` — hardening: guard `buildOgTagBlock`, and skip
  `article:published_time` for out-of-range `created_at` (`toISOString`
  throws a RangeError past ±8.64e15 ms, so one bad relay timestamp could
  500 a page)

**Unrelated, do not chase.** While testing on the dmnyc fork I hit
intermittent 500s on recipe routes. Those reproduce with this branch fully
reverted — a pre-existing failure on that fork's `vercel` branch (198
commits behind `main`; history has form here, see `e3e79733` "remove
OG-only server loads to stop profile/recipe 500s (#454)"). Not caused by
this PR, and fork-specific.
