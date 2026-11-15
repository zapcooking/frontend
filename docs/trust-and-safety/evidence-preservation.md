# Evidence preservation and legal holds

**Draft — coordinate with counsel before deployment.**

## Default schedules
- Stream metadata: ordinary deletion 30 days after the stream ends.
- Moderation reports: ordinary deletion after 90 days.
- Hosting bans or comment visibility restrictions: per published policy and operational need.

These are product proposals, **not** an instruction to delete records subject to a valid hold.

## Hold workflow
1. Identify relevant records when a serious report, potential statutory duty, legal process or reasonably anticipated dispute makes preservation appropriate.
2. In an access-controlled system, create a hold ID, lawful basis, authorized owner, creation time, affected record IDs/categories, review date and release conditions.
3. Suspend deletion of affected records; verify deletion jobs and backup/data lifecycle paths respect the hold.
4. Limit access and audit reading, export and release actions.
5. Review periodically; only an authorized reviewer may release the hold based on legal and operational requirements.
6. When released, return records to applicable deletion schedules and log the release.

**CyberTipline preservation:** after a qualifying report, apply applicable federal preservation requirements (generally one year from submission under 18 U.S.C. § 2258A(h)); other processes may require different periods. Avoid a single automatic 90-day hold expiry.

## Current implementation (PR #977)
- The first report on a stream or one of its comments opens a hold automatically, with a snapshot of the session's public facts. The snapshot never contains the Cloudflare input identifier.
- A held session, its reports and related action-log entries survive the 30/90-day purge and the host's account deletion.
- Release is a manual admin action on /admin/live and is logged; a new report reopens the hold.
- A child-safety or violence report is never lost as a duplicate. It is stored even when the same reporter already reported that stream or comment for another reason, and every urgent submission alerts the admin.
- Gap against step 2 above: the hold records no lawful basis, owner or review date. Record those in the restricted incident system for any hold that goes beyond routine moderation, until the admin tool supports them.

## Data minimization
Preserve what exists and is reasonably accessible: stream metadata, relevant report text, Nostr event IDs, moderation events, timestamps, and other covered records. Do not create unsolicited copies of suspected illegal video or solicit illegal material. No incident data in GitHub.

## Technical acceptance checks
- Held records survive ordinary 30/90-day purge jobs.
- Release is access-controlled and auditable.
- Case records have clear retention state and hold association.
- Partial failures generate alerts rather than silent deletion.
