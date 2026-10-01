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
Last checked 2026-09-26: no drift (7 objects in each).
