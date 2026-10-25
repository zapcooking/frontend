# Cheffy account samples

`0003_create_cheffy_trial_turns.sql` adds lifetime accounting for three text-chat samples per verified account. It uses the existing `SCHEDULER_DB` binding; no new database or secret is required. Apply to the isolated preview database first, validate there, then apply to production using the commands in `APPLIED.md`. This migration has NOT been applied by the coding task.

Chat requires `MEMBERSHIP_ENABLED=true` and the existing `RELAY_API_SECRET` as well as `OPENAI_API_KEY`. The API fails closed with a recoverable 503 while membership is disabled/unconfigured, the membership lookup is unknown, or the trial binding/table is unavailable. Paid members do not use this table. Preview/production quota rows remain isolated by the existing bindings. Changing browsers or clearing cookies does not reset an account's quota.

A single conditional SQL insert reserves a turn atomically across Workers. The unique account/request ID prevents retry double-spending. Successful requests remain as completed rows; definite failures release pending rows. If the worker is terminated after reserving, the reservation remains counted conservatively. Staff can inspect and remove a confirmed failed pending reservation rather than automatically reopening an in-flight model call.

Only account public key, request ID, status and creation time are retained. Prompts and model answers are not stored. Retrying a request that already completed returns an explicit completed status without calling the model again. If its original response was lost, the client explains that it completed and lets the user start a new message. This preserves the quota without adding server-side conversation retention.

Photo scanning, photo questions and pasted-text/recipe-formatting access do not receive free credits from this feature.
