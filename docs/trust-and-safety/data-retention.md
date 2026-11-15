# Privacy and retention alignment

**Draft; public disclosures must be checked against deployed code and vendor terms.**

Public text for these rows: Privacy Policy §1.6, §1.7 (reports, every surface), §9 (Live video) and §12 (Data Retention); Terms §2.4 and "Live Stream Conduct" in §4; Child Safety Standards §4, §6, §7 and §9; and the Go live exceptions on /delete-account (live-streaming policies PR, pending counsel review). Change the code and the public text together.

| Category | Proposed normal retention | Exceptions / verification |
| --- | --- | --- |
| Stream metadata (host pubkey, title, recipe, start/end, end reason, guest counts, peak watching and total joins, total viewer time, zap total, announcement note ID) | 30 days | Preservation/legal hold |
| Monthly per-host Live metrics (`live_host_monthly`: host pubkey, month, streams, seconds streamed, longest stream, viewer seconds, peak watching, sats zapped; migration 0010) | 24 months (the current month counts as one; the sweep deletes older months) | Deleted at the host's account-deletion request; rows kept under a hold are then never folded in. Admin-only (`/admin/live/metrics`). Survives the 30-day session purge on purpose. Public text in #994 (Privacy §9 and §12, /delete-account; with counsel); 0010 reaches production only after it is live |
| "Watching now" heartbeat codes | About 60 seconds after the last heartbeat | Held only by the session's counter (memory plus its own short-lived storage); never in D1, KV, browser storage or logs (see below) |
| The session counter's totals (peak, viewer time) | Until the sweep records them on the session row (about 5 minutes after the end), at most 2 days after the last heartbeat | Two integers in the session's presence Durable Object; nothing per viewer |
| Reports, report text and IP-derived anti-abuse identifier | 90 days | Preservation/legal hold. The Go live identifier is a keyed hash (see below, settled in #977) |
| Host restrictions (blocks) and hidden-commenter state | Until removed | Periodic necessity review; a block is not lifted by account deletion |
| Approved-hosts list | Until the host is removed | Periodic necessity review |
| Hosting access requests (pubkey, optional note, decision) | Pending: until decided. Approved or declined: 90 days after the decision | Set in #977 and deleted by the sweep. Not removed by the account-deletion purge; it follows this schedule. Disclosed in Privacy §9 and on /delete-account |
| Hosting agreement (`live_terms_acceptance`: pubkey, terms version, time; migration 0009) | Until the account is deleted; one row per terms version agreed to | Deleted at the account-deletion request, unless one of the host's sessions is under an open hold or the account is blocked from hosting (Seth's ruling, #985); the sweep then deletes it once neither is true (`cleanupTermsAcceptances`). An agreement made after the deletion request is kept. A statement by the host, not age verification. Disclosed in Privacy §9 ("Hosting agreement") and on /delete-account |
| Moderation action log (actor, action, target pubkey, time) | 2 years | Longer while a related hold is open |
| Review holds (`live_holds`) and session snapshots | Until released | Internal moderation hold, opened by the first report on a session. Released only by a logged admin action; the related records then follow their normal schedule |
| Legal preservation (CyberTipline report, legal process, other duty) | As long as required; after a CyberTipline report generally 1 year from submission (§2258A(h)) | **Process, not code** (see "Legal preservation" below). Not ended by releasing a review hold or by account deletion |
| Public replies and zap receipts on Nostr | Network-dependent | Zap Cooking cannot promise deletion across independent relays |
| Live video | Not recorded by us | Every input is created with `recording: { mode: 'off' }` (`src/lib/live/stream.server.ts`). Cloudflare's WebRTC page says WHIP inputs are "not currently eligible for recording" and "Recording ... not yet supported" (developers.cloudflare.com/stream/webrtc-beta, read 2026-11-15). Its Stream Live overview still says "All Stream Live videos are automatically recorded" — a vendor-doc contradiction to confirm with Cloudflare. Transient processing/buffering during delivery is Cloudflare's, under its terms; the public text claims nothing about it |

No *application-level per-viewer records* are proposed. Do not claim 'no viewer data' if delivery/security providers receive IP addresses or other connection data. Confirm whether browser membership checks, signed passes, web analytics, rate limiting or server/proxy logs collect identifiable information.

**Go live "watching now" count (#984):** live streams show how many people are watching, from 1 up. This relaxes the earlier "no view counts" rule for live streams only.
- The watch page sends a heartbeat about every 30 s while the stream plays in a visible tab. It carries one random code made fresh on every page load and kept only in the page's memory: never in browser storage, and never sent with an account, a key or a signature. The host is not counted.
- A Durable Object per session counts the distinct codes heard in the last ~60 s. It keeps each code in memory and in its own storage (so a Cloudflare restart does not empty the count), and an alarm deletes each code about a second after it expires; when none are left the object's storage is wiped. Nothing about a heartbeat reaches D1, KV or logs. (Changed on Seth's ruling 2026-11-15: the count should err high rather than blink during a restart.)
- Rate limit: the sender's IP address goes to that object for the limit only, where it is hashed with a random salt that exists only in the object's memory, and kept in memory (never stored) for one minute with two counters (heartbeats and new codes). It is never linked to a code.
- After the stream, two integers stay on the session row: the peak watching count and total joins (viewers the play relay admitted, members and guests together, not counting rejoins on a pass or the host). They are shown only to the host, and are deleted with the row (30 days, or later under a hold).

**Go live metrics (migration 0010):**
- Viewer time: each heartbeat of a code already counted adds the time since that code's previous heartbeat (capped at 60 s) to one running total in the session's Durable Object. Nothing per viewer or per code is added. When the last code expires the object keeps only the peak and that total, for the sweep.
- About 5 minutes after the end, the sweep records the total (`viewer_seconds`) and the verified sats zapped to the "Live now" note (`zap_sats`: receipts read from public relays, counted only when signed by the host's own zap provider with a matching zap request and invoice, each payment once, the same rule as the stream chat's zap total) on the session row, folds the session into its host's month in `live_host_monthly`, and tells the object to wipe itself. If the object stays unreachable for an hour, viewer time is recorded as NULL. If nobody collects the totals, the object wipes them 2 days after its last heartbeat.
- Session rows still go at 30 days. The monthly rows are kept 24 months so month-over-month numbers survive the purge, and are deleted at the host's account-deletion request. Both are shown to admins only (`/admin/live/metrics`); the host sees the per-session numbers as before.
- Cost estimate: viewer time × US$1 per 1,000 minutes (Cloudflare Stream delivery). Heartbeats stop while a tab is hidden, so the estimate runs low against what Cloudflare bills.
- Heartbeats do not touch the guest cap or the pass ceiling.
- Edge limit: one Cloudflare rate-limiting rule (the plan allows one): the existing join rule is extended to cover `/api/live/*/join`, `/api/live/*/heartbeat` and `/api/live/*/watching`. Its counters are Cloudflare's, at the edge; the app stores nothing for it.

A one-way hash of an IP address can remain personal data; use limited-purpose, keyed pseudonymization where practicable and explain the purpose and retention.

**Go live reports (settled in #977):**
- The stored reporter identifier is `HMAC-SHA256(LIVE_REPORTER_HASH_SECRET, daily-salted IP hash)`. The secret is server-side and different per environment.
- The identifier is **pseudonymous, not anonymous**. Without the secret, linking a stored id to an address is impractical. Someone holding the secret and that day's salt (KV, kept 3 days) could test whether a *given* address made a report; after the salt expires that test is no longer possible. Public text says "hard to link back", never "impossible".
- If the secret is missing, no report is stored, so an unkeyed hash is never written. The admin is still alerted by DM, and the reporter is asked to email support.

**Elsewhere (still open, #978):** the shared per-IP limiter's hash, used by Reads reports, keyword hits, rate-limit counters and (through a similar helper) Nourish flags, is still an unkeyed daily-salted SHA-256. Treat those as reversible while their salt exists (3 days).

Cloudflare also processes viewer and reporter IP addresses at the edge for delivery and for the rate-limiting rule on stream joins, heartbeats and watching-count reads. That processing should be covered by the Cloudflare disclosure in the Privacy Policy, even though Zap Cooking's application stores no viewer records. Ensure policies accurately identify processors, data flows and cross-border transfer arrangements. Verify Cloudflare's current DPA and relevant product terms.

Privacy notices should allow retention when necessary for legitimate investigations, legal preservation or compliance; avoid an absolute deletion guarantee.

## Review holds vs legal preservation

The public text (Privacy §9, Child Safety §7, /delete-account) distinguishes two things:

- **Review hold** — code. `live_holds`, opened by the first report on a session, kept through every retention rule and the account-deletion purge, released only by an admin (logged `release_hold`). Covers the session row, its reports, its action-log entries, the snapshot, and (PR #986) the host's hosting agreement.
- **Legal preservation** — process. There is **no separate legal-hold flag, timer or lock in the code**. Today it is implemented by *not releasing* the review hold (go-live-moderation.md §3) and by copying anything else that must be kept before it expires.

Gaps between the public promise and the code (to fix or accept):

1. Nothing stops an admin from releasing a hold that is under legal preservation, and nothing reminds anyone when a 1-year period ends. Proposed: a `legal` status on `live_holds` that the release action refuses, with an expiry date.
2. Records outside `live_holds` are not covered automatically: Reads reports and Nourish flags (KV, 90-day TTL), access requests (90 days after decision), hidden-commenter rows, and the account-deletion purge of Pantry content (manual staff work). They must be exported by hand before they expire when preservation applies.
3. Public comments and zaps on Nostr are not stored by us; preserving them means capturing them from relays at the time.
4. Stream video is not recorded, so it cannot be preserved.
