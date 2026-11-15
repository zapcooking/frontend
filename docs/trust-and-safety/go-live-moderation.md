# Go live: rollout and moderation process

> Part of the trust and safety governance framework. Start at [README.md](README.md).

This page describes how hosting is opened, how reports are handled and
what is recorded. It covers PR #977, which folds in the report and hold
design of draft PR #976. Every admin control is on **/admin/live**, signed
with the admin account (NIP-98). Every admin action is written to the
**action log** with its time and actor. Nothing is ever ended or blocked
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
  `approved`.
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
- The admin is DMed about new requests, at most one DM every 10 minutes.
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

Anyone watching can report a stream. The chat asks for sign-in before it
offers to report a comment. The reasons are: child safety, violence or
immediate danger, nudity or sexual content, spam, and other.

Each report:

1. **Is stored with the session** (`live_reports`). Each reporter can file
   one report per target (the stream, or one comment).
   - A reporter is identified only by a **keyed hash** of their IP
     address: HMAC-SHA256 with a server-side secret
     (`LIVE_REPORTER_HASH_SECRET`, different per environment), over the
     rate limiter's daily-salted hash. The address itself is never
     stored. Without the secret, nobody can work back from a stored id
     to an address, even with the database and KV together.
   - If the secret is missing, reports are refused and logged. An
     unkeyed hash is never stored.
2. **Opens a hold** on the session (`live_holds`), with a snapshot of the
   session's public facts at the first report. The Cloudflare input id is
   never part of the snapshot.
   - A new report on a released case reopens it.
3. **Alerts the admin** by encrypted DM within seconds, with the reason,
   the title and links. Nothing about the reporter is included.
   - At most one alert per stream every 10 minutes, except **child safety
     and violence, which always alert**.

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
| Access requests | Pending: until decided. Approved or declined: 90 days after the decision |
| Approved and blocked lists | Until changed by the admin (a block survives account deletion) |
| Action log | 2 years; entries about a session under an open hold are kept until it is released |

Account deletion removes the host's sessions **except those under an open
hold**.

**For the policy PR:**

- Privacy must state the 2-year action log, which holds account keys.
- It must state the access-request queue: the key, the note, and the
  decision, kept until decided and then 90 days.
- It must state that a reporter is stored as a keyed hash of their IP
  address (never the address), with the 90-day report retention.

## 5. Before production

- Apply migration `0007_live_rollout_and_safety.sql` to preview, then
  production (see `migrations/scheduler/APPLIED.md`).
- Set `NOTIFICATION_PRIVATE_KEY` on every environment that should send
  report alerts and access-request DMs.
- Set `LIVE_REPORTER_HASH_SECRET` on every environment, with a different
  value in each. Reports are refused without it.
- Have counsel review the policy text (Terms, Privacy, Child Safety) for
  the behaviour described here.
