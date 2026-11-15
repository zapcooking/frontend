# Privacy and retention alignment

**Draft; public disclosures must be checked against deployed code and vendor terms.**

| Category | Proposed normal retention | Exceptions / verification |
| --- | --- | --- |
| Stream metadata (host pubkey, title, recipe, start/end, end reason, guest counts, announcement note ID) | 30 days | Preservation/legal hold |
| Reports, report text and IP-derived anti-abuse identifier | 90 days | Preservation/legal hold; confirm identifier design |
| Host restrictions (blocks) and hidden-commenter state | Until removed | Periodic necessity review; a block is not lifted by account deletion |
| Approved-hosts list | Until the host is removed | Periodic necessity review |
| Hosting access requests (pubkey, optional note, decision) | Proposed: until decided, then 90 days | Retention period not yet decided; must be set before publishing Privacy text |
| Moderation action log (actor, action, target pubkey, time) | 2 years | Longer while a related hold is open |
| Report holds and session snapshots | Until released | Released only by a logged admin action; the related reports then follow their 90-day schedule |
| Public replies and zap receipts on Nostr | Network-dependent | Zap Cooking cannot promise deletion across independent relays |
| Live video | Intended not to be recorded | Confirm Cloudflare Stream recording setting, buffering, caching and logs |

No *application-level per-viewer records* are proposed. Do not claim 'no viewer data' if delivery/security providers receive IP addresses or other connection data. Confirm whether browser membership checks, signed passes, web analytics, rate limiting or server/proxy logs collect identifiable information.

A one-way hash of an IP address can remain personal data; use limited-purpose, keyed pseudonymization where practicable and explain the purpose and retention. The current design uses a daily-salted hash; confirm whether the salt is a server-side secret (keyed) or derivable, because an unkeyed hash of the IPv4 space can be reversed by brute force.

Cloudflare also processes viewer and reporter IP addresses at the edge for delivery and for the rate-limiting rule on stream joins. That processing should be covered by the Cloudflare disclosure in the Privacy Policy, even though Zap Cooking's application stores no viewer records. Ensure policies accurately identify processors, data flows and cross-border transfer arrangements. Verify Cloudflare's current DPA and relevant product terms.

Privacy notices should allow retention when necessary for legitimate investigations, legal preservation or compliance; avoid an absolute deletion guarantee.
