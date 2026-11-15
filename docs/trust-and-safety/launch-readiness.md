# Go Live safety launch checklist

**Status: unchecked until verified by responsible owners.**

## Product / engineering
- [ ] Confirm Cloudflare Stream recording disabled by configuration and automated test.
- [ ] Verify live stream can be ended quickly, playback revoked, restart blocked and discovery updated.
- [ ] Test anonymous report intake, signed-in comment report and authenticated moderation permissions.
- [ ] Verify urgent alerts reach primary **and backup** during the entire period hosting is available.
- [ ] Build and test legal holds against 30/90-day cleanup, including failed jobs and release controls.
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
- [ ] Before widening the approved list: report alerts verified end to end, and holds verified to survive the purge.
- [ ] Before switching hosting to "all members": a named backup moderator receives alerts, the restricted incident system exists, NCMEC registration is complete, and public policies are published.
- [ ] Preview environments use their own notification key, never the production one.
- [ ] Set and disclose a retention period for hosting access requests.
- [ ] Confirm the reporter IP hash is keyed with a server-side secret.

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
