# Start Section — screenshot baselines

Visual baselines for the start-section feature (setting + Explore announcement
+ Explore feed-jump card). Captured against `pnpm dev` on 2026-10-02, logged
out, with a fresh browser profile (`zapcooking_start_section` and
`zapcooking_start_section_prompt_dismissed` absent from localStorage).

| File | State captured | Viewport |
| --- | --- | --- |
| `explore-announcement.png` | First visit to `/explore`: one-time announcement with the sparkle "New" badge and the Explore / Feed / Recipes pills (globe / flame / fork-and-knife) | 1280×800 |
| `explore-announcement-mobile.png` | Same first-visit state on a phone-width viewport | 390×844 |
| `explore-feed-jump.png` | After choosing Explore (announcement retired): the "Join the conversation" jump card above "Fresh from the Kitchen" | 1280×800 |
| `settings-start-section.png` | Settings → Appearance → Start section pills, Explore selected | 1280×800 |

Not captured: the composer FAB's reordered menu (New post → New recipe → New
read) — the floating create button only renders for signed-in sessions.

## Regenerating

1. `pnpm dev`
2. In a fresh browser profile (or after removing the two localStorage keys
   above), open `/explore` and screenshot the announcement.
3. Click a pill, wait for the toast to auto-dismiss, screenshot the feed-jump
   card; then capture `/settings` scrolled to the Appearance section.
