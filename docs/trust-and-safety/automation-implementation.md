# Go Live safety automation (implementation proposal)

**Draft PR; not yet deployed.** Apply `migrations/scheduler/0007_live_safety_incidents.sql` to **preview** and then production before enabling the reporting UI.

## Recommended approach
- **First stream report:** store a separate D1 report and stream snapshot, create an open preservation hold, show it in the restricted admin safety queue.
- **Child safety / imminent violence report:** prioritize human review immediately, even after one report. A public, anonymous allegation is not by itself verified evidence; do not automatically submit it to NCMEC.
- **Three distinct pseudonymous reporter hashes:** optional automated *temporary stream end*, with a one-hour host cooldown. This is off by default (`LIVE_SAFETY_AUTO_END` must explicitly be `true`).
- **All reported streams:** no ordinary 30-day session deletion while a hold is open. Open holds have no automatic expiry. Released cases resume retention cleanup.
- **No recording:** snapshots store available session metadata and Cloudflare input UID; disabling/deleting an input does not preserve video.

## Routes
- `POST /api/live/:id/report` public, bounded and rate-limited. Body: `{"reason":"child_safety|nudity|violence|spam|other","details":"optional <=300 chars"}`. Only generic acknowledgement is returned; reports are not vote totals.
- `GET /api/admin/live/safety` NIP-98 signed by ADMIN_PUBKEY: summarized incident queue, including high-priority counts. **Not public.**
- `POST /api/admin/live/safety` NIP-98 admin, body `{"action":"release_hold","id":"<session id>"}`. Release only after a reviewer confirms no legal requirement remains.
- Existing admin live endpoint can end sessions manually at any time.

## Important limitations before enabling auto-end
- Independence is approximated by **daily-salted IP-derived hashes**, not verified individuals; NATs and VPNs permit false negatives/positives. Thresholds are deliberately conservative.
- No encrypted Nostr DM is sent by this PR. It provides an admin-accessible queue, **not real-time paging**. Add an authenticated, reliable, secret-managed private notification transport and fallback escalation before opening broadly.
- No CyberTipline API submissions are made. A trained reviewer must assess/report promptly under applicable law.
- No actual Cloudflare recording is retained. The safety snapshot is taken in D1 before any automated shutdown, and the input is deleted using existing teardown.
- D1 migration is pending; never enable on production without migrating and running a staging incident simulation.
- Policy text must be reviewed for the new retention and moderation behavior.

## Operational acceptance tests
1. One report and report deduplication; verify IP hashes are not raw IPs.
2. An urgent report enters the restricted queue, creating an open hold.
3. A second report does **not** shut down a stream by default.
4. With auto-end enabled, three pseudonymous sources end a stream once; validate Cloudflare delete and sweep retry on failure.
5. Verify a temporarily suspended host cannot immediately restart.
6. Verify 30-day session cleanup skips held records, with explicit release and later cleanup.
7. Verify moderator alerting and staff availability separately; this PR does not implement the alert transport.
8. Verify NCMEC reporting and retention decisions with counsel.

## Follow-up engineering
- Reliable encrypted Nostr DM alerts or an alternative monitored secure channel, using an outbox with retry and acknowledgment.
- Atomic per-session reporter tally and stronger identity/abuse controls if automatic shutdown is enabled widely.
- Admin UI for incident detail and guided release, rather than an API-only queue.
- Review the risk of permanent false reports and decide how to reopen hosting.
