# Cloudflare Workers audit — PR #919

Reviewed GitHub's latest commit-level check runs on 2026-10-26T02:19:15.542744+00:00. PR head is `970d0f485efa2693d46fa67f11d1836c5622de6e`; current `main` and PR base are `b416b7f7638d0876981ce9058bcb1bdc20d5aca7`.

**The two Workers failures predate PR #919 on the prior PR branch, while main is green.** Both `Workers Builds: frontend` and `Workers Builds: zapcooking-frontend` failed on PR #918 head, then passed on its main merge with an identical source tree. Both also passed on the two earlier main merges reviewed. This establishes a PR-head versus main result pattern; it does not establish the Cloudflare failure cause.

## Identical-code comparison

- PR #918 head: [`2d8c85dac3e6284ea6952d4385b347d2fa927cae`](https://github.com/zapcooking/frontend/commit/2d8c85dac3e6284ea6952d4385b347d2fa927cae).
- Its main merge: [`b416b7f7638d0876981ce9058bcb1bdc20d5aca7`](https://github.com/zapcooking/frontend/commit/b416b7f7638d0876981ce9058bcb1bdc20d5aca7).
- Both resolve to Git tree **`6f81a7791e0574a01747f73a402738342432ef3c`**.
- `git diff --quiet 2d8c85da b416b7f7` exits **0** (no source differences).

## Exact Workers check evidence

Times below are GitHub `completed_at` values in UTC. Cloudflare's terminal check records report identical `started_at` and `completed_at`; these values should not be interpreted as build durations. Build IDs link to the corresponding Cloudflare logs; check IDs link to the current completed GitHub check records obtained from the commit endpoint.

| Commit / context | Worker | Result | Completed UTC | Build ID / Cloudflare link | GitHub check |
| --- | --- | --- | --- | --- | --- |
| `970d0f48` — PR #919 head | frontend | **failure** | 2026-10-26T02:00:05Z | [`56665523-8878-43c0-9519-6cd08ea70bf5`](https://dash.cloudflare.com/2d2f9386809ef6f9cda581aa16dff31c/workers/services/view/frontend/production/builds/56665523-8878-43c0-9519-6cd08ea70bf5) | [121360640200](https://github.com/zapcooking/frontend/runs/121360640200) |
| `970d0f48` — PR #919 head | zapcooking-frontend | **failure** | 2026-10-26T01:59:27Z | [`80869561-edda-41fa-ad44-7071093929cf`](https://dash.cloudflare.com/2d2f9386809ef6f9cda581aa16dff31c/workers/services/view/zapcooking-frontend/production/builds/80869561-edda-41fa-ad44-7071093929cf) | [121360491408](https://github.com/zapcooking/frontend/runs/121360491408) |
| `b416b7f7` — Current main / PR #918 merge | frontend | **success** | 2026-10-26T00:48:22Z | [`3d257aac-ea4b-43da-869c-b6c74cf5e8ab`](https://dash.cloudflare.com/2d2f9386809ef6f9cda581aa16dff31c/workers/services/view/frontend/production/builds/3d257aac-ea4b-43da-869c-b6c74cf5e8ab) | [121343016034](https://github.com/zapcooking/frontend/runs/121343016034) |
| `b416b7f7` — Current main / PR #918 merge | zapcooking-frontend | **success** | 2026-10-26T00:49:13Z | [`9f8c83e9-dd43-4bb1-9b64-0a7d5c935d93`](https://dash.cloudflare.com/2d2f9386809ef6f9cda581aa16dff31c/workers/services/view/zapcooking-frontend/production/builds/9f8c83e9-dd43-4bb1-9b64-0a7d5c935d93) | [121343215883](https://github.com/zapcooking/frontend/runs/121343215883) |
| `2d8c85da` — Prior PR #918 head | frontend | **failure** | 2026-10-26T00:40:37Z | [`8eddd1fc-dc05-4b13-8b38-7e5e85448dfb`](https://dash.cloudflare.com/2d2f9386809ef6f9cda581aa16dff31c/workers/services/view/frontend/production/builds/8eddd1fc-dc05-4b13-8b38-7e5e85448dfb) | [121341142977](https://github.com/zapcooking/frontend/runs/121341142977) |
| `2d8c85da` — Prior PR #918 head | zapcooking-frontend | **failure** | 2026-10-26T00:39:10Z | [`748b6fa1-2c45-467d-9d67-10a901db5353`](https://dash.cloudflare.com/2d2f9386809ef6f9cda581aa16dff31c/workers/services/view/zapcooking-frontend/production/builds/748b6fa1-2c45-467d-9d67-10a901db5353) | [121340791723](https://github.com/zapcooking/frontend/runs/121340791723) |
| `198c665e` — Prior main / PR #917 merge | frontend | **success** | 2026-10-25T21:21:20Z | [`7a867598-713b-46a4-939d-a1c5b5af84d8`](https://dash.cloudflare.com/2d2f9386809ef6f9cda581aa16dff31c/workers/services/view/frontend/production/builds/7a867598-713b-46a4-939d-a1c5b5af84d8) | [121294860936](https://github.com/zapcooking/frontend/runs/121294860936) |
| `198c665e` — Prior main / PR #917 merge | zapcooking-frontend | **success** | 2026-10-25T21:21:09Z | [`40242869-7336-4976-b7c5-60376d57bc56`](https://dash.cloudflare.com/2d2f9386809ef6f9cda581aa16dff31c/workers/services/view/zapcooking-frontend/production/builds/40242869-7336-4976-b7c5-60376d57bc56) | [121294818102](https://github.com/zapcooking/frontend/runs/121294818102) |
| `f4615311` — Prior main / PR #916 merge | frontend | **success** | 2026-10-25T15:47:31Z | [`c2876a37-ede0-41ce-8f9e-825fe9a23bf0`](https://dash.cloudflare.com/2d2f9386809ef6f9cda581aa16dff31c/workers/services/view/frontend/production/builds/c2876a37-ede0-41ce-8f9e-825fe9a23bf0) | [121214818128](https://github.com/zapcooking/frontend/runs/121214818128) |
| `f4615311` — Prior main / PR #916 merge | zapcooking-frontend | **success** | 2026-10-25T15:48:36Z | [`19f4f57c-422b-4de8-99a1-1cd5480900a1`](https://dash.cloudflare.com/2d2f9386809ef6f9cda581aa16dff31c/workers/services/view/zapcooking-frontend/production/builds/19f4f57c-422b-4de8-99a1-1cd5480900a1) | [121215068114](https://github.com/zapcooking/frontend/runs/121215068114) |

## Other checks and limits

- PR #919 head `970d0f48`: Cloudflare Pages **success** at `2026-10-26T02:00:09Z`, deployment [`47ab53d1-b90d-40ac-b4c5-0b7f081bf25d`](https://dash.cloudflare.com/?to=/2d2f9386809ef6f9cda581aa16dff31c/pages/view/frontend/47ab53d1-b90d-40ac-b4c5-0b7f081bf25d); all five GitHub checks (`build`, `check`, `test`, `lint`, `flag-guard`) also **passed**.
- Current main / PR #918 merge `b416b7f7`: Cloudflare Pages **success** at `2026-10-26T00:49:32Z`, deployment [`49e57427-a81b-4f87-83d8-6fe646280707`](https://dash.cloudflare.com/?to=/2d2f9386809ef6f9cda581aa16dff31c/pages/view/frontend/49e57427-a81b-4f87-83d8-6fe646280707); all five GitHub checks (`build`, `check`, `test`, `lint`, `flag-guard`) also **passed**.
- Both failed Workers checks expose only their build ID and script/dashboard links in GitHub; `output.text` is null and both annotations endpoints return `[]`. Authenticated Cloudflare build logs were not accessed, so no failure reason is asserted.
- Legacy commit-status endpoints have zero status entries for head and main. Their aggregate `pending` value is the empty-status default, not an additional running check; all eight check runs on each commit are completed.
- Data came from `/commits/<full-sha>/check-runs?per_page=100&filter=latest`, not a previously captured in-progress check ID. No reruns, deployments, credentials, repository settings, or product files were changed.

Machine-readable evidence: `workers.json`. Individual compact API responses are stored alongside this report as `workers-*-checks.json`, with separate legacy-status and failed-check annotation responses.
