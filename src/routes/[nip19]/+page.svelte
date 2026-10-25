<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { get } from 'svelte/store';
  import { lastFeedUrl } from '$lib/feedOrigin';

  // Back to the feed tab the user came from (captured by the root
  // layout on navigation away from /feed), falling back to the
  // feed root when the note was opened cold (link, notification…).
  function backToFeed() {
    goto(get(lastFeedUrl) ?? '/feed');
  }
  import { browser } from '$app/environment';
  import { nip19 } from 'nostr-tools';
  import { ndk, userPublickey } from '$lib/nostr';
  import { mutedPubkeys, muteListStore } from '$lib/muteListStore';
  import { isEventMutedBy } from '$lib/muteFilter';
  import {
    replyDraftsStore,
    replyDraftResumeTarget,
    prunePublishedReplyDrafts
  } from '$lib/replyDraftStore';
  import { onMount, onDestroy, tick } from 'svelte';
  import Avatar from '../../components/Avatar.svelte';
  import CustomName from '../../components/CustomName.svelte';
  import NoteContent from '../../components/NoteContent.svelte';
  import PollDisplay from '../../components/PollDisplay.svelte';
  import NoteActionBar from '../../components/NoteActionBar.svelte';
  import NoteReactionPills from '../../components/NoteReactionPills.svelte';
  import ThreadRow from '../../components/comments/ThreadRow.svelte';
  import SubReplyList from '../../components/comments/SubReplyList.svelte';
  import { buildReplyTree, getReplyParentId, getThreadRootId } from '$lib/thread/replyParent';
  import { splitThreadByFocus } from '$lib/thread/threadScope';
  import PowBadge from '../../components/PowBadge.svelte';
  import { NDKRelaySet } from '@nostr-dev-kit/ndk';
  import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';
  import { fetchEventViaRepostEmbed, repostLookupRelayUrls } from '$lib/repostEmbed';
  import { createCommentFilter } from '$lib/commentFilters';
  import { stripTrackingParams } from '$lib/utils/stripTrackingParams';
  import PostActionsMenu from '../../components/PostActionsMenu.svelte';
  import ReplyModal from '../../components/comments/ReplyModal.svelte';
  import ReplyComposer from '../../components/comments/ReplyComposer.svelte';
  import RightRail from '../../components/RightRail.svelte';
  import RailCard from '../../components/RailCard.svelte';
  import PersonRow from '../../components/PersonRow.svelte';
  import { requireAuth } from '$lib/auth/requireAuth';
import { eventPath } from '$lib/utils/eventUrl';

  let decoded: any = null;
  let event: NDKEvent | null = null;
  let loading = true;
  let error = false;
  let authorName: string | null = null;
  // Track the identifier we've already loaded so the reactive block below
  // only fires loadEvent() when the nip19 param actually changes — not on
  // every $page update (e.g. the stripTrackingParams goto in onMount, which
  // strips query params but leaves the route param unchanged).
  let loadedNip19: string | undefined;

  // ── Client-side OG meta (no server load) ──────────────────────────
  // Derived from the note we fetch over NDK. Crawler-grade SSR OG was
  // removed with the +page.server.ts that caused the __data.json 500s.
  const IMG_EXT = /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)(\?.*)?$/i;
  const VID_EXT = /\.(mp4|webm|mov|avi|mkv|ogv)(\?.*)?$/i;
  const IMG_HOSTS = [
    'image.nostr.build', 'nostr.build', 'imgur.com', 'imgproxy',
    'primal.b-cdn.net', 'media.tenor.com', 'i.ibb.co'
  ];

  function extractFirstImageUrl(content: string): string | null {
    const urls = (content || '').match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
    for (const url of urls) {
      try {
        const u = new URL(url);
        if (VID_EXT.test(u.pathname)) continue;
        if (IMG_EXT.test(u.pathname)) return url;
        if (IMG_HOSTS.some((h) => u.hostname.includes(h))) {
          if (u.hostname.includes('nostr.build') && !u.pathname.includes('/i/')) continue;
          return url;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  function cleanNoteContent(content: string): string {
    const text = (content || '')
      .replace(/nostr:[a-z0-9]+/gi, '')
      .replace(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|svg|bmp|avif|mp4|webm|mov)(\?[^\s]*)?/gi, '')
      .replace(/https?:\/\/[^\s]+/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length > 155) {
      const truncated = text.slice(0, 155);
      const lastSpace = truncated.lastIndexOf(' ');
      const lastSentence = Math.max(
        truncated.lastIndexOf('.'),
        truncated.lastIndexOf('!'),
        truncated.lastIndexOf('?')
      );
      if (lastSentence > 80) return text.slice(0, lastSentence + 1);
      return (lastSpace > 80 ? truncated.slice(0, lastSpace) : truncated) + '...';
    }
    return text || 'A note shared on zap.cooking';
  }

  // Resolve the author's display name for the OG title once the note loads.
  $: if (event?.author) {
    event.author
      .fetchProfile()
      .then((p) => {
        authorName = p?.displayName || p?.name || null;
      })
      .catch(() => {});
  }

  $: ogTitle = authorName ? `${authorName} on zap.cooking` : 'Note on zap.cooking';
  $: ogDescription = event
    ? cleanNoteContent(event.content)
    : 'A note shared on zap.cooking - Food is Open Source';
  $: ogImage = (event && extractFirstImageUrl(event.content)) || 'https://zap.cooking/social-share.png';
  $: ogCreatedAt = event?.created_at ?? null;

  // Thread hierarchy
  let parentThread: NDKEvent[] = []; // Parent notes above this one
  let loadingParents = false;

  // Replies/comments
  let replies: NDKEvent[] = [];
  let loadingReplies = false;
  let processedReplies = new Set<string>();
  // Ids named by kind-5 deletion events (NIP-09) arriving on the thread
  // subscription. Applied reactively downstream so ordering never matters —
  // a deletion landing before its target still removes it.
  let deletedReplyIds = new Set<string>();

  // The replies subscription is closeOnEose:false (live for realtime
  // replies). It MUST be stopped when re-fetching for another note and
  // when leaving the page — previously it was never stopped at all, so
  // every note-to-note navigation stacked another live subscription,
  // each re-sorting its (retained) replies array on every incoming
  // event forever. That leak is what froze deep-linking sessions.
  let replySub: NDKSubscription | null = null;

  // Batch reply arrivals: busy notes deliver dozens of replies in the
  // initial burst, and each one used to pay a full array copy + sort.
  const REPLY_FLUSH_MS = 200;
  let pendingReplies: NDKEvent[] = [];
  let replyFlushTimer: ReturnType<typeof setTimeout> | null = null;

  function flushPendingReplies() {
    replyFlushTimer = null;
    if (pendingReplies.length === 0) return;
    const batch = pendingReplies;
    pendingReplies = [];
    replies = [...replies, ...batch].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  }

  function stopReplySubscription() {
    if (replySub) {
      try {
        replySub.stop();
      } catch {
        // NDK subscriptions can throw on repeated stop; swallow.
      }
      replySub = null;
    }
    if (replyFlushTimer) {
      clearTimeout(replyFlushTimer);
      replyFlushTimer = null;
    }
    pendingReplies = [];
  }

  onDestroy(() => {
    stopReplySubscription();
    if (arrivalFlashTimer) clearTimeout(arrivalFlashTimer);
  });

  // Fetch parent thread recursively
  // Parent notes frequently live on the reply author's write relays, not
  // the default pool — the same reason fetchReplies builds a merged relay
  // set. Without the hints (and on a cold deep link, before the pool has
  // finished connecting), the parent fetch came back null, the walk broke
  // immediately, and the thread rendered as just the reply until a manual
  // reload warmed everything.
  function buildParentRelaySet(evt: NDKEvent): NDKRelaySet | undefined {
    try {
      const extraUrls = new Set<string>();
      const sourceRelay = evt.relay?.url || (evt as any).onRelays?.[0]?.url;
      if (sourceRelay?.startsWith('wss://')) extraUrls.add(sourceRelay);
      for (const tag of evt.tags) {
        if ((tag[0] === 'e' || tag[0] === 'p') && tag[2]?.startsWith('wss://')) {
          extraUrls.add(tag[2]);
        }
      }
      if (extraUrls.size === 0 || !$ndk) return undefined;
      const poolUrls = Array.from($ndk.pool?.relays?.keys?.() ?? []);
      if (poolUrls.length === 0) return undefined; // default pool, not hints-only
      const merged = [...new Set([...poolUrls, ...[...extraUrls].slice(0, 3)])];
      return NDKRelaySet.fromRelayUrls(merged, $ndk, true);
    } catch {
      return undefined;
    }
  }

  async function fetchParentById(
    parentId: string,
    relaySet: NDKRelaySet | undefined
  ): Promise<NDKEvent | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        // Cold-start window: give pool/hint relays a moment to finish
        // connecting before retrying.
        await new Promise((r) => setTimeout(r, 600 * attempt));
      }
      try {
        // By id only: a NIP-22 comment's `E` parent can be a kind-30023
        // article (or any other root kind), and a kinds list here would
        // stop the ancestor chain at the first such parent.
        const note = await $ndk.fetchEvent({ ids: [parentId] }, undefined, relaySet);
        if (note) return note;
      } catch {
        // Try again — a dropped socket mid-fetch is transient.
      }
    }
    return null;
  }

  async function fetchParentThread(evt: NDKEvent) {
    loadingParents = true;
    const parents: NDKEvent[] = [];
    let currentEvent = evt;
    const seenIds = new Set<string>();

    try {
      while (true) {
        const parentId = getReplyParentId(currentEvent);
        if (!parentId || seenIds.has(parentId)) break;

        seenIds.add(parentId);

        const parentNote = await fetchParentById(parentId, buildParentRelaySet(currentEvent));
        if (!parentNote) break;

        parents.unshift(parentNote); // Add to beginning for chronological order
        currentEvent = parentNote;

        // Limit depth to prevent infinite loops
        if (parents.length >= 10) break;
      }
    } catch {
      // Failed to fetch parent thread
    }

    // Re-root: for a comment, the conversation root is its uppercase `E` —
    // the lowercase-`e` walk above dead-ends at the parent note and never
    // reaches it. Fetch the root directly, best-effort, so a thread opened
    // on a comment can still show where the conversation started; when the
    // root is gone from every relay (comments can outlive it) the context
    // collected so far plus the subtree below is what's left to show.
    if (evt.kind === 1111) {
      const rootId = getThreadRootId(evt);
      if (
        rootId &&
        rootId !== evt.id &&
        !seenIds.has(rootId) &&
        !parents.some((p) => p.id === rootId)
      ) {
        const rootNote = await fetchParentById(rootId, buildParentRelaySet(evt));
        if (rootNote) parents.unshift(rootNote);
      }
    }

    parentThread = parents;
    loadingParents = false;
  }

  function gotoNoteUnlessInteractive(e: MouseEvent, evt: NDKEvent) {
    if (e.target instanceof Element && e.target.closest('a, button')) return;
    goto(eventPath(evt));
  }

  // Fetch replies to this note
  function fetchReplies(eventId: string) {
    stopReplySubscription();
    loadingReplies = true;
    replies = [];
    processedReplies.clear();
    deletedReplyIds = new Set();

    if (!event) return;

    // Sibling filters in ONE REQ (relay-side OR): `#e` walks the NIP-10
    // tree (plus kind-5 deletions), `#E` the NIP-22 comment tree rooted at
    // the conversation root. Merged into a single filter object they would
    // AND and match nothing beyond top-level comments.
    const filters = createCommentFilter(event);

    // Build a wider relay set: NDK's default pool + the relay that served the
    // main event + any relay hints embedded in the event's e/E/p tags.
    // This handles the common case where replies live on the author's write
    // relay but not on all of NDK's default pool relays.
    let relaySet: NDKRelaySet | undefined;
    try {
      const extraUrls = new Set<string>();
      // Relay that served the main event
      const sourceRelay = event.relay?.url || event.onRelays?.[0]?.url;
      if (sourceRelay) extraUrls.add(sourceRelay);
      // Relay hints in event e/E/p tags (NIP-10/NIP-22 clients include them)
      for (const tag of event.tags) {
        if ((tag[0] === 'e' || tag[0] === 'E' || tag[0] === 'p') && tag[2]?.startsWith('wss://')) {
          extraUrls.add(tag[2]);
        }
      }
      // Query the default pool AND the extra relays. A relaySet passed to
      // subscribe() is queried exclusively, so restricting to the extras alone
      // (as before) meant replies on the default pool were missed whenever an
      // event carried hints — and none at all if those hints were unreachable.
      // If the pool is empty or unreadable (e.g. during startup), leave the
      // set undefined so NDK uses its default pool — a set built from hints
      // alone would reintroduce the exclusive hints-only behavior.
      if (extraUrls.size > 0 && $ndk) {
        const poolUrls = Array.from($ndk.pool?.relays?.keys?.() ?? []);
        if (poolUrls.length > 0) {
          const merged = [...new Set([...poolUrls, ...[...extraUrls].slice(0, 3)])];
          relaySet = NDKRelaySet.fromRelayUrls(merged, $ndk, true);
        }
      }
    } catch { /* non-fatal — fall back to the default pool */ }

    replySub = $ndk.subscribe(filters, { closeOnEose: false }, relaySet);

    replySub.on('event', (e: NDKEvent) => {
      if (processedReplies.has(e.id)) return;
      processedReplies.add(e.id);
      if (e.kind === 5) {
        // NIP-09 deletion of a thread event: its `e` tags name the ids to
        // remove. Never rendered as a row itself.
        const targets = e.tags.filter((t) => t[0] === 'e' && t[1]).map((t) => t[1] as string);
        if (targets.length > 0) {
          deletedReplyIds = new Set([...deletedReplyIds, ...targets]);
        }
        return;
      }
      pendingReplies.push(e);
      if (replyFlushTimer === null) {
        replyFlushTimer = setTimeout(flushPendingReplies, REPLY_FLUSH_MS);
      }
    });

    replySub.on('eose', () => {
      if (replyFlushTimer !== null) {
        clearTimeout(replyFlushTimer);
        replyFlushTimer = null;
      }
      flushPendingReplies();
      loadingReplies = false;
    });

    // Timeout
    setTimeout(() => {
      loadingReplies = false;
    }, 5000);
  }

  async function loadEvent(nip19Id: string) {
    decoded = null;
    event = null;
    parentThread = [];
    replies = [];
    loading = true;
    error = false;

    if (!nip19Id) {
      error = true;
      loading = false;
      return;
    }

    if (nip19Id.startsWith('nostr:')) {
      nip19Id = nip19Id.split('nostr:')[1];
    }

    // Plain zap.cooking NIP-05 username (not a NIP-19 identifier): resolve to
    // a pubkey via /.well-known/nostr.json and redirect to the profile page.
    // This mirrors the behavior the deleted +page.server.ts used to provide.
    const isNip19 = /^(?:npub1|nprofile1|note1|nevent1|naddr1)/.test(nip19Id);
    if (!isNip19 && /^[a-zA-Z0-9_]{3,20}$/.test(nip19Id)) {
      const username = nip19Id.toLowerCase();
      try {
        const res = await fetch('/.well-known/nostr.json?name=' + encodeURIComponent(username));
        if (res.ok) {
          const json = await res.json();
          const pubkey = json?.names?.[username];
          if (pubkey) {
            goto(`/user/${nip19.npubEncode(pubkey)}`);
            return;
          }
        }
      } catch {
        // Resolution failed — fall through to the not-found state below.
      }
    }

    // Validate NIP-19 identifier format
    if (nip19Id.length < 8 || !nip19Id.match(/^[a-z0-9]+$/)) {
      error = true;
      loading = false;
      return;
    }

    try {
      // Decode the NIP-19 identifier
      decoded = nip19.decode(nip19Id);

      if (decoded.type === 'nevent' || decoded.type === 'note') {
        // Fetch the referenced event
        let eventId = '';
        let neventRelays: string[] = [];
        switch (decoded.type) {
          case 'nevent':
            eventId = (decoded as nip19.DecodedNevent).data.id;
            neventRelays = ((decoded as nip19.DecodedNevent).data.relays ?? [])
              .filter((r) => r.startsWith('wss://'))
              .slice(0, 3);
            break;
          case 'note':
            eventId = (decoded as nip19.DecodedNote).data;
            break;
        }
        const filter = {
          ids: [eventId]
        };

        // Include relay hints from nevent1 when fetching the main event — but
        // ADDITIVELY, on top of the default pool. NDK queries a passed relaySet
        // exclusively, so building it from the hints alone means a note whose
        // hints are dead or paywalled (e.g. 503/403) never loads even though it
        // lives on the default relays. Merge the current pool with the hints so
        // both are queried; if the pool is empty or can't be read, fall back
        // to no set (default pool) rather than a hints-only set.
        let eventRelaySet: NDKRelaySet | undefined;
        if (neventRelays.length > 0 && $ndk) {
          try {
            const poolUrls = Array.from($ndk.pool?.relays?.keys?.() ?? []);
            if (poolUrls.length > 0) {
              const merged = [...new Set([...poolUrls, ...neventRelays])];
              eventRelaySet = NDKRelaySet.fromRelayUrls(merged, $ndk, true);
            }
          } catch { /* non-fatal — fall back to the default pool */ }
        }

        const subscription = $ndk.subscribe(filter, { closeOnEose: false }, eventRelaySet);
        let resolved = false;

        function finishWithEvent(receivedEvent: NDKEvent) {
          if (event) return;
          event = receivedEvent;
          // Fetch parent thread and replies
          fetchParentThread(receivedEvent);
          fetchReplies(receivedEvent.id);
          loading = false;
        }

        subscription.on('event', (receivedEvent: NDKEvent) => {
          if (!event) finishWithEvent(receivedEvent);
        });

        async function settle() {
          if (resolved) return;
          resolved = true;
          try {
            subscription.stop();
          } catch {
            // NDK subscriptions can throw on repeated stop; swallow.
          }
          if (event) {
            loading = false;
            return;
          }

          // Year-old or thinly-relayed events are often gone from every pool
          // relay even though a REPOST of them is easy to find — kind-6/16
          // wrappers embed the full original event JSON. Before declaring the
          // note missing, reconstruct it from a repost's embedded copy; the
          // reconstructed event carries the original id/tags, so the parent
          // walk, replies, and commenting all work off it. The lookup fans
          // out past the (often 1-2 relay) pool to the big aggregators where
          // those reposts survive.
          const poolUrls = Array.from($ndk.pool?.relays?.keys?.() ?? []);
          const viaRepost = await fetchEventViaRepostEmbed(
            $ndk,
            eventId,
            undefined,
            repostLookupRelayUrls(poolUrls)
          );
          if (event) {
            loading = false;
            return;
          }
          if (viaRepost) {
            finishWithEvent(viaRepost);
          } else {
            error = true;
            loading = false;
          }
        }

        subscription.on('eose', () => void settle());

        // Handle timeout - resolve with whatever we have
        setTimeout(() => void settle(), 5000);
      } else {
        error = true;
        loading = false;
      }
    } catch {
      error = true;
      loading = false;
    }
  }

  $: if (browser && $page.params.nip19 && $page.params.nip19 !== loadedNip19) {
    loadedNip19 = $page.params.nip19;
    // Re-arm the arrival scroll on every visit. The route component is
    // reused across notes, so reply A → its root → A again would otherwise
    // still match the guard (the root never resets it) and skip the scroll.
    resetArrival();
    loadEvent($page.params.nip19);
  }

  // Compact "X-unit-ago" formatter for note headers (e.g. "10m", "3h",
  // "2d", "1y"). Mirrors the helper in FoodstrFeedOptimized — short
  // form avoids mid-phrase wrap on mobile.
  function formatTimeAgo(timestamp: number): string {
    const seconds = Math.floor(Date.now() / 1000) - timestamp;
    if (seconds < 60) return 'now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 365) return `${days}d`;
    return `${Math.floor(days / 365)}y`;
  }


  onMount(() => {
    stripTrackingParams($page.url);
    if ($userPublickey) {
      muteListStore.load();
    }
  });

  function handleReplyPosted(posted: NDKEvent) {
    if (processedReplies.has(posted.id)) return;
    processedReplies.add(posted.id);
    replies = [...replies, posted].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  }

  // A proof-of-work reply publishes from a background job; if the page
  // unloads between the relay accepting the event and the job's own draft
  // cleanup, the draft record survives the reload and the reply box offers
  // to "continue" words that are already on the wire. Reconcile whenever
  // the thread's replies settle: drop any stored draft of this account
  // whose raw text exactly matches a published reply to this thread. Text
  // is the published wire form (mentions substituted), the draft keeps the
  // raw form — but a reply with no mentions has the same text in both, and
  // that is the common case this catches. An edited draft never matches
  // exactly, so real unsent work always survives the sweep.
  function pruneDraftsMatchingPublished(): void {
    if (!$userPublickey) return;
    prunePublishedReplyDrafts((draft) => {
      if (draft.pubkey !== $userPublickey) return false;
      // Exact wire-text match: the common no-mention reply, where the raw
      // draft text and the published content are identical. Drafts with
      // media/poll slots carry their URLs in the wire content too, so an
      // exact match still holds for those. A draft the member has edited
      // or a fresh reply with different words never matches exactly and
      // always survives.
      return replies.some(
        (r) =>
          (r.author?.hexpubkey || r.pubkey) === $userPublickey &&
          r.content === draft.text
      );
    });
  }

  // Run after the initial reply batch lands and again as replies arrive —
  // a mid-mine reload means the published reply may arrive after the page.
  $: if (replies.length > 0 && $userPublickey) {
    pruneDraftsMatchingPublished();
  }

  // Every reply hangs off exactly one parent, resolved in one place, so
  // the ancestors above the note and the tree below it can't disagree.
  // Mutes (author, word, tag, thread, and note-and-replies) apply through
  // the same position-aware check the feeds use.
  $: visibleReplies = replies.filter(
    (r) =>
      r.kind !== 5 &&
      !deletedReplyIds.has(r.id) &&
      !isEventMutedBy($muteListStore.muteList, r)
  );
  // The sibling-filter fetch returns the whole conversation — including
  // the focused note's own ancestors, which match `#E` like any other
  // comment. Split them off so a parent never renders as its own child,
  // and merge them into the context rows the parent walk collected.
  $: scopedThread = event
    ? splitThreadByFocus<NDKEvent>(event, visibleReplies)
    : { ancestors: [] as NDKEvent[], subtree: [] as NDKEvent[] };
  $: contextRows = (() => {
    const byId = new Map<string, NDKEvent>();
    for (const p of parentThread) if (p.id && !byId.has(p.id)) byId.set(p.id, p);
    for (const a of scopedThread.ancestors) if (a.id && !byId.has(a.id)) byId.set(a.id, a);
    return [...byId.values()].sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  })();
  // Replies answering one of these belong to an ancestor's branch, not to
  // the focused note's conversation — buildReplyTree keeps them (and their
  // whole descendant chains) out of the tree under the note, so a thread
  // view shows only the replies that actually answer the note or its
  // visible replies. The root view passes an empty set: everything renders.
  $: ancestorIds = new Set(contextRows.map((r) => r.id).filter(Boolean));
  $: parentToChildren = event
    ? buildReplyTree<NDKEvent>(event.id, scopedThread.subtree, event, ancestorIds)
    : new Map<string, NDKEvent[]>();
  $: directReplies = (event && parentToChildren.get(event.id)) || [];

  // Landing on a note that has ancestors above it — a reply opened from a
  // notification — must arrive ON the reply. The viewport starts at the top
  // of the thread, so a long parent otherwise fills the screen while the
  // focused note sits below the fold, reading as "opened the wrong note".
  // Once the ancestor rows have rendered, scroll the focused note to the
  // top edge (its scroll-margin keeps it clear of the fixed header) and
  // flash it so the arrival point is unmistakable. Root views have no
  // context rows and never scroll.
  let mainNoteEl: HTMLElement | null = null;
  let scrolledForEventId: string | null = null;
  let arrivalFlash = false;
  let arrivalFlashTimer: ReturnType<typeof setTimeout> | null = null;
  function resetArrival() {
    scrolledForEventId = null;
    arrivalFlash = false;
    if (arrivalFlashTimer) clearTimeout(arrivalFlashTimer);
    arrivalFlashTimer = null;
  }
  $: if (
    event &&
    !loadingParents &&
    contextRows.length > 0 &&
    scrolledForEventId !== event.id
  ) {
    scrolledForEventId = event.id;
    void tick().then(() => {
      requestAnimationFrame(() => {
        mainNoteEl?.scrollIntoView({ block: 'start', behavior: 'auto' });
        arrivalFlash = true;
        if (arrivalFlashTimer) clearTimeout(arrivalFlashTimer);
        arrivalFlashTimer = setTimeout(() => (arrivalFlash = false), 1600);
      });
    });
  }

  // id → author for everything in view, so each reply row can say which
  // note it answers ("Replying to @x").
  $: authorById = (() => {
    const m = new Map<string, string>();
    const put = (e?: NDKEvent | null) => {
      const id = e?.id;
      const pk = e?.author?.hexpubkey || e?.pubkey;
      if (id && pk && !m.has(id)) m.set(id, pk);
    };
    put(event);
    for (const r of contextRows) put(r);
    for (const r of scopedThread.subtree) put(r);
    return m;
  })();
  // The conversation root, when it's in view — the root-scope source for
  // replies published from the modal. Falls back to the focused note (same
  // root tag the inline composer always wrote).
  $: threadRootEvent = (() => {
    if (!event) return undefined;
    const rootId = getThreadRootId(event);
    if (!rootId || rootId === event.id) return event;
    return contextRows.find((r) => r.id === rootId) ?? event;
  })();

  // Reply modal state. `replyModalTarget` is the specific note being
  // answered, undefined = the focused note itself. Replying to the thread
  // root is a top-level reply — no replyTo, so no reply tag is written.
  let replyModalOpen = false;
  let replyModalTarget: NDKEvent | undefined = undefined;

  async function openReplyModal(target?: NDKEvent) {
    if (!(await requireAuth({ kind: 'reply', reason: 'Sign in to reply' }))) return;
    replyModalTarget = target;
    replyModalOpen = true;
  }

  $: replyModalBase = replyModalTarget ?? event;
  $: replyModalReplyTo =
    replyModalBase && threadRootEvent && replyModalBase.id !== threadRootEvent.id
      ? replyModalBase
      : undefined;

  // Top-level notes (thread roots) get the composer inline, directly below
  // the note like the iOS detail view. Reply-focused views keep the
  // modal-first flow — a composer stranded under a nested thread was
  // exactly what read confusingly.
  $: isTopLevelFocus = event ? getReplyParentId(event) === null : false;

  // A tap on a reply-draft pill routed here to continue the draft. The
  // inline box (top-level notes) restores on its own; a mid-thread note
  // needs its modal opened.
  $: if (event && $replyDraftResumeTarget === event.id) {
    replyDraftResumeTarget.set(null);
    if (!isTopLevelFocus) {
      openReplyModal();
    }
  }

  // The focused note has a saved draft → the pseudo-input says so. Read
  // from the store (not a plain get) so saves/deletes re-run this.
  $: focusedDraftPreview = (() => {
    $replyDraftsStore.length; // reactive dependency on draft changes
    // Narrowing doesn't survive into the find() callback for the mutable
    // `event` binding — read it into a const first.
    const current = event;
    if (!current || isTopLevelFocus) return '';
    return (
      $replyDraftsStore.find(
        (d) => d.targetId === current.id && d.pubkey === $userPublickey
      )?.preview ?? ''
    );
  })();

  // People in this note: author first, then anyone mentioned (p-tags), then
  // reply authors — deduped, mute-filtered, and capped for the rail.
  $: participants = (() => {
    const order: string[] = [];
    const seen = new Set<string>();
    const add = (pk?: string | null) => {
      if (!pk || seen.has(pk) || $mutedPubkeys.has(pk)) return;
      seen.add(pk);
      order.push(pk);
    };
    if (event) {
      add(event.author?.hexpubkey || event.pubkey);
      for (const t of event.tags || []) {
        if (t[0] === 'p' && t[1]) add(t[1]);
      }
    }
    for (const r of directReplies) add(r.author?.hexpubkey || r.pubkey);
    return order.slice(0, 12);
  })();

  // Progressive disclosure, jumble-style: direct replies render
  // chronologically in the root list, and each one's nested conversation
  // folds behind a "Show replies" toggle under it. The toggle lives in
  // SubReplyList — the parent row carries none.
</script>

<svelte:head>
  <title>{ogTitle}</title>
  <meta name="description" content={ogDescription} />

  <!-- Open Graph -->
  <meta property="og:type" content="article" />
  <meta property="og:url" content={`https://zap.cooking/${$page.params.nip19}`} />
  <meta property="og:title" content={ogTitle} />
  <meta property="og:description" content={ogDescription} />
  <meta property="og:image" content={ogImage} />
  <meta property="og:site_name" content="zap.cooking" />
  {#if ogCreatedAt}
    <meta property="article:published_time" content={new Date(ogCreatedAt * 1000).toISOString()} />
  {/if}

  <!-- Twitter -->
  <meta name="twitter:card" content={ogImage !== 'https://zap.cooking/social-share.png' ? 'summary_large_image' : 'summary'} />
  <meta name="twitter:title" content={ogTitle} />
  <meta name="twitter:description" content={ogDescription} />
  <meta name="twitter:image" content={ogImage} />
</svelte:head>

<div class="note-page-layout">
  <div class="max-w-2xl px-4 w-full min-w-0">
  <!-- Back link -->
  {#if !loading}
    <div class="pt-4 pb-2">
      <button
        on:click={backToFeed}
        class="flex items-center gap-1 text-sm transition-opacity hover:opacity-70"
        style="color: var(--color-caption)"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M15 19l-7-7 7-7"
          />
        </svg>
        Feed
      </button>
    </div>
  {/if}

  {#if loading}
    <div class="py-12 text-center">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
      <p class="mt-4" style="color: var(--color-caption)">Loading note...</p>
    </div>
  {:else if error}
    <div class="py-12 text-center">
      <div class="max-w-sm mx-auto space-y-6">
        <div style="color: var(--color-caption)">
          <svg
            class="h-12 w-12 mx-auto mb-4 opacity-50"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            ></path>
          </svg>
          <p class="text-lg font-medium">Note not found</p>
          <p class="text-sm">The referenced note could not be loaded.</p>
        </div>
      </div>
    </div>
  {:else if event && $mutedPubkeys.has(event.author?.hexpubkey || event.pubkey)}
    <!-- Muted user content -->
    <div class="py-12 text-center">
      <div class="max-w-sm mx-auto space-y-6">
        <div style="color: var(--color-caption)">
          <svg
            class="h-12 w-12 mx-auto mb-4 opacity-50"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
            />
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
            />
          </svg>
          <p class="text-lg font-medium">Content from muted user</p>
          <p class="text-sm">You have muted this user. Their content is hidden.</p>
        </div>
        <button
          on:click={backToFeed}
          class="px-4 py-2 bg-input rounded-lg hover:bg-accent-gray transition-colors"
          style="color: var(--color-text-primary)"
        >
          Back to Feed
        </button>
      </div>
    </div>
  {:else if event}
    <!-- Thread Header -->
    {#if parentThread.length > 0 || loadingParents}
      <div class="pt-4 pb-2">
        <div class="flex items-center gap-2 text-xs" style="color: var(--color-caption)">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          <span>Thread</span>
        </div>
      </div>
    {/if}

    <!-- Parent Thread (notes above) -->
    {#if loadingParents}
      <div class="py-4">
        <div class="animate-pulse space-y-3">
          <div class="flex gap-3">
            <div class="w-10 h-10 rounded-full skeleton-bg"></div>
            <div class="flex-1 space-y-2">
              <div class="h-4 rounded w-1/4 skeleton-bg"></div>
              <div class="h-4 rounded w-3/4 skeleton-bg"></div>
            </div>
          </div>
        </div>
      </div>
    {:else if contextRows.length > 0}
      <div class="space-y-0">
        {#each contextRows as parentNote, index}
          <div>
            <article class="py-3">
              <div class="flex space-x-3 -mx-2 px-2 py-2 rounded-lg">
                <div class="flex-shrink-0">
                  <a
                    href="/user/{nip19.npubEncode(
                      parentNote.author?.hexpubkey || parentNote.pubkey
                    )}"
                  >
                    <Avatar
                      pubkey={parentNote.author?.hexpubkey || parentNote.pubkey}
                      size={40}
                    />
                  </a>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center justify-between mb-1">
                    <div class="flex items-center space-x-2 min-w-0">
                      <a
                        href="/user/{nip19.npubEncode(
                          parentNote.author?.hexpubkey || parentNote.pubkey
                        )}"
                        class="font-semibold text-sm transition-colors username-link truncate min-w-0"
                        style="color: var(--color-text-primary)"
                      >
                        <CustomName pubkey={parentNote.author?.hexpubkey || parentNote.pubkey} />
                      </a>
                      <span class="text-sm flex-shrink-0" style="color: var(--color-caption)">·</span>
                      <span class="text-sm whitespace-nowrap flex-shrink-0" style="color: var(--color-caption)">
                        {parentNote.created_at ? formatTimeAgo(parentNote.created_at) : ''}
                      </span>
                    </div>
                    <PostActionsMenu event={parentNote} />
                  </div>
                  {#if parentNote.kind === 1068}
                    <PollDisplay event={parentNote} />
                  {:else}
                    <a
                      href="{eventPath(parentNote)}"
                      class="block text-base leading-relaxed hover:opacity-80"
                      style="color: var(--color-text-secondary)"
                    >
                      <NoteContent content={parentNote.content} showNostrEmbeds={false} />
                    </a>
                  {/if}
                  <!-- Parent note actions -->
                  <div class="mt-2">
                    <NoteActionBar
                      event={parentNote}
                      variant="compact"
                      showEngagementDetails={true}
                      onCommentClick={() => openReplyModal(parentNote)}
                    />
                  </div>
                </div>
              </div>
            </article>
          </div>
        {/each}
      </div>
    {/if}

    <!-- Main Note -->
    <!-- Focused note uses a header-on-top, full-width-body layout (avatar +
         name/time in a row, content spanning the full column below). This
         matches the focused-note presentation in Jumble, Primal, YakiHonne,
         and Iris, and gives a wider, more readable reading column than
         indenting the body under the avatar. Parent-thread context notes
         above keep the compact indented layout. -->
    <!-- When the thread opens on a reply, the focused note plus everything
         below it must be at least a viewport tall, or the arrival scroll
         clamps at the page bottom and leaves the parent half in view. -->
    <div class:focus-runway={contextRows.length > 0}>
    <article class="py-4 focused-note" bind:this={mainNoteEl} class:arrival-flash={arrivalFlash}>
      <div class="flex items-start justify-between gap-3 mb-2">
        <div class="flex items-center gap-3 min-w-0">
          <a
            href="/user/{nip19.npubEncode(event.author?.hexpubkey || event.pubkey)}"
            class="flex-shrink-0"
          >
            <Avatar
              className="cursor-pointer"
              pubkey={event.author?.hexpubkey || event.pubkey}
              size={44}
            />
          </a>
          <div class="flex flex-col min-w-0">
            <a
              href="/user/{nip19.npubEncode(event.author?.hexpubkey || event.pubkey)}"
              class="font-semibold text-base transition-colors username-link truncate min-w-0"
              style="color: var(--color-text-primary)"
            >
              <CustomName pubkey={event.author?.hexpubkey || event.pubkey} />
            </a>
            <div class="flex items-center space-x-2 flex-wrap">
              <span class="text-sm whitespace-nowrap flex-shrink-0" style="color: var(--color-caption)">
                {event.created_at ? formatTimeAgo(event.created_at) : 'Unknown time'}
              </span>
              <!-- Client attribution moved into the engagement drawer (iOS
                   drawer parity) — the header keeps relative time + PoW. -->
              <PowBadge id={event.id} tags={event.tags} />
            </div>
          </div>
        </div>
        <PostActionsMenu {event} />
      </div>
      <div class="text-[17px] leading-normal mb-2" style="color: var(--color-text-primary)">
        {#if event.kind === 1068}
          <PollDisplay {event} />
        {:else}
          <NoteContent content={event.content} {event} />
        {/if}
      </div>
      <!-- Emoji breakdown, not just a heart count: a note with four 👍
           and three ❤️ read as bare "0" here while every other client
           showed the pills. -->
      <NoteReactionPills {event} />
      <NoteActionBar {event} showCheffy={false} onCommentClick={() => openReplyModal()} />
    </article>

    <!-- Inline reply box directly below a top-level note (iOS detail-view
         parity); reply-focused views use the modal instead. -->
    {#if isTopLevelFocus && $userPublickey}
      <div
        class="mt-1 px-4 py-3.5 rounded-lg"
        style="background-color: var(--color-card-sunken)"
      >
        <div class="flex space-x-3 items-start">
          <div class="flex-shrink-0">
            <Avatar pubkey={$userPublickey} size={32} />
          </div>
          <div class="flex-1 min-w-0 -mt-3">
            <ReplyComposer
              parentEvent={event}
              draftKey={event.id}
              placeholder="Post your reply..."
              submitLabel="Reply"
              onPosted={handleReplyPosted}
            />
          </div>
        </div>
      </div>
    {:else if isTopLevelFocus}
      <div
        class="mt-1 px-4 py-3.5 rounded-lg text-sm"
        style="background-color: var(--color-card-sunken); color: var(--color-caption)"
      >
        <button type="button" class="text-primary hover:underline font-medium" on:click={() => requireAuth({ kind: 'reply', reason: 'Sign in to reply' })}>Log in</button> to reply
      </div>
    {/if}

    <!-- Replies Section -->
    <div class="mt-1">
      <!-- Replies List -->
      {#if loadingReplies}
        <div class="space-y-3">
          {#each [1, 2] as _}
            <div class="animate-pulse flex gap-3 p-3">
              <div class="w-8 h-8 rounded-full skeleton-bg"></div>
              <div class="flex-1 space-y-2">
                <div class="h-3 rounded w-1/4 skeleton-bg"></div>
                <div class="h-3 rounded w-full skeleton-bg"></div>
              </div>
            </div>
          {/each}
        </div>
      {:else if directReplies.length === 0}
        <p class="text-sm py-4 text-center" style="color: var(--color-caption)">
          No replies yet. {#if !$userPublickey}<button type="button" class="underline hover:opacity-80" style="color: var(--color-primary)" on:click={() => (isTopLevelFocus ? requireAuth({ kind: 'reply', reason: 'Sign in to reply' }) : openReplyModal())}>Sign in</button> to reply!{:else}Be the first to reply!{/if}
        </p>
      {:else}
        <!-- Jumble-style reply list: direct replies in chronological order,
             each with its nested conversation folded beneath it — so a
             direct reply to this note is never buried under another
             branch's subtree. The drawer of sub-replies owns its own
             toggle; the parent row carries none. -->
        <div class="thread-replies">
          {#each directReplies as reply (reply.id)}
            <ThreadRow
              event={reply}
              depth={0}
              onReply={() => openReplyModal(reply)}
              onCommentClick={() => openReplyModal(reply)}
              rootAuthor={event?.author?.hexpubkey || event?.pubkey}
              formatTime={formatTimeAgo}
            />
            <SubReplyList
              parentEvent={reply}
              {parentToChildren}
              {authorById}
              rootAuthor={event?.author?.hexpubkey || event?.pubkey}
              formatTime={formatTimeAgo}
              onReply={openReplyModal}
            />
          {/each}
        </div>
      {/if}

      <!-- Reply affordance for reply-focused views (top-level notes have
           the inline box above): opens the composer in a modal. -->
      {#if !isTopLevelFocus && $userPublickey}
        <button
          type="button"
          class="reply-pseudo-input"
          on:click={() => openReplyModal()}
        >
          <Avatar pubkey={$userPublickey} size={32} />
          <span class="reply-pseudo-placeholder">
            {#if focusedDraftPreview}
              Continue your reply — {focusedDraftPreview}
            {:else}
              Post your reply...
            {/if}
          </span>
        </button>
      {:else if !isTopLevelFocus}
        <div
          class="mt-4 px-4 py-3.5 rounded-lg text-sm"
          style="background-color: var(--color-card-sunken); color: var(--color-caption)"
        >
          <button type="button" class="text-primary hover:underline font-medium" on:click={() => openReplyModal()}>Log in</button> to reply
        </div>
      {/if}

      <ReplyModal
        bind:open={replyModalOpen}
        parentEvent={threadRootEvent ?? event}
        replyTo={replyModalReplyTo}
        onPosted={handleReplyPosted}
      />
    </div>
    </div>
  {/if}
  </div>

  {#if event && !error && participants.length > 0}
    <RightRail>
      <RailCard title="People in this thread">
        {#each participants as pk (pk)}
          <PersonRow pubkey={pk} />
        {/each}
      </RailCard>
    </RightRail>
  {/if}
</div>


<style>
  /* Thread page styles */

  /* Two-column layout: reading column + right rail (rail self-hides below
     2xl via RightRail's own media query). Left-aligned to the content grid. */
  .note-page-layout {
    display: flex;
    align-items: flex-start;
    gap: 3rem;
  }

  /* Each reply is a filled panel (no border), a shade darker than the page,
     matching the reply composer box below the list. */
  .thread-replies {
    /* Rows carry their own bottom rule; the list needs no gap. The last
       row's rule doubles as the boundary before the reply composer. */
    display: flex;
    flex-direction: column;
  }

  /* Username hover - orange color */
  .username-link:hover {
    color: var(--color-primary) !important;
  }

  /* Slim reply affordance — looks like the composer box it replaced, but
     only opens the modal. The composer itself never lives in the page. */
  .reply-pseudo-input {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    margin-top: 1rem;
    padding: 0.75rem 1rem;
    border: 1px solid var(--color-input-border);
    border-radius: 0.75rem;
    background-color: var(--color-card-sunken);
    cursor: pointer;
    text-align: left;
    transition: border-color 0.15s ease;
  }

  .reply-pseudo-input:hover {
    border-color: var(--color-primary);
  }

  .reply-pseudo-placeholder {
    color: var(--color-caption);
    font-size: 0.9375rem;
  }

  /* The focused note is the scroll-into-view target when the thread opens
     on a reply — keep it clear of the fixed header. */
  .focused-note {
    scroll-margin-top: calc(var(--header-h, 4rem) + 0.5rem);
  }

  /* Reply-focused views reserve a viewport of room from the focused note
     down, so scrollIntoView can always put it under the header. */
  .focus-runway {
    min-height: calc(100vh - var(--header-h, 4rem) - 0.5rem);
    min-height: calc(100dvh - var(--header-h, 4rem) - 0.5rem);
  }

  /* Brief tint that marks where a reply arrival landed, fading out. */
  .arrival-flash {
    animation: arrival-flash 1.6s ease-out 1;
  }
  @keyframes arrival-flash {
    from {
      background-color: color-mix(in srgb, var(--color-primary) 10%, transparent);
    }
    to {
      background-color: transparent;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .arrival-flash {
      animation: none;
    }
  }
</style>
