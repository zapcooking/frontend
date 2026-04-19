# Follow-ups

Pre-existing bugs and deferred improvements surfaced during larger refactors.
Each item captures enough context to pick up independently. Order is not
priority — that's set per-sprint.

## Comment system (Task 6 / Stage 2)

### Bugs discovered during Stage 2 verification (not regressions)

1. **NoteTotalComments count inflates for self-posted comments.** When a
   comment is published via zap.cooking's own composer, the count on
   `NoteTotalComments.svelte` over-increments. Counts are correct for
   comments observed while scrolling. Localized to the post-from-this-client
   path — likely in how the newly-posted event is added to whatever
   subscription `NoteTotalComments` uses after publish. Start: inspect
   the engagement store flow in `src/lib/engagementCache.ts` and
   `NoteTotalComments.svelte`'s `onMount` fetch.

2. **NIP-10 p-tag under-propagation.** Reply events to kind 1 notes do not
   forward all of the parent event's `p` tags. Per NIP-10 §"The 'p' tag":
   "the reply event's `p` tags should contain all of E's `p` tags as well
   as the `pubkey` of the event being replied to." Current
   `buildNip22CommentTags` (in `src/lib/tagUtils.ts`) forwards root + parent
   pubkeys only. Deep threads under-notify participants. Fixing widens
   notification traffic — visible behaviour change, needs its own commit
   + changelog note. The inline TODO at the fix site documents this.

3. **NIP-10 `e`-tag missing optional pubkey at position 5.** Per NIP-10
   §"Marked 'e' tags": "`<pubkey>` SHOULD be the pubkey of the author of
   the `e` tagged event, this is used in the outbox model to search for
   that event from the authors write relays where relay hints did not
   resolve the event." Current NIP-10 fallback branch in
   `buildNip22CommentTags` writes `['e', id, '', 'root'|'reply']` with no
   pubkey. Adding the pubkey improves outbox resolution but requires
   knowing the parent event's author for the `reply` case (easy — it's
   `parentEvent.pubkey`) and the root's author for the `root` case
   (harder — caller must supply or infer).

4. **NIP-22 relay hints empty.** `buildNip22CommentTags` reads
   `event.tags.find((t) => t[0] === 'relay')?.[1] || ''` for the relay
   hint, which is almost never populated on Nostr events. Better: pull
   from the event's seen-on relay set (NDK exposes this via
   `event.onRelays` or similar). Improves replay / deep-link resolution.

### Stage 5 prep

5. **Toast primitive.** No global toast/notification component exists in
   the codebase (`src/components/` and `src/lib/` verified clean). Stage 5
   unifies comment error UI to "explicit sign + publish timeout + inline
   toast" — that UI doesn't exist yet. Build a generic `<Toast />`
   component (or adopt an existing Svelte notification library already
   in `package.json` if one ends up there) before Stage 5 implementation.
   Owners: whoever picks up Stage 5.

### Future privacy feature

6. **NIP-89 client-tag opt-out.** Per NIP-89 §"Client tag": "This tag has
   privacy implications for users, so clients SHOULD allow users to opt
   out of using this tag." `src/lib/nip89.ts:addClientTagToEvent` currently
   appends the client tag unconditionally. Add a user setting
   ("Identify as zap.cooking on events I publish", default on) and gate
   the append. Affects every publish path.

## Nourish flag mechanism (feat/nourish-flag)

### Deferred UI placements

7. **Flag affordance on NourishPill hover card + NourishModal summary.**
   Phase 2 committed to these; commit 4 deferred because neither surface
   currently receives the recipe FlagTarget as a prop. The three
   NourishDimensionBar rows inside NourishResult cover the primary
   engaged-user path. Adding the pill-preview and modal-summary flag
   requires threading `{aTag, nourishEventId?}` into those components.
   Low-effort once the Nourish event id starts being tracked alongside
   scores — which is a separate open question below.

8. **Track the Nourish event id alongside cached scores.**
   `src/lib/nourish/cache.ts` stores scores keyed by recipe event id but
   doesn't capture the kind 30078 Nourish event's own id returned from
   the pantry relay or API. Capturing it would let flag events carry a
   precise `["e", nourishEventId]` for admin triage ("which specific
   scoring was flagged"). `flagSubmit.ts` already treats
   `FlagTarget.nourishEventId` as optional; adding it is purely a
   richer signal.

### Admin auth + discoverability

9. **NIP-98 signed HTTP-auth on admin endpoints.** Current pattern
   (`x-admin-pubkey` header checked against `ADMIN_PUBKEY`) is the
   existing codebase precedent (also in /sponsors) but weak — anyone who
   knows the admin pubkey can spoof it. Upgrade path: require a NIP-98
   signed Authorization header and verify the signature server-side.
   Affects `/api/admin/nourish-flags` and `/api/sponsors`.

10. **Admin nav entry for /admin/nourish-flags when usage patterns
    justify.** v1 is unlinked — navigate manually. Once the page is
    used regularly, add a nav link gated on `isAdmin($userPublickey)`.

### Spam / abuse contingencies

11. **Turnstile on anon flag endpoint if spam appears.** Not in v1.
    Current limits (1/min, 10/hr, 30/day per ipHash) are an effective
    floor. If anon flag volume grows disproportionate to legitimate
    traffic growth, gate POST /api/nourish/flag behind a Cloudflare
    Turnstile token. Two-hour change.

12. **Per-pubkey rate cap for signed flags.** Currently unlimited on
    the Nostr publish path (social pressure + public pubkey = self-
    policing). If a user brigades from their own pubkey, add a 24h cap
    (e.g., 50 signed flags per day per pubkey) at the client-side
    `flagSubmit.submitSignedFlag` pre-check. Server can't easily enforce
    this on a public relay; enforcement lives at the admin view where
    per-pubkey concentration is visible.

### Observability

13. **Popover open-rate vs submit-rate analytics.** Measures how much
    friction the popover adds. Currently no client-side analytics
    infrastructure; when one lands, instrument
    `NourishFlagButton.handleIconClick` (open) and `handleSubmit` (submit)
    to emit events.

14. **Progressive error back-off on repeated 429s.** The 429 response
    already carries `{retryAfter, scope}`. Client could track rate-limit
    hits locally and lengthen its cooldown before re-submitting. Not
    needed for v1 — the UX tells the user to slow down.

### Differentiated error messages

15. **Signing-cancelled / network-timeout / generic error messages on
    flag submission.** Currently all errors map to
    "Couldn't submit your flag — please try again." Better granularity
    helps users self-correct (e.g., "Please connect to the network and
    try again" vs "You cancelled signing in your extension"). Also
    applies to comment-post error path from Task 6 Stage 5.
