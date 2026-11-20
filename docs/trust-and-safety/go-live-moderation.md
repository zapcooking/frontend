# Go live: rollout and moderation process

> Part of the trust and safety governance framework. Start at [README.md](README.md).

This page describes how hosting is opened, how reports are handled and
what is recorded. It covers PR #977, which folds in the report and hold
design of draft PR #976. Every admin control is on **/admin/live**, signed
with an admin account (NIP-98): the primary or the backup admin, both
listed in `ADMIN_PUBKEYS` and with the same powers. Every admin action is
written to the **action log** with its time and actor (the key that
signed it, so the backup's actions show the backup's key). Nothing is ever ended or blocked
automatically: a person decides.

## 1. Staged rollout

| Mode | Who may start a stream |
|---|---|
| `approved` (default) | Active Cook+ members on the **approved hosts** list |
| `members` | Any active Cook+ member |

In both modes, an account that is blocked cannot host.

- The mode is changed on /admin/live, with no deploy. The change is logged
  (`mode`, with old and new value). It is stored in KV and can take about a
  minute to reach every location. A missing or unreadable value means
  `approved`. /admin/live shows the mode last switched to, from the action
  log, with "Applying everywhere" until KV catches up. Any admin action
  that fails shows an error banner.
- Preview and production share one KV namespace, so every Go live key is
  named per environment from `LIVE_INPUT_PREFIX`:
  - production: `live:off`, `live:hosting_mode`, `live:alert:<id>`,
    `live:access-alert`
  - preview: `live:preview:off`, `live:preview:hosting_mode`, and so on
  A switch on preview never reaches production.
- Approving and removing hosts is logged (`approve`, `unapprove`).
  Removing a host does not end a stream already running; to stop one, use
  **End** or **Block**.
- Non-members see Go live with a **Cook+** label, which leads to the
  membership page.
- Recommended order: approve a few hosts, watch the reports and the action
  log, widen the list, and only then switch to `members`.

### Access requests

- A member who is not on the list sees "Live hosting is rolling out".
  They can **request access** with an optional note, up to 280
  characters: "what would you cook, and how often?".
- The request is saved in a queue, with one open request per account, and
  the member then sees "Request sent".
- Both admins are DMed about new requests, at most one DM each every 10 minutes.
  The DM says how many are pending.
- /admin/live lists pending requests with the requester's profile, note and
  membership status.
  - **Approve** adds the account to the approved list. It is logged as
    `approve`.
  - **Decline** is logged as `decline`. A declined account can ask again
    30 days after the decision.
  - Approving an account directly also closes its pending request.
- The status the host page reads (`GET /api/live/hosting`) is signed, and
  answers only about the signed-in account. It never answers about another
  account, and never shows a block.

## 2. Reports

Anyone watching can report a stream, with no account. The chat asks for
sign-in before it offers to report a comment, and (from #987, Seth's
ruling) the server requires a NIP-98 signature on every comment report
(401 `auth_required` without one). The signature is checked, never stored
or sent: the reporter is still only the keyed IP hash. The reasons are: child safety, violence or
immediate danger, nudity or sexual content, spam, and other.

Each report:

1. **Is stored with the session** (`live_reports`). Each reporter can file
   one report per target (the stream, or one comment).
   - Exception: a **child safety** or **violence** report is always
     stored, even when the same reporter already reported that target
     for another reason. It is kept under the reporter's id with the
     reason added, so the same reporter can be recognised.
   - Each urgent reason is stored once per reporter per target, and
     **every** urgent submission alerts the admin, even an identical
     repeat.
   - A reporter is identified only by a **keyed hash** of their IP
     address: HMAC-SHA256 with a server-side secret
     (`LIVE_REPORTER_HASH_SECRET`, different per environment), over the
     rate limiter's daily-salted hash. The address itself is never
     stored. The id is pseudonymous: without the secret, linking it to an
     address is impractical; with the secret and that day's salt (kept 3
     days), someone could test whether a given address reported.
   - If the secret is missing, **nothing is stored**: an unkeyed hash is
     never written. The admin is still DMed for every report, never
     throttled and marked "NOT STORED" (reason and stream link only). The
     reporter is asked to email support@zap.cooking, and the error is
     logged. No report, above all a child-safety one, is lost silently.
2. **Opens a hold** on the session (`live_holds`), with a snapshot of the
   session's public facts at the first report. The Cloudflare input id is
   never part of the snapshot.
   - A new report on a released case reopens it.
3. **Alerts both admins** (primary and backup, one DM each) by encrypted DM within seconds, with the reason,
   the title and links. Nothing about the reporter is included.
   - At most one alert per stream every 10 minutes, except **child safety
     and violence, which always alert**.

Streams are **not recorded** (inputs are created with recording off).
Reports never end a stream automatically, however many there are (the
sweep's 90-minute and disconnect rules are unrelated to reports).
Evidence means the session record, the
snapshot, the reports, the stream's public chat on Nostr, and the action
log. The chat is NIP-53 live chat: kind 1311 events tagged
`["a", "30311:<host pubkey>:<session id>"]`, an address rebuilt from the
snapshot's `host_pubkey` and `id` (every session has one, with or without
a "Live now" note). When the session has a note (`note_id` in the
snapshot), the note and the kind 1 replies to it are part of the chat too.
A comment report stores the reported event's id, which may be of either
kind.

## 3. Reviewing a report

1. Open the alert's link. If the stream is still live, watch it.
2. If the report is credible: **End** the stream and, if warranted,
   **Block** the host. Blocking also ends the host's open session at once.
3. Child safety: follow the Child Safety Standards (/child-safety). A
   CyberTipline report is a legal duty under 18 U.S.C. § 2258A when the
   facts give actual knowledge of an apparent violation; it does not wait
   for certainty, and it is separate from the moderation decision (End,
   Block). Report as soon as reasonably possible (see
   cybertipline-reporting.md).
4. **Legal preservation** (a CyberTipline report, legal process, or advice
   from counsel): **do not release the hold.** Note the reason and the end
   date (after a CyberTipline report, generally one year from submission)
   in the private runbook, and export anything the hold does not cover
   before it expires: Reads/Nourish reports in KV, the access request,
   hidden-commenter rows, and the public chat from relays (kind 1311 on the
   session's address, plus the note and its kind 1 replies when there is a
   note). The code
   has no separate legal-hold lock yet (data-retention.md, "Review holds
   vs legal preservation").
5. When the case is closed and nothing must be kept for legal reasons,
   **Release hold**. The release is logged (`release_hold`).
6. Admin hides and unhides of commenters are logged (`hide`, `unhide`).

### Tested admin response and preservation procedure

The approved-host pilot has already exercised the admin reporting flow in Preview (PR #977). **The review hold is an implemented control, not just a written policy.** This procedure is for operators and must be repeated after material changes.

1. **Receive alert.** A viewer reports the live stream (or comment). The service stores the report in `live_reports`, opens/reopens the `live_holds` review hold, and captures a snapshot of the session's public facts. It sends the primary and backup administrators encrypted Nostr DMs; urgent child-safety/violence reports bypass ordinary throttling. If the hash secret is missing, the report **cannot be stored** and the notification is marked **NOT STORED**: escalate immediately and do not assume preservation occurred.
2. **Confirm preservation.** Sign in to `/admin/live` with an authorized administrator key, locate the reported session, and verify the report and **open** hold are displayed. Record the incident reference, verification time, owner and escalation status in a **restricted incident register outside GitHub**. The stream snapshot deliberately excludes Cloudflare's input UID; video is not recorded.
3. **Intervene when warranted.** Review the report promptly. Use **End** to terminate the active stream; use **Block** when hosting must be restricted (Block ends an ongoing stream). Verify playback ends and the host cannot restart while blocked. A report by itself does **not** automatically end the stream.
4. **Keep evidence protected.** As long as the review hold remains **open**, `live_sessions` metadata, `live_reports`, associated action-log records and the session snapshot are exempt from ordinary cleanup and the host account-deletion purge. Test this explicitly following significant modifications to the sweep or account deletion code.
5. **Assess legal preservation separately.** Where child safety, a CyberTipline report, legal process, or counsel requires longer preservation, **do not press Release hold**. Record the preservation basis, authorized owner, relevant dates (including the CyberTipline submission date), applicable deadline and covered records in the restricted register; preserve relevant out-of-scope records before their own TTLs expire. Closing moderator review is **not** authorization to discard legally required evidence. The current app has no separate code-enforced legal lock.
6. **Release only after authorization.** A designated administrator confirms in the restricted register that review is complete and **no legal preservation obligation remains**. Only then use **Release hold** and verify the `release_hold` action appears in the log. Releasing resumes normal retention; it must not be used simply because a stream has ended.

**Existing test evidence (PR #977):** branch-preview checks covered viewer stream reports, urgent child-safety reporting/DM throttling bypass, comment reporting, keyed reporter identifiers, hold opening and release, admin actions and logging, stream ending and host blocking. These tests do not establish that a separate legal hold exists; that remains an operational preservation procedure.

## 4. What is kept, and for how long

| Record | Kept |
|---|---|
| Session row (no report) | 30 days after the stream ends |
| Session row with an open hold | Until the hold is released (never while legal preservation applies) |
| Reports | 90 days after the report; while a hold is open, until it is released |
| Session row after a released hold | Until its reports age out, then the 30-day rule |
| Hold | While open; a released hold is removed once its reports are gone |
| Access requests | Pending: until decided. Approved or declined: 90 days after the decision |
| Approved and blocked lists | Until changed by the admin (a block survives account deletion) |
| Hosting agreement (18+ and the Terms, per terms version) | Until the account is deleted; kept while one of its sessions is under an open hold or the account is blocked from hosting |
| Action log | 2 years; entries about a session under an open hold are kept until it is released |

Account deletion removes the host's sessions **except those under an open
hold**, and the host's hosting agreement on the same terms.

Hosts agree before going live ("I'm 18+, agree and go live"), once per
account per `LIVE_TERMS_VERSION` (`src/lib/live/config.ts`). Bump the
version when Terms §2.4 or the Live Stream Conduct rules change: every host
is asked again on their next stream, and the create route refuses with
`terms_required` until they agree.

**For the policy PR** (done in #985: Privacy §1.7 and §9, Child Safety §6–§7, /delete-account):

- Privacy must state the 2-year action log, which holds account keys.
- It must state the access-request queue: the key, the note, and the
  decision, kept until decided and then 90 days.
- It must state that a reporter is stored as a keyed hash of their IP
  address (never the address), with the 90-day report retention.
- It must describe the anonymous "watching now" heartbeat, and the peak
  and joins counts kept after the stream. Proposed line:
  "While you watch a live stream, your browser sends a signal about every
  30 seconds with a random code that is new each time you open the page,
  so we can show how many people are watching. The code is not linked to
  your account, key, IP address or device, is not saved in your browser,
  and is forgotten about a minute after the last signal. After the stream
  we keep two numbers for the host: the most people watching at once and
  the total number of joins. Your IP address is used briefly to limit
  abuse of this signal and is not stored."

**For the next policy PR (Live metrics, migration 0010; opened as #994, with counsel):** Privacy §9 currently says stream records are deleted 30 days after the stream and that audience totals are seen only by the host. With 0010 both change:

- "What we keep about a stream" should add "the total time viewers spent watching and the sats zapped to the stream" (zaps to the host's "Live now" note and zaps to the stream's address, `30311:<host pubkey>:<session id>`, each payment counted once).
- "Totals" should say that Zap Cooking's admins also see them, to run the service and estimate its costs.
- A new line for the monthly summary. Proposed: "For each host we also keep a monthly summary for running the service: how many streams they hosted, for how long, the total time viewers spent watching, the most viewers at once and the sats zapped. It holds nothing about any viewer. We keep it for 24 months and delete it when the host asks us to delete their account."
- /delete-account: the monthly summary is deleted with the account.

## 5. Before production

- One Cloudflare rate-limiting rule (the plan allows one): the existing join rule is extended to cover `/api/live/*/join`, `/api/live/*/heartbeat` and `/api/live/*/watching`. Seth edits it in the dashboard (#984).
- Apply migration `0007_live_rollout_and_safety.sql` to preview, then
  production (see `migrations/scheduler/APPLIED.md`).
- Live metrics: land the Privacy §9 lines above (#994) before migration
  `0010_live_metrics.sql` reaches production.
- Set `NOTIFICATION_PRIVATE_KEY` on every environment that should send
  report alerts and access-request DMs.
- Set `LIVE_REPORTER_HASH_SECRET` on every environment, with a different
  value in each. Without it, reports are not stored; they only reach the
  admins by DM.
- Have counsel review the policy text (Terms, Privacy, Child Safety) for
  the behaviour described here.
