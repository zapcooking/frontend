# Go Live: Trust & Safety operating framework

**Draft — legal and operational review required | 2026-11-14**

Scope: member-hosted live video, public Nostr comments and safety reports on Zap Cooking. This is a proposed **process**, not a representation that controls have been deployed or audited.

## Operating assumptions to verify
- Members hosting Go Live are 18+ (self-attested): before going live, each host agrees once per terms version ("I'm 18+, agree and go live"), recorded server-side with pubkey, terms version and time (`live_terms_acceptance`); create refuses without it. Viewers can join without accounts.
- Live video is delivered by Cloudflare Stream; recording is intended to be disabled. Confirm actual configuration and vendor retention before promising no recordings.
- Stream metadata is normally deleted after 30 days and reports after 90 days, **unless subject to a hold**.
- Hosting opens in stages: approved hosts first, then all active members only by an explicit admin decision.
- Zap Cooking can end streams and suspend hosting; public Nostr events may persist on other relays.
- Review any public-facing policy changes with counsel before publication.

## How this relates to the product
This folder is the governance framework: what we must do and why. The operational runbook for the deployed controls (approved hosts, access requests, reports, holds, the action log and every action on **/admin/live**) is `go-live-moderation.md`, added in this folder with PR #977. Where the two differ, the runbook describes what the software does today, and this framework describes what it must satisfy; fix whichever is wrong rather than leaving them inconsistent.

Implementation status at the time of writing:

| Framework requirement | Status |
| --- | --- |
| End a stream and block a host quickly | Built (admin End and Block, PR #958 and #977) |
| Report intake for streams (no account) and comments (signed in) | Built (PR #977) |
| Real-time alert to a moderator | Built as an encrypted Nostr DM to every admin account (PR #977); since the backup-admin PR, both the primary and the backup admin each get their own DM |
| Legal hold that survives 30/90-day deletion and account deletion | Built (PR #977): opened automatically by the first report, released only by a logged admin action |
| Keyed pseudonymous reporter identifier | Built for Go live reports (PR #977): HMAC with a server-side secret per environment. The shared limiter used elsewhere is still unkeyed (#978) |
| Preview cannot change Production's Go live controls | Built (PR #977): Go live KV keys are named per environment |
| Audit trail of moderation actions | Built (PR #977): action log, kept 2 years or longer under an open hold |
| Staged rollout | Built (PR #977): approved hosts only by default; "all members" is an explicit admin switch |
| Automatic stream termination | Deliberately not built. A person decides every enforcement action |
| Restricted incident system outside GitHub for case notes and CyberTipline records | **Not yet designated** |
| NCMEC provider registration and manual CyberTipline access | **Not yet done** |
| Named moderator backup with alert coverage | Designated in code: a second full admin key (`BACKUP_ADMIN_PUBKEY`), receiving every report alert and access-request DM. End-to-end delivery to the backup not yet verified |

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
Assign a named primary owner and backup in a private runbook (names and contacts there, not here). There are two admin keys, listed in `ADMIN_PUBKEYS` in `src/lib/adminAuth.ts`: the founder's (primary, `ADMIN_PUBKEY`) and a backup moderator's (`BACKUP_ADMIN_PUBKEY`). Both are full site admins with the same powers on every admin route, both receive every report alert and access-request DM, and the action log records whichever key acted. The daily account-deletion digest still goes to the primary only. A backup with working alert access is required before switching hosting to "all members": confirm on Production that the backup actually reads the alerts (see the launch checklist). Review procedures at launch and after material changes; record legal sign-off separately. Confirm the published Terms, Privacy Policy and Child Safety Standards match actual deployed practices.
