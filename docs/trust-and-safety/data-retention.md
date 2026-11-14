# Privacy and retention alignment

**Draft; public disclosures must be checked against deployed code and vendor terms.**

| Category | Proposed normal retention | Exceptions / verification |
| --- | --- | --- |
| Stream metadata (host pubkey, title, recipe, start/end, end reason, guest counts, announcement note ID) | 30 days | Preservation/legal hold |
| Reports, report text and IP-derived anti-abuse identifier | 90 days | Preservation/legal hold; confirm identifier design |
| Host restrictions and hidden-commenter state | Until removed | Periodic necessity review |
| Public replies and zap receipts on Nostr | Network-dependent | Zap Cooking cannot promise deletion across independent relays |
| Live video | Intended not to be recorded | Confirm Cloudflare Stream recording setting, buffering, caching and logs |

No *application-level per-viewer records* are proposed. Do not claim 'no viewer data' if delivery/security providers receive IP addresses or other connection data. Confirm whether browser membership checks, signed passes, web analytics, rate limiting or server/proxy logs collect identifiable information.

A one-way hash of an IP address can remain personal data; use limited-purpose, keyed pseudonymization where practicable and explain the purpose and retention. Ensure policies accurately identify processors, data flows and cross-border transfer arrangements. Verify Cloudflare's current DPA and relevant product terms.

Privacy notices should allow retention when necessary for legitimate investigations, legal preservation or compliance; avoid an absolute deletion guarantee.
