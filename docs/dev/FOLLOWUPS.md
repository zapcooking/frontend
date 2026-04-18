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
