# Privacy and retention alignment

**Draft; public disclosures must be checked against deployed code and vendor terms.**

| Category | Proposed normal retention | Exceptions / verification |
| --- | --- | --- |
| Stream metadata (host pubkey, title, recipe, start/end, end reason, guest counts, peak watching and total joins, announcement note ID) | 30 days | Preservation/legal hold |
| "Watching now" heartbeat codes | About 60 seconds after the last heartbeat | Held only by the session's counter (memory plus its own short-lived storage); never in D1, KV, browser storage or logs (see below) |
| Reports, report text and IP-derived anti-abuse identifier | 90 days | Preservation/legal hold. The Go live identifier is a keyed hash (see below, settled in #977) |
| Host restrictions (blocks) and hidden-commenter state | Until removed | Periodic necessity review; a block is not lifted by account deletion |
| Approved-hosts list | Until the host is removed | Periodic necessity review |
| Hosting access requests (pubkey, optional note, decision) | Pending: until decided. Approved or declined: 90 days after the decision | Set in #977 and deleted by the sweep. Must be disclosed in the Privacy text (policy PR) |
| Hosting agreement (`live_terms_acceptance`: pubkey, terms version, time; migration 0009) | Until the account is deleted; one row per terms version agreed to | Deleted at the account-deletion request, unless one of the host's sessions is under an open hold or the account is blocked from hosting (Seth's ruling, #985); the sweep then deletes it once neither is true (`cleanupTermsAcceptances`). An agreement made after the deletion request is kept. A statement by the host, not age verification. Disclosed in Privacy §9 ("Hosting agreement") and on /delete-account |
| Moderation action log (actor, action, target pubkey, time) | 2 years | Longer while a related hold is open |
| Report holds and session snapshots | Until released | Released only by a logged admin action; the related reports then follow their 90-day schedule |
| Public replies and zap receipts on Nostr | Network-dependent | Zap Cooking cannot promise deletion across independent relays |
| Live video | Intended not to be recorded | Confirm Cloudflare Stream recording setting, buffering, caching and logs |

No *application-level per-viewer records* are proposed. Do not claim 'no viewer data' if delivery/security providers receive IP addresses or other connection data. Confirm whether browser membership checks, signed passes, web analytics, rate limiting or server/proxy logs collect identifiable information.

**Go live "watching now" count (#984):** live streams show how many people are watching, from 1 up. This relaxes the earlier "no view counts" rule for live streams only.
- The watch page sends a heartbeat about every 30 s while the stream plays in a visible tab. It carries one random code made fresh on every page load and kept only in the page's memory: never in browser storage, and never sent with an account, a key or a signature. The host is not counted.
- A Durable Object per session counts the distinct codes heard in the last ~60 s. It keeps each code in memory and in its own storage (so a Cloudflare restart does not empty the count), and an alarm deletes each code about a second after it expires; when none are left the object's storage is wiped. Nothing about a heartbeat reaches D1, KV or logs. (Changed on Seth's ruling 2026-11-15: the count should err high rather than blink during a restart.)
- Rate limit: the sender's IP address goes to that object for the limit only, where it is hashed with a random salt that exists only in the object's memory, and kept in memory (never stored) for one minute with two counters (heartbeats and new codes). It is never linked to a code.
- After the stream, two integers stay on the session row: the peak watching count and total joins (viewers the play relay admitted, members and guests together, not counting rejoins on a pass or the host). They are shown only to the host, and are deleted with the row (30 days, or later under a hold).
- Heartbeats do not touch the guest cap or the pass ceiling.
- Edge limit: one Cloudflare rate-limiting rule (the plan allows one): the existing join rule is extended to cover `/api/live/*/join`, `/api/live/*/heartbeat` and `/api/live/*/watching`. Its counters are Cloudflare's, at the edge; the app stores nothing for it.

A one-way hash of an IP address can remain personal data; use limited-purpose, keyed pseudonymization where practicable and explain the purpose and retention.

**Go live reports (settled in #977):**
- The stored reporter identifier is `HMAC-SHA256(LIVE_REPORTER_HASH_SECRET, daily-salted IP hash)`. The secret is server-side and different per environment.
- Without the secret, a stored identifier cannot be reversed to an address, even with the database and KV together.
- If the secret is missing, no report is stored, so an unkeyed hash is never written. The admin is still alerted by DM, and the reporter is asked to email support.

**Elsewhere (still open, #978):** the shared per-IP limiter's hash, used by Reads reports, keyword hits, rate-limit counters and (through a similar helper) Nourish flags, is still an unkeyed daily-salted SHA-256. Treat those as reversible while their salt exists (3 days).

Cloudflare also processes viewer and reporter IP addresses at the edge for delivery and for the rate-limiting rule on stream joins, heartbeats and watching-count reads. That processing should be covered by the Cloudflare disclosure in the Privacy Policy, even though Zap Cooking's application stores no viewer records. Ensure policies accurately identify processors, data flows and cross-border transfer arrangements. Verify Cloudflare's current DPA and relevant product terms.

Privacy notices should allow retention when necessary for legitimate investigations, legal preservation or compliance; avoid an absolute deletion guarantee.
