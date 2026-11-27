# Go Live safety launch checklist

**Status: unchecked until verified by responsible owners.** Items marked "(Preview)" were verified in the #977 gates on the preview environment on 2026-11-15. Production behaviour follows from the same build, but has not been separately exercised.

## Product / engineering
- [ ] Confirm Cloudflare Stream recording disabled by configuration and automated test.
- [x] Verify live stream can be ended quickly, playback revoked, restart blocked and discovery updated. (Preview: admin End and Block stop the viewer's video within seconds; a blocked host's new stream is refused; the global off switch ends every stream, refuses new ones and empties /live.)
- [x] Test anonymous report intake, signed-in comment report and authenticated moderation permissions. (Preview: stream reports without an account, a signed-in comment report, and a non-admin refused with 403 on GET and POST of /api/admin/live.)
- [x] Backup moderator designated: a second full admin key (`BACKUP_ADMIN_PUBKEY` in `ADMIN_PUBKEYS`), accepted on every admin route, recorded under its own key in the action log.
- [x] Report alerts and access-request DMs are sent to both admins, one encrypted DM each (automated tests).
- [ ] Verify urgent alerts reach primary **and backup** during the entire period hosting is available. *Partly done:* the code sends every alert to both keys; delivery to the backup has not yet been verified on Preview or Production.
- [ ] Build and test legal holds against 30/90-day cleanup, including failed jobs and release controls. *Partly done:* built in #977. Automated tests cover holds surviving the 30/90-day cleanup and the account purge. A logged release was verified on Preview. Behaviour when a cleanup job fails part-way is not yet tested.
- [ ] Secure incident tracking outside GitHub; verify least privilege and audit trail.
- [ ] Validate no unintended viewer logs, persistent tokens or sensitive analytics.

## Reporting and policy
- [ ] Register Zap Cooking LLC with NCMEC as an electronic service provider, and confirm working **manual** CyberTipline reporting access.
- [ ] Document authorized reporting decision owner and backup in private runbook.
- [ ] Exercise manual submission fallback; integrate API only after test environment validation.
- [ ] Obtain legal review of 18 U.S.C. § 2258A duties, preservation and jurisdiction-specific age rules.
- [ ] Confirm DMCA agent registration and live complaint handling where relevant.
- [ ] Harmonize Terms, Privacy and Child Safety Standards with live controls, data flows and retention.
- [ ] Confirm Cloudflare contractual/data-processing posture and language about non-recording.

## Staged rollout
- [ ] Phase 1 (approved hosts): founder plus a few invited hosts. Review every report, hold and action-log entry from this phase.
- [ ] Before widening the approved list: report alerts verified end to end, and holds verified to survive the purge. *Partly done:* report alerts were verified end to end on Preview, including a child-safety alert sent despite the throttle. Holds surviving the purge are covered by automated tests only; verify on Production before widening.
- [ ] Before switching hosting to "all members": a named backup moderator receives alerts (*designated and wired*, end-to-end receipt still to verify), the restricted incident system exists, NCMEC registration is complete, and public policies are published.
- [x] Preview environments use their own notification key, never the production one. (Preview has its own `NOTIFICATION_PRIVATE_KEY`, generated separately from Production's.)
- [x] Preview and Production cannot affect each other's Go live switches. They share one KV namespace, so every Go live key is named per environment (`live:*` on Production, `live:preview:*` on Preview), since #977. Production's `live:hosting_mode` must be read and found absent right before each deploy that touches hosting.
- [ ] Set and disclose a retention period for hosting access requests. *Set* in #977: until decided, then 90 days after the decision. *Disclosure* is pending the policy PR.
- [x] Confirm the reporter IP hash is keyed with a server-side secret. (Go live reports, #977: HMAC-SHA256 with `LIVE_REPORTER_HASH_SECRET`, different per environment; nothing is stored without it. The shared limiter used by other routes is still unkeyed: #978.)

## Governance
- [ ] Record owners and effective date.
- [ ] Simulate one urgent incident end-to-end without real evidence.
- [ ] Obtain founder, engineering and counsel sign-off before broad member-hosted rollout.

## Open questions for counsel
1. Reporting scope and covered materials for unrecorded live video under §2258A.
2. Minimum age, minors appearing, visitor privacy and international distribution.
3. Retention/hold durations for investigations, legal process and CyberTipline reports.
4. Whether service provider safe harbors and DMCA processes cover live streaming.
5. Whether platform/vendor claims about temporary buffers and viewers' data are accurate.
