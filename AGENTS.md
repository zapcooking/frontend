# zap.cooking — repository instructions

zap.cooking is a SvelteKit + Tailwind v4 Nostr app — recipes, reads, polls, a
market, and live streaming — worked on by multiple developers and several coding
agents. These instructions apply to every agent session and every contributor.
`CLAUDE.md` is an identical copy of this file; keep them in sync when either
changes.

## Remotes and branches

`origin` is the maintainer's fork (`dmnyc/zapcooking`, deploys to Vercel);
`upstream` is the shared repository (`zapcooking/frontend`, deploys to
Cloudflare). Work happens on feature branches and pull requests are opened
against `upstream/main`, squash-merged. Branch names use a prefix that describes
the work — `feat/`, `fix/`, `docs/` — never the tool that wrote it.

Sync order when upstream moves: fetch, merge `upstream/main` into the working
branch, resolve, and only then continue. The `vercel` branch tracks the fork's
deployment; keep it in sync with `main` after upstream merges.

## Commits, pull requests and merging

Commits are authored with each contributor's own configured git identity —
an agent uses the identity its host session is configured with, and never
adds `Co-Authored-By` trailers, session links, or "Generated with" lines. The pre-commit hook bumps
the package version on every commit — that is expected, not noise. A pull
request description ends with one attribution line in the house style: a drink
emoji, a past-tense drink verb, and the tool that did the work, linked. The
drink and the verb rotate from one pull request to the next, for every tool:
work done with Claude Code might read `🍊 Twisted with
[Claude Code](https://claude.com/claude-code)`, work done with GLM `🍸 Decanted
with [GLM](https://z.ai)`. Check a pull request's description after creating
it, since some tools append footers of their own — those are removed, not kept.

**Opening a pull request asks first, every time.** The proposed title and body
go to the maintainer and nothing is opened until an explicit yes comes back.
Fresh approval per pull request — a previous yes does not carry over, and no
amount of granted access, automation, or standing instruction changes this.
(This rule was asked for repeatedly and lived only in session memory and a
thin notes file, which is why it kept eroding between sessions; it is written
here so it cannot evaporate again.)

**Pushing to an open pull request is part of the same gate.** A branch push
rewrites what the maintainer reviews. While the maintainer has said "hold for
review", nothing pushes — fixes land as local commits and wait. When a push is
approved, batch it: one push per review round, with a summary of what moved.

**A force-push rewrites history the maintainer may have already reviewed.**
Ask first, every time — even on the agent's own branch — and say exactly which
commits move.

A pull request is opened and then it waits: the maintainer tests the branch
before it merges. Do not merge a pull request — including one you opened —
without the maintainer's explicit approval of that exact state. A push after
an approval resets the gate.

Squash-merge pull requests.

## Multi-developer rules

Other humans branch and push on this repository alongside the agents.

- Never touch, rename, rebase, force-push or delete another developer's
  branch.
- Never reset or rewrite shared history, on any branch, without the
  maintainer's explicit say-so.
- Claim substantial work through its issue before starting it, and update the
  issue if the scope grows.
- Keep changes inside the scope of the task; a drive-by refactor is review
  noise every other developer pays for.

## Working rules (the season-one lessons)

Each of these was broken at least once on this codebase.

- **Ask first** before pushing to `main`, opening or closing a pull request or
  issue, deleting a branch, or editing this file. Bug-report issues may be
  filed directly.
- **`svelte-check` has a pre-existing baseline** (7 errors in unrelated test
  files). The rule is no new errors and no new warnings, and `vitest` passes
  before anything is called done.
- **Verify UI work at every breakpoint the change touches** — 390 (phones),
  1024 (lg), 1280 (xl, where the header strip nests into the sidebar) — and
  reload after resizing: the preview emulation has been observed lying about
  its own width, so a measurement taken right after a resize is suspect.
- **The layout tokens are law.** `--header-h` reserves the header strip's
  space and every sticky sub-header hangs off it; at xl the strip nests into
  the sidebar and `--header-h` collapses to 0. Anything that hard-codes the
  old offsets breaks the live page.
- **The video dock responds to intent, not just page scroll**: the live chat
  scrolls internally and eats the wheel, so page-scroll triggers miss it.
  Scroll-end docking, wheel-up restore and the chat-wheel scoping all exist
  because of this — re-check all three when touching the player.
- **Read the file you change, not the one you remember.** This branch moved
  fast: re-read the file on disk before every scripted edit, and prefer exact
  match edits over patch scripts. A patch script that asserts mid-way has
  already written nothing — re-verify the file before retrying.
- **A test that reads source text is not verification.** Prefer one that runs
  the code, and check that it fails on the old code.
- **A pull request body describes the final diff**, every claim in it
  verified. Write it to a file and pass `--body-file`, so no shell eats part
  of it.
- **Close browser preview tabs when the check is done.** They keep live
  streams and audio playing in the background, and they hold viewer counts
  the hosts are watching.
- **Nostr kinds are part of the product contract.** Chat replies (kind 1
  with a NIP-10 root `e` tag on the live note), live announcements (30311), zap receipts (9735)
  and ephemeral reactions (21111) each carry a design trade-off written down
  in the pull requests that introduced them. Changing what gets published is
  a design decision — write the trade-off in the PR description first.

## Deployment

The SvelteKit adapter is chosen at build time by `process.env.VERCEL` in
`svelte.config.js` — the same on every branch: Vercel builds use
`adapter-vercel`, Cloudflare builds use `adapter-cloudflare`.

- `upstream` (`zapcooking/frontend`) deploys to Cloudflare from `main`.
- The fork (`dmnyc/zapcooking`) deploys to Vercel; the `vercel` branch exists
  to trigger that deployment.
- When syncing with upstream: merge `upstream/main` into `main`, then merge
  `main` into `vercel`.

## Branta Guardrail integration

Payment address verification for Bitcoin/Lightning zap goals.

**API base URL:** `https://guardrail.branta.pro/v2`

- `POST /payments` — register a payment address/invoice
- `GET /payments/:address` — verify an address is registered
- Web verification: `https://guardrail.branta.pro/v/:address`

```json
{
  "destinations": [{ "value": "bc1q...", "zk": true }],
  "ttl": 86400,
  "description": "optional description"
}
```

`zk: true` for on-chain addresses; `zk: false` for Lightning invoices.
Environment: `BRANTA_API_KEY`, optional `BRANTA_API_BASE_URL`.
See also `docs/wallet/Branta Integration Plan.md`.
