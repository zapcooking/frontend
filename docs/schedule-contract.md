# Scheduled Posts API Contract (v1)

**This document is the cross-platform contract.** The web, Android and iOS clients all schedule
through this one API, and the Android and iOS ports are written against it verbatim. Server
implementation: `src/routes/api/schedule/`, `src/lib/scheduleApi.server.ts`,
`src/lib/scheduleRelays.ts`, and the minutely sweep in `workers/cron/sweep.ts`. Change the code and
this document together; a change that breaks a rule below needs a paired change in all three
clients.

## The model in one paragraph

The client builds the event it wants published, sets `created_at` to the **publish time**, signs it
with the user's key, and POSTs the signed event. The server never holds a key and cannot alter the
event: the signature covers everything, including the time. It stores the event encrypted and a
sweep that runs once a minute broadcasts it, unchanged, when its time comes. Rows are keyed by the
event id and scoped to the author's pubkey, so a post scheduled on one client appears in, and can
be cancelled from, the others.

- Base URL: `https://zap.cooking`
- All three endpoints require NIP-98 auth (below).
- Request and response bodies are JSON.
- Times are unix seconds.

## Endpoints

### `POST /api/schedule` — schedule an event

Request body:

```json
{
  "event": { "id": "…", "pubkey": "…", "created_at": 1800000000, "kind": 1, "tags": [], "content": "…", "sig": "…" },
  "relay_mode": "all",
  "relays": ["wss://relay.example.com", "wss://other.example.com"],
  "replaces": "<id of the pending post this one replaces>"
}
```

| Field | Required | Meaning |
|---|---|---|
| `event` | yes | The complete signed event. `created_at` is the publish time. |
| `relay_mode` | yes | `"all"` (public relays) or `"pantry"` (the members' relay only). |
| `relays` | no | Up to 4 of the author's own write relays. See "Relays". |
| `replaces` | no | Event id of the caller's own pending post that this event takes the place of. See "Editing and rescheduling". Leave it out (or send `null`) for a plain create. |

Success, `201`:

```json
{ "id": "<event id>", "publish_at": 1800000000, "relay_mode": "all", "relays": ["wss://relay.example.com"], "status": "pending" }
```

`relays` in the response is the list as stored (normalized, duplicates folded), `[]` when none.

A request that carried `replaces` gets one more field on success: `"replaced": "<old event id>"`.

### `GET /api/schedule` — list the caller's scheduled events

Optional query: `?status=pending` (or `publishing`, `sent`, `failed`, `cancelled`). One value only.
Without it, rows of every status **except `cancelled`** are returned. Cancelled rows are returned
only by `?status=cancelled`. (Before 2026-11: the unfiltered list included cancelled rows, which
could push pending rows out of the 100-row cap for someone who reschedules often.)

Success, `200`:

```json
{
  "items": [
    {
      "id": "<event id>",
      "publish_at": 1800000000,
      "relay_mode": "all",
      "relays": ["wss://relay.example.com"],
      "status": "pending",
      "attempts": 0,
      "last_error": null,
      "sent_at": null,
      "event": { "…the full signed event, exactly as it was sent…" }
    }
  ],
  "truncated": true
}
```

- Order: newest `publish_at` first. A client showing "next up first" sorts pending rows ascending
  itself.
- At most 100 rows. There is no paging. `truncated` is present, and `true`, only when the caller
  has more matching rows than the 100 returned; otherwise the field is absent. The rows dropped
  are always the oldest publish times, so pending posts are the last to go.
- `event` is the whole event, so the client renders its own preview.
- `last_error` is the most recent failure, verbatim from a relay where one answered (for example
  `blocked: spam filter`), or one of `no_relay_accepted`, `decrypt_failed`,
  `no relay answered before the publish was abandoned (N pending)`. Show it as detail under plain
  copy; do not parse it.
- `sent_at` is when the sweep broadcast it, or `null`.

### `DELETE /api/schedule/{id}` — cancel

`{id}` is the event id. No body.

Success, `200`: `{ "id": "<event id>", "status": "cancelled" }`

Only a `pending` row can be cancelled. Cancelling is a status change: the row stays in the list as
`cancelled`.

### Editing and rescheduling

There is no update. A different time or different text is a different signed event with a
different id. There are two ways to swap one for the other.

**Preferred: `replaces`.** POST the new signed event with `"replaces": "<old event id>"`. The
server stores the new event and cancels the old row in one transaction: both happen or neither
does, so the post is never scheduled twice and never lost.

- The old row must be the caller's own and still `pending`. If it is not, nothing is stored:
  `404 not_found` (no such post for this account) or `409 not_replaceable` with the old row's
  `status` (it is already going out, was sent, failed or was cancelled).
- The new event is validated exactly like any create (time window, kind, size, poll close time).
  A refused replacement leaves the old post scheduled as it was.
- The new row takes its `relay_mode` and `relays` from this request, not from the old row. To
  move a post without changing where it goes, send the old row's `relay_mode` and `relays` again.
- Success is `201` with `"replaced": "<old event id>"`. **Check for that field.** A `201` without
  it means the server did not act on `replaces` (an older deployment): the new post is scheduled
  and the old one still is too, so cancel the old one with `DELETE` straight away.
- A replace does not need a free slot (it is exempt from the 50-pending limit) and does not count
  against the 30 creates per hour. It has its own limit: 60 per rolling hour. Over that the
  answer is `429 rate_limited` with `"limit": "moves"`, and nothing is changed.
- Retrying after a lost response is safe, with the same signed event: the answer is
  `409 already_scheduled` with `"status": "pending"` and `"replaced": "<old event id>"`, which
  says the swap already happened.
- Afterwards the old row is `cancelled`, exactly as if it had been cancelled by hand. A client
  that never sends `replaces` sees nothing new: one row turned `cancelled` and a new `pending`
  row appeared.

When moving a post to a new time, sign the original event's `kind`, `tags` and `content`
unchanged with only `created_at` set to the new time. Do not rebuild the event from a composer:
that can drop tags (a quote's `q` tag, reply markers, another app's tags). A tag that holds a
time needs a decision: a poll's close time (`endsAt`, `closed_at`) should move by the same
amount as the post; an `expiration` tag that would pass before the new publish time means the
post should not be moved; `published_at` should follow the post only where it equalled the old
`created_at`.

**Also valid: cancel, then create.** `DELETE` the old one and check it returned `200`, then POST
the new one as a plain create. If the cancel returns `409 not_cancellable` the original is
already going out and the client must not create a replacement. This needs a free slot only
after the cancel, spends one of the 30 creates per hour, and if the create then fails the post
is no longer scheduled at all; prefer `replaces`.

## Status lifecycle

| Status | Meaning | Can cancel |
|---|---|---|
| `pending` | Waiting for its time, or waiting to be retried after a failed attempt. | yes |
| `publishing` | The sweep has claimed it and is broadcasting right now. | no |
| `sent` | At least one relay accepted it. Final. | no |
| `failed` | Gave up: 10 failed attempts, or still unsent 24 hours after `publish_at`. Final. | no |
| `cancelled` | Cancelled by the author. Final. | no |

**Lateness.** The sweep runs once a minute, so an event is broadcast **0 to 60 seconds after**
`publish_at`, and its `created_at` is that much in the past when relays first see it. This is by
design; do not compensate for it. If many events are due in the same minute, or a relay is slow,
some go out a minute or two later still. A failed attempt is retried on the next tick.

## Limits

| Rule | Value | Error when broken |
|---|---|---|
| Publish time | strictly more than 120 s and strictly less than 90 days from now | `bad_publish_time` |
| Event size | serialized event at most 64 KiB (65,536 bytes) | `too_large` |
| Pending events per account | 50 (a replace is exempt: it frees the slot it fills) | `quota_exceeded` |
| Creates per account per rolling hour | 30, counting cancelled ones, not counting replaces | `rate_limited` |
| Replaces (`replaces`) per account per rolling hour | 60 | `rate_limited` with `"limit": "moves"` |
| Client relays | at most 4, each under 200 characters | `bad_relays` |
| List size | 100 rows | none; the response carries `"truncated": true` |

Clients should enforce a minimum of **5 minutes** in their own date pickers. The server's 120 s
floor is there so a request that was valid when the user tapped is not rejected for the seconds it
spent in transit.

A poll must stay open for more than 60 s after it publishes: the close time (`endsAt` tag on kind
1068, `closed_at` tag on kind 6969) must be greater than `created_at + 60`, or the request is
refused with `poll_closes_before_publish`.

## Kinds

| Kind | What | `all` | `pantry` |
|---|---|---|---|
| 1 | Note, including a reply (NIP-10) | yes | yes |
| 20 | Picture (NIP-68) | yes | no |
| 21 | Video, horizontal (NIP-71) | yes | no |
| 22 | Video, vertical (NIP-71) | yes | no |
| 1068 | Poll (NIP-88) | yes | yes |
| 1111 | Comment (NIP-22) | yes | no |
| 6969 | Zap poll | yes | yes |
| 30023 | Long-form | yes | yes |

Any other kind is `bad_kind`. A kind marked "no" for pantry is
`kind_not_allowed_for_relay_mode` when sent with `relay_mode: "pantry"`: the sweep has no key, and
the pantry relay takes only those kinds from a publisher that cannot authenticate.

Private (gift-wrapped) replies cannot be scheduled.

## Relays

Where a scheduled event is broadcast:

- **`relay_mode: "pantry"`**: `wss://pantry.zap.cooking` only. `relays` is validated and then
  ignored.
- **`relay_mode: "all"`**: `wss://nos.lol` and `wss://relay.primal.net` always, plus the event's
  `relays`. An event with no `relays` goes to those two only.

`relays` is how a scheduled post reaches the author's own relays, so clients should send it:
**the author's NIP-65 write relays, best first.** Rules for the field:

- At most **4** after duplicates are folded. The server opens one connection per relay, and a
  Cloudflare Worker may have 6 connections waiting at once (2 fixed + 4):
  <https://developers.cloudflare.com/workers/platform/limits/#simultaneous-open-connections>.
  If the author has more than 4 write relays, send the 4 most likely to accept and keep the note;
  order is preserved.
- Each must be a `wss://` URL under 200 characters on a public hostname. Refused: `ws://`, IP
  addresses of either family, `localhost`, single-label hosts, private-network names (`.local`,
  `.lan`, `.internal`, `.onion` and similar), URLs with credentials or whitespace.
- **One bad entry rejects the whole request** with `bad_relays`; nothing is stored. Filter the
  list on the client first rather than sending it raw.
- URLs are normalized before storing and comparing: lowercase host, no default port, no trailing
  slash, no fragment. `wss://Relay.Example.com/` and `wss://relay.example.com:443` are one relay.
- No need to send `wss://nos.lol` or `wss://relay.primal.net`; they are used anyway. Sending them
  is harmless but spends two of the four places.
- Do not send relays that never store notes (`wss://purplepag.es` holds only profiles and relay
  lists) or that the author cannot write to without authenticating. The sweep cannot answer a
  NIP-42 challenge, so such a relay just refuses.

The event counts as `sent` when **at least one** relay accepts it. The server does not report
which ones did. Once one relay has accepted, the others get about 2 more seconds to answer before
the sweep moves on, so a slow relay may not receive the event.

## Authentication (NIP-98)

Every request carries `Authorization: Nostr <base64>` where `<base64>` is the standard base64 of
the JSON of a signed kind `27235` event:

| Part | Requirement |
|---|---|
| `kind` | `27235` |
| `created_at` | within **60 seconds** of the server's clock, either side. Sign a fresh event for every request; never reuse one. A device with a wrong clock fails here. |
| `u` tag | the request URL as origin plus path: `https://zap.cooking/api/schedule`, or `https://zap.cooking/api/schedule/<id>` for DELETE. **No query string** (sign the bare URL even when sending `?status=pending`), no fragment, no trailing slash. |
| `method` tag | `POST`, `GET` or `DELETE`, matching the request. |
| `payload` tag | **POST only, and required there:** lowercase hex SHA-256 of the exact request body bytes. Hash the same string that is sent; do not re-serialize. Omit it for GET and DELETE. |
| `content` | empty string |
| signature | valid, by the account's key |

The key that signs the auth event is the caller's identity. On POST the scheduled event's `pubkey`
must be the same key, or the request is refused with `pubkey_mismatch`.

Every auth failure is `401 { "error": "auth_failed", "detail": "header" | "event" | "binding" }`.
The detail is deliberately coarse: `header` (missing or unreadable header), `event` (wrong kind,
bad signature, stale time), `binding` (URL, method or payload does not match the request).

## Errors

Every error body is `{ "error": "<code>" }`, sometimes with one extra field. Clients branch on
`error`, never on the HTTP status alone, and must treat an unknown code as a generic failure:
codes may be added.

| Status | `error` | Endpoint | Meaning | What the client should show or do |
|---|---|---|---|---|
| 401 | `auth_failed` | all | NIP-98 check failed (`detail` says which part). | "Couldn't verify your account. Check your device's date and time, then try again." Retry once with a freshly signed header. |
| 400 | `bad_request` | POST | Body is not JSON, `event` / `relay_mode` is missing or the wrong type, or `replaces` is present and not a 64-character lowercase hex event id. | Client bug. Generic "Couldn't schedule this post." |
| 400 | `bad_relay_mode` | POST | `relay_mode` is not `all` or `pantry`. | Client bug. Generic failure. |
| 400 | `bad_relays` | POST | `relays` is not an array, has an entry that is not an allowed URL, or has more than 4. | Client bug: filter and cap before sending. If it happens, retry once without `relays`, so the post still goes to the fixed relays. |
| 400 | `bad_signature` | POST | The event's id or signature does not verify. | "Your signer returned a post we couldn't verify. Try again." Usually a signer that changed the event (see "Signing"). |
| 400 | `pubkey_mismatch` | POST | The event was signed by a different key than the auth header. | "This post was signed by a different account. Sign in again and retry." |
| 400 | `bad_kind` | POST | The kind cannot be scheduled. | "This kind of post can't be scheduled." Hide the schedule control for it. |
| 400 | `kind_not_allowed_for_relay_mode` | POST | The kind can be scheduled, but not to the members' relay. | "This kind of post can't be scheduled to the members' relay." Hide the control, or schedule with `all`. |
| 400 | `bad_publish_time` | POST | `created_at` is 120 s or less away, 90 days or more away, or not an integer. | "Pick a time at least 5 minutes from now and within 90 days." The user must pick again and the event must be signed again. |
| 400 | `too_large` | POST | The event is over 64 KiB. | "This post is too long to schedule." |
| 400 | `poll_closes_before_publish` | POST | The poll would close before, or within 60 s of, its publish time. | "This poll would close before it's posted. Move the closing time later." |
| 409 | `already_scheduled` | POST | This exact event is already stored. Body includes `status`: the existing row's current status, and `replaced` (the old event id) when that row was stored by a replace. | **Treat as success** when `status` is `pending`, `publishing` or `sent`: an earlier attempt landed. For `cancelled` or `failed`, tell the user and sign a new event to try again. |
| 400 | `quota_exceeded` | POST | The account already has 50 pending posts. | "You have 50 posts scheduled, the most allowed. Cancel one, or wait for one to go out." |
| 429 | `rate_limited` | POST | 30 posts scheduled in the last hour (cancelled ones count), or, with `"limit": "moves"` in the body, 60 replaces in the last hour. | "You've scheduled a lot in the last hour. Try again later." For `"limit": "moves"`: "You've moved a lot of posts in the last hour. Try again later." Do not retry automatically. |
| 404 | `not_found` | POST with `replaces` | No post with the `replaces` id exists for this account. Nothing was stored. | "This scheduled post no longer exists." Refresh the list. |
| 409 | `not_replaceable` | POST with `replaces` | The post named by `replaces` is not `pending`. Body includes `status`. Nothing was stored. | Say what happened, by `status`, as for `not_cancellable`: `publishing` "This post is being published right now and can't be changed." / `sent` "This post has already been published." / `cancelled` "This post was cancelled." / `failed` "This post already failed and won't be sent." Refresh the list. |
| 400 | `bad_status` | GET | `?status=` is not one of the five statuses. | Client bug. Generic failure. |
| 404 | `not_found` | DELETE | No such scheduled post for this account. | "This scheduled post no longer exists." Refresh the list. |
| 409 | `not_cancellable` | DELETE | The row is not `pending`. Body includes `status`. | Say what happened, by `status`: `publishing` "This post is being published right now and can't be cancelled." / `sent` "This post has already been published." / `cancelled` treat as done / `failed` "This post already failed and won't be sent." Refresh the list. |
| 500 | `not_configured` | all | The server is missing its database or key. | "Scheduling is unavailable right now." |
| 500 | `internal` | all | Unexpected server error. | "Something went wrong. Try again." POST is safe to retry with the same signed event. |

### Retrying a create

A POST whose response was lost can be sent again **with the same signed event and a fresh auth
header**. Either it is created now (`201`) or it already was (`409 already_scheduled`, with the
status). The `409` check runs before the quota and rate checks, so a retry is never refused for a
limit its own first attempt reached. Never re-sign to retry: a re-signed event has a new id and
would be scheduled twice. The same holds for a request with `replaces`: resend it unchanged, and
a `409 already_scheduled` whose `replaced` matches means the swap is done.

## Signing a future-dated event

- Set `created_at` to the publish time **before** signing, and send the event exactly as the
  signer returned it.
- **After signing, check the result before sending:** `created_at` still equals the chosen time
  and the signature verifies. Some remote signers and browser extensions replace the timestamp
  with the current time; that event is not the one the user scheduled. Show "Your signer changed
  this post, so it can't be scheduled" and do not POST it.
- **Proof-of-work and scheduling do not mix.** Mining a NIP-13 nonce re-stamps `created_at` as it
  runs, which would move the post to "now". Turn mining off whenever a publish time is set.
- Sign once. The stored event is the one that will be published, byte for byte.

## Known limitations

- **Tagged people's inbox relays are not used.** A scheduled quote, reply or mention is broadcast
  only to the two fixed relays plus the author's own `relays`. It is **not** sent to the NIP-65
  inbox (read) relays of the people it tags, which a client posting immediately would normally
  add. The quoted or mentioned person is notified only if they read one of the relays the post
  did reach. Clients must not assume inbox delivery for scheduled posts, and should not spend the
  four `relays` places on recipients' inbox relays unless they mean to: the author's own write
  relays come first.
- **The quoted note may be gone by publish time.** The server does not check that an event a
  scheduled post refers to still exists when it goes out.

## Privacy

The event is stored encrypted at rest (AES-256-GCM) until it is published and is returned only to
its author. `relays` is the author's own choice of relays, stored as sent and returned only to the
author. A scheduled event is not visible to anyone else until the sweep broadcasts it.

## Moving from the old scheduler relay

The native apps used to send the future-dated event to `wss://scheduler.nostrarchives.com`, list
with a relay query and cancel with a kind 5. That relay is gone. The mapping:

| Before | Now |
|---|---|
| `EVENT` to the scheduler relay after NIP-42 auth | `POST /api/schedule` with NIP-98 |
| `REQ` for own future-dated kind 1 | `GET /api/schedule?status=pending` (every schedulable kind, not just 1) |
| kind 5 to the scheduler relay | `DELETE /api/schedule/{id}` |

Posts that were parked on the old relay were not migrated and will not be published.
