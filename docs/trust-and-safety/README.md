# Go Live: Trust & Safety operating framework

**Draft — legal and operational review required | 2026-11-14**

Scope: member-hosted live video, public Nostr comments and safety reports on Zap Cooking. This is a proposed **process**, not a representation that controls have been deployed or audited.

## Operating assumptions to verify
- Members hosting Go Live are 18+ (currently self-attested); viewers can join without accounts.
- Live video is delivered by Cloudflare Stream; recording is intended to be disabled. Confirm actual configuration and vendor retention before promising no recordings.
- Stream metadata is normally deleted after 30 days and reports after 90 days, **unless subject to a hold**.
- Zap Cooking can end streams and suspend hosting; public Nostr events may persist on other relays.
- Review any public-facing policy changes with counsel before publication.

## Documents
1. [Live moderation](live-stream-moderation.md)
2. [Child-safety incident response](child-safety-incident-response.md)
3. [CyberTipline reporting](cybertipline-reporting.md)
4. [Evidence preservation](evidence-preservation.md)
5. [Retention and data governance](data-retention.md)
6. [Launch readiness](launch-readiness.md)

## Security boundary
**Do not commit** actual incident records, reporter details, stream evidence, images of abuse, CyberTipline reports or IDs, credentials, API payloads, moderator private contacts, or case-specific notes here. Git history, clones and forks make erasure difficult. Use a separate restricted, access-controlled incident system with auditing and retention controls. GitHub Issues/PRs are for generic engineering work only, not cases.

## Ownership
Assign a named primary owner and backup in a private runbook. Review procedures at launch and after material changes; record legal sign-off separately. Confirm the published Terms, Privacy Policy and Child Safety Standards match actual deployed practices.
