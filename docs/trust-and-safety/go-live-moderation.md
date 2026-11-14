# Go live: rollout and moderation process

This page describes how hosting is opened, how reports are handled and
what is recorded. It covers PR #977, which folds in the design of draft
PR #976. Every admin control is on **/admin/live**, signed with the admin
account (NIP-98). Every admin action, and every automatic one, is written
to the **action log** with its time and actor.

## 1. Staged rollout

| Mode | Who may start a stream |
|---|---|
| `approved` (default) | Active Cook+ members on the **approved hosts** list |
| `members` | Any active Cook+ member |

In both modes, an account that is blocked or temporarily suspended cannot
host.

- The mode is changed on /admin/live, with no deploy. The change is logged
  (`mode`, with old and new value). It is stored in KV and can take about a
  minute to reach every location. A missing or unreadable value means
  `approved`.
- Approving and removing hosts is logged (`approve`, `unapprove`).
  Removing a host does not end a stream already running; to stop one, use
  **End** or **Block**.
- A member who is not on the list sees "Live hosting is rolling out" and a
  **Request access** button.
  - The request is signed by the member and sent to the admin account as a
    DM. It contains the member's npub, a profile link, and the name and
    NIP-05 from their own profile (unverified).
  - No queue is kept, and each account can send one request a day.
  - Approve the account on /admin/live.
- Non-members see Go live with a **Cook+** label, which leads to the
  membership page.
- Recommended order: approve a few hosts, watch the reports and the action
  log, widen the list, and only then switch to `members`.

## 2. Reports

Anyone watching can report a stream. The chat asks for sign-in before it
offers to report a comment. The reasons are: child safety, violence or
immediate danger, nudity or sexual content, spam, and other.

Each report:

1. **Is stored with the session** (`live_reports`). Each reporter can file
   one report per target (the stream, or one comment).
   - A reporter is identified only by a daily-salted hash of their IP
     address. The address itself is never stored.
2. **Opens a hold** on the session (`live_holds`), with a snapshot of the
   session's public facts at the first report. The Cloudflare input id is
   never part of the snapshot.
   - A new report on a released case reopens it.
3. **Alerts the admin** by encrypted DM within seconds, with the reason,
   the title and links. Nothing about the reporter is included.
   - At most one alert per stream every 10 minutes, except **child safety
     and violence, which always alert**.
4. **Automatic end: off unless `LIVE_SAFETY_AUTO_END` is `true`.** When
   on, 3 different reporters of the stream (comment reports don't count)
   end it and suspend the host from going live for 1 hour. This is logged
   as `auto_end` by `system`.
   - Reporters are IP hashes, not verified people, so keep this off until
     it has been tested against abuse.

Streams are **not recorded**. Evidence means the session record, the
snapshot, the reports, the "Live now" note and its public comments on
Nostr, and the action log.

## 3. Reviewing a report

1. Open the alert's link. If the stream is still live, watch it.
2. If the report is credible: **End** the stream and, if warranted,
   **Block** the host. Blocking also ends the host's open session at once.
3. Child safety: follow the Child Safety Standards (/child-safety), and
   report to NCMEC where required. **Do not release the hold**, and seek
   legal advice before deleting anything.
4. When the case is closed and nothing must be kept for legal reasons,
   **Release hold**. The release is logged (`release_hold`).
5. Admin hides and unhides of commenters are logged (`hide`, `unhide`).

## 4. What is kept, and for how long

| Record | Kept |
|---|---|
| Session row (no report) | 30 days after the stream ends |
| Session row with an open hold | Until the hold is released |
| Reports | 90 days after the report; while a hold is open, until it is released |
| Session row after a released hold | Until its reports age out, then the 30-day rule |
| Hold | While open; a released hold is removed once its reports are gone |
| Temporary suspension | Until it expires |
| Approved and blocked lists | Until changed by the admin (a block survives account deletion) |
| Action log | Kept; no automatic deletion |

Account deletion removes the host's sessions **except those under an open
hold**.

## 5. Before production

- Apply migration `0007_live_rollout_and_safety.sql` to preview, then
  production (see `migrations/scheduler/APPLIED.md`).
- Set `NOTIFICATION_PRIVATE_KEY` on every environment that should send
  alerts and access requests.
- Leave `LIVE_SAFETY_AUTO_END` unset.
- Have counsel review the policy text (Terms, Privacy, Child Safety) for
  the behaviour described here.
