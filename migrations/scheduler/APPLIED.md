# Applied migrations — zapcooking-scheduler (D1)

These databases have **no `d1_migrations` table**. Every migration here
has been applied by hand with `wrangler d1 execute --file`, so this file
is the only record of what each database has. Don't run
`wrangler d1 migrations apply` against them: it would try to run 0001
again.

| Migration | `zapcooking-scheduler-preview` (`5ad85ea4…`) | `zapcooking-scheduler` (production, `5d5572d0…`) |
|---|---|---|
| `0001_create_scheduled_events.sql` | applied; date not recorded (after the file landed on 2026-07-22, #566) | applied; date not recorded (after the file landed on 2026-07-22, #566) |
| `0002_create_account_deletion_requests.sql` | 2026-09-23 (#751) | 2026-09-23 (#751) |
| `0003_create_cheffy_trial_turns.sql` | **not applied** — required before enabling account samples | **not applied** — required before enabling account samples |
| `0004_create_live_sessions.sql` | 2026-11-13 (#952) | 2026-11-13 (#952) |
| `0005_add_live_pass_rejoins.sql` | 2026-11-14 (#967) | 2026-11-14 (#967) |
| `0006_add_live_note_id.sql` | 2026-11-14 (#974) | 2026-11-14 (#974) |
| `0007_live_rollout_and_safety.sql` | 2026-11-14 (#977) | 2026-11-15 (#977) |
| `0008_add_live_watching_counts.sql` | 2026-11-15 (#984) | 2026-11-15 (#984) |
| `0009_live_terms_acceptance.sql` | 2026-11-15 (#986) | 2026-11-15 (#986), after #985 was live |
| `0010_live_metrics.sql` | 2026-11-15 (#991; 25 objects) | 2026-11-15 (#991), after #994 was live (build 4.2.1114) |
| `0011_live_ended_event.sql` | 2026-11-18 (#1012; 25 objects, columns only) | 2026-11-18 (#1012), before merge; 25 objects, columns only |
| `0012_add_scheduled_event_relays.sql` | 2026-11-23 (#1020) | 2026-11-23 (#1020), before merge; verified on production |
| `0013_add_scheduled_event_replaces.sql` | 2026-11-24 (#1026) | 2026-11-24 (#1026), before merge; verified on production |

## Applying a new migration

1. Add the file here, numbered next, and make it additive where possible.
2. Apply to **preview first**, and check the feature on a preview
   deployment. Run from a directory with no wrangler config, so the
   database name resolves through the account API, with the org account
   pinned:

   ```sh
   CLOUDFLARE_ACCOUNT_ID=2d2f9386809ef6f9cda581aa16dff31c \
     npx wrangler d1 execute zapcooking-scheduler-preview --remote --file <path>
   ```

3. Then apply to `zapcooking-scheduler` (same command).
4. Add a row to the table above **in the same PR**, with the date for
   each database.

## Checking for drift

The schemas should be identical. Compare them with:

```sh
for DB in zapcooking-scheduler-preview zapcooking-scheduler; do
  CLOUDFLARE_ACCOUNT_ID=2d2f9386809ef6f9cda581aa16dff31c \
    npx wrangler d1 execute $DB --remote --json \
    --command "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name != '_cf_KV' ORDER BY name" \
    | jq '.[0].results' > /tmp/$DB.json   # results only; the rest is per-query timing
done
diff /tmp/zapcooking-scheduler-preview.json /tmp/zapcooking-scheduler.json
```

Any difference means a migration reached one database and not the other.
Last checked 2026-11-15, after 0008 reached both: no drift (22 objects in
each; 0008 adds columns only, no objects). After 0009 reached both
(2026-11-15): no drift (23 objects in each; schemas identical). After 0010 reached both (2026-11-15): no
drift (25 objects in each; schemas identical). After 0011 reached both (2026-11-18): 25
objects in each and the same four new columns on `live_sessions` (checked
with `pragma_table_info`; the full schema diff was not run).

Trap: `wrangler d1 execute --file` combined with `--json` returned without
applying anything (2026-11-15, 0008 on production). Apply without `--json`,
then verify with `pragma_table_info`.
