# Explore promises: Lighthouse accessibility comparison

All runs use Lighthouse 12.8.2 with Chromium and the same deterministic local test fixture, rendered from each source revision. These are not production/live content measurements. No new repository dependencies were added.

| Theme | Width | origin/main | PR #916 base | Promises change |
| --- | ---: | ---: | ---: | ---: |
| light | 360 | 96 | 96 | 96 |
| light | 1440 | 96 | 96 | 96 |
| dark | 360 | 96 | 96 | 96 |
| dark | 1440 | 96 | 96 | 96 |

No accessibility score regression. The final page has exactly the same failing audit nodes as its stacked PR base after normalizing Svelte-generated class hashes. The new promises, tagline and proof row have no failing nodes.

Existing contrast failures left untouched: light-mode header search button, import submit button and import membership link; dark-mode import submit button. The main baseline also has recipe-pack accessible-name mismatches, already removed in PR #916.

Actual VoiceOver behavior is not verified by Lighthouse; it still needs a macOS/iOS check.

Artifacts: per-case *.lighthouse.json and *.lighthouse.html; comparison.json; source provenance JSON; render-a11y.mjs and lighthouse-audit.mjs in the parent directory.