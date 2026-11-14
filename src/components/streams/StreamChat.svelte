<script lang="ts">
  /**
   * Live chat for one stream. For a NIP-53 stream it is NIP-53 live chat
   * (kind 1311 on the announcement address); for a Go live session it is
   * the replies to the host's "Live now" note (`target` = the note id; see
   * $lib/streams/chat). Go live adds: comments from accounts the host has
   * hidden are left out for everyone ($lib/live/chatHidden), the host gets
   * a Hide action on each comment, any signed-in viewer can report one
   * (the existing report path), and once the stream has ended the chat is
   * read-only. History pages backward
   * with an "Older messages" button, a live subscription appends new
   * messages, and posting signs through the app's NDK signer into the
   * stream's relays. Chat profiles read straight from relays (newest
   * kind 0 wins), with Sidecar-style stable pseudonyms as the fallback.
   */
  import { onDestroy, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { page } from '$app/stores';
  import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk';
  import type { SimplePool } from 'nostr-tools/pool';
  import type { Filter } from 'nostr-tools/filter';
  import { verifyEvent } from 'nostr-tools/pure';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import Avatar from '../Avatar.svelte';
  import PaperPlaneTiltIcon from 'phosphor-svelte/lib/PaperPlaneTilt';
  import { ndk } from '$lib/nostr';
  import { mutedPubkeys } from '$lib/muteListStore';
  import { extractZapAmountSats } from '$lib/zapAmount';
  import { openProfilePreview } from '$lib/stores/profilePreview';
  import { signedIn } from '$lib/auth/requireAuth';
  import { requireAuth } from '$lib/auth/requireAuth';
  import { ZapTotals } from '$lib/streams/zapTotals';
  import { resolveZapProvider } from '$lib/streams/zapProvider';
  import {
    ChatMessages,
    chatReplyParent,
    chatTemplate,
    fetchChatPage,
    fetchChatProfiles,
    subscribeChat,
    type ChatProfile
  } from '$lib/streams/chat';
  import { pseudonym } from '$lib/streams/parse';
  import { targetFilter, isEventTarget } from '$lib/streams/target';
  import { userPublickey } from '$lib/nostr';
  import { fetchHiddenAuthors } from '$lib/live/chatHidden';
  import { hideFromLiveChat } from '$lib/live/chatModeration';
  import { showToast } from '$lib/toast';
  import EyeSlashIcon from 'phosphor-svelte/lib/EyeSlash';
  import FlagIcon from 'phosphor-svelte/lib/Flag';
  import LiveReport from './LiveReport.svelte';
  import { mentionedPubkeys, tokenizeChatText, type ChatSegment } from '$lib/streams/chatText';
  import { dayDividerLabel, formatChatTime, isBeforeToday } from '$lib/streams/chatTime';
  import { DISCOVERY_RELAYS, RECEIPT_RELAYS } from '$lib/streams/relays';
  import { resolveAuthorPubkey, zapReceiptRelayUrls } from '$lib/nip65Routing';
  import type { NostrEventLike, StreamItem } from '$lib/streams/types';

  export let item: StreamItem;
  export let pool: SimplePool;
  /**
   * Top senders by verified sats, from the page's tally scan. Rendered as
   * the strip under the chat header, Sidecar-style.
   */
  export let topZappers: { pubkey: string; sats: number }[] = [];
  /**
   * What the chat hangs off: the stream's address (default) or, for a Go
   * live session, its "Live now" note id.
   */
  export let target: string | null = null;
  /** The stream has ended: the chat is shown read-only. */
  export let closed = false;

  const PAGE_SIZE = 50;
  const HISTORY_CAP = 1000;

  // Plain declarations: openChat() runs during component init, before any
  // `$:` reactive statement would have fired.
  let address = target || item.key;
  let sources = [...new Set([...(item.relays || []), ...DISCOVERY_RELAYS])];
  let model = new ChatMessages(item.key);
  let rows: TimelineRow[] = [];
  let loading = true;
  let historyBusy = false;
  let historyComplete = false;
  let notice = '';
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  let sending = false;
  let draft = '';
  let replyTo: NostrEventLike | null = null;
  let log: HTMLElement | null = null;
  let sub: { close: () => void } | null = null;
  let profiles = new Map<string, ChatProfile>();
  let profileKeysPending = new Set<string>();
  let profileTimer: ReturnType<typeof setTimeout> | null = null;
  /** Kind:9735 receipts targeting the stream, interleaved into the log. */
  let receipts = new Map<string, NostrEventLike>();
  /** Chronological eviction: bounded live-receipt cache. */
  const RECEIPT_CACHE_MAX = 500;
  let receiptSub: { close: () => void } | null = null;
  /** Per-component verified receipt store — forged rows can't get in. */
  let totals = new ZapTotals();
  let chatProvider: string | null = null;
  let chatProviderResolved = false;
  async function resolveChatProvider() {
    if (chatProviderResolved) return chatProvider;
    chatProviderResolved = true;
    try {
      chatProvider = (
        await resolveZapProvider(
          pool,
          [...new Set([...sources, ...(item.relays || [])])],
          item.host,
          new AbortController().signal
        )
      ).nostrPubkey;
      totals = new ZapTotals();
    } catch {
      chatProvider = null;
    }
    return chatProvider;
  }

  /**
   * A receipt is only accepted when the host's provider signed it and the
   * embedded request targets this stream — anything else is a forgeable
   * row and stays out of the timeline.
   */
  async function acceptReceipt(event: NostrEventLike): Promise<boolean> {
    const provider = await resolveChatProvider();
    if (!provider) return false;
    const accepted = await totals.accept(event, {
      address,
      recipient: item.host,
      provider,
      verify: verifyEvent as never,
      digest: (text) =>
        crypto.subtle
          .digest('SHA-256', new TextEncoder().encode(text))
          .then((bytes) =>
            [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
          )
    });
    if (!accepted) return false;
    // Bound the cache: drop the oldest receipts once past the cap.
    if (receipts.size >= RECEIPT_CACHE_MAX) {
      const oldest = model.rows()[0];
      void oldest;
      const keys = [...receipts.keys()].slice(0, receipts.size - RECEIPT_CACHE_MAX + 1);
      for (const k of keys) receipts.delete(k);
    }
    return true;
  }
  /**
   * Where receipts are listened for. Widened after open with the exact
   * relays a zap from THIS user targets (NIP-65 outbox): the provider
   * publishes the receipt only to the zap request's `relays` tag, so our
   * own zap's receipt lands there first — if the chat listened on the
   * generic aggregator set alone, zaps you just sent could go unseen live.
   */
  let receiptSources: string[] = [...sources, ...RECEIPT_RELAYS];

  async function widenReceiptSources() {
    try {
      const ndkInstance = get(ndk);
      if (!ndkInstance) return;
      const me = await resolveAuthorPubkey(ndkInstance);
      const urls = await zapReceiptRelayUrls(me, item.host);
      const widened = [...new Set([...receiptSources, ...urls])];
      const changed = widened.length !== receiptSources.length;
      receiptSources = widened;
      // Re-subscribe so the live receipt sub covers the widened set too.
      if (changed) subscribeReceipts();
    } catch {
      // No relay list — the base set still covers the aggregators.
    }
  }

  interface TimelineRow {
    event: NostrEventLike;
    sats?: number;
    sender?: string | null;
    comment?: string;
  }

  function receiptRow(event: NostrEventLike): TimelineRow | null {
    // Amounts were verified at acceptReceipt time via ZapTotals' invoice
    // parser; the row only needs sender + comment for display.
    const { sats } = extractZapAmountSats(event);
    if (sats <= 0) return null;
    let sender: string | null = null;
    let comment = '';
    const desc = event.tags.find((t) => t[0] === 'description');
    if (desc?.[1]) {
      try {
        const request = JSON.parse(desc[1]) as { pubkey?: unknown; content?: unknown };
        if (typeof request.pubkey === 'string' && /^[a-f0-9]{64}$/.test(request.pubkey)) {
          sender = request.pubkey;
        }
        if (typeof request.content === 'string') comment = request.content;
      } catch {
        // A receipt without a parsable request still shows its amount.
      }
    }
    return { event, sats, sender, comment };
  }

  /** Go live: accounts the host has hidden from the chat (public list). */
  let hiddenAuthors = new Set<string>();
  $: noteChat = isEventTarget(address);
  $: isHost = noteChat && !!$userPublickey && $userPublickey === item.host;

  async function loadHidden() {
    if (!isEventTarget(address)) return;
    const found = await fetchHiddenAuthors(pool, sources, item.host);
    if (found.size) {
      hiddenAuthors = new Set([...hiddenAuthors, ...found]);
      repaint();
    }
  }

  // A host's hide reaches viewers who are already watching within a minute.
  const hiddenTimer = setInterval(() => {
    if (typeof document === 'undefined' || !document.hidden) void loadHidden();
  }, 60_000);

  let hiding = new Set<string>();
  async function hide(pubkey: string) {
    if (hiding.has(pubkey)) return;
    hiding = new Set([...hiding, pubkey]);
    try {
      await hideFromLiveChat({ host: item.host, pubkey, pool, relays: sources });
      hiddenAuthors = new Set([...hiddenAuthors, pubkey]);
      repaint();
      showToast('success', `${displayName(pubkey)} is hidden from your live chat.`);
    } catch {
      showToast('error', 'Could not hide them right now. Check your connection and try again.');
    } finally {
      hiding.delete(pubkey);
      hiding = hiding;
    }
  }

  let reportOpen = false;
  let reportComment: { id: string; pubkey: string } | null = null;
  function report(event: NostrEventLike) {
    reportComment = { id: event.id, pubkey: event.pubkey };
    reportOpen = true;
  }

  function timelineFromModel(): TimelineRow[] {
    const muted = get(mutedPubkeys);
    const messages = model
      .rows()
      .filter((e) => !muted.has(e.pubkey) && !hiddenAuthors.has(e.pubkey))
      .map((event) => ({ event }));
    const zaps = [...receipts.values()].map(receiptRow).filter((row): row is TimelineRow => !!row);
    return [...messages, ...zaps].sort(
      (a, b) => a.event.created_at - b.event.created_at || a.event.id.localeCompare(b.event.id)
    );
  }

  // userPublickey can be restored while the passkey vault is locked —
  // signedIn reflects an actual usable session.
  $: signingIn = !get(signedIn);

  // Top-zapper chips show real names: fold them into the batched lookups.
  $: scheduleProfiles(topZappers.map((z) => z.pubkey));

  function compact(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
    return String(n);
  }

  function setNotice(text: string, duration = 0) {
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = null;
    notice = text;
    if (duration) noticeTimer = setTimeout(() => (notice = ''), duration);
  }

  /** Parsed message bodies, so a repaint does not re-scan every row's text. */
  const segmentCache = new Map<string, ChatSegment[]>();
  function segmentsOf(text: string): ChatSegment[] {
    let segments = segmentCache.get(text);
    if (!segments) {
      if (segmentCache.size > 2000) segmentCache.clear();
      segments = tokenizeChatText(text);
      segmentCache.set(text, segments);
    }
    return segments;
  }

  function displayName(pubkey: string): string {
    const p = profiles.get(pubkey);
    return p?.displayName || p?.name || pseudonym(pubkey);
  }

  function scheduleProfiles(keys: string[]) {
    for (const key of keys) {
      if (!profiles.has(key)) profileKeysPending.add(key);
    }
    if (profileKeysPending.size && !profileTimer) {
      profileTimer = setTimeout(flushProfiles, 250);
    }
  }

  async function flushProfiles() {
    profileTimer = null;
    const keys = [...profileKeysPending].slice(0, 60);
    profileKeysPending = new Set([...profileKeysPending].slice(keys.length));
    if (!keys.length) return;
    try {
      const found = await fetchChatProfiles({ pool, sources, keys });
      for (const [key, profile] of found) profiles.set(key, profile);
      rows = rows; // repaint names/avatars
    } catch {
      // Profile misses keep pseudonyms.
    }
    if (profileKeysPending.size && !profileTimer) profileTimer = setTimeout(flushProfiles, 250);
  }

  function repaint(forceScroll = false) {
    const logEl = log;
    const wasAtBottom = !logEl || logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 80;
    rows = timelineFromModel();
    scheduleProfiles([
      ...new Set([
        ...rows.map((row) => row.sender || row.event.pubkey),
        // Names for `nostr:npub…` mentions in message bodies and zap comments.
        ...rows.flatMap((row) =>
          mentionedPubkeys(row.event.kind === 9735 ? row.comment || '' : row.event.content)
        )
      ])
    ]);
    if (forceScroll || wasAtBottom) scrollToBottom();
    // When prepending history while reading, keep the reader's place.
  }

  /** Recent receipts so the log opens with the zap history, like Sidecar. */
  async function loadReceipts() {
    try {
      const events = (await pool.querySync(
        receiptSources,
        { kinds: [9735], ...targetFilter(address), limit: 200 } as Filter,
        { maxWait: 5000 }
      )) as unknown as NostrEventLike[];
      for (const event of events) {
        if (await acceptReceipt(event)) receipts.set(event.id, event);
      }
      repaint();
    } catch {
      // Receipt relay hiccups are fine — the log is messages first.
    }
  }

  function subscribeReceipts() {
    receiptSub?.close();
    const closer = pool.subscribeMany(
      receiptSources,
      {
        kinds: [9735],
        ...targetFilter(address),
        since: Math.floor(Date.now() / 1000) - 10
      } as Filter,
      {
        onevent: (event: unknown) => {
          const e = event as NostrEventLike;
          acceptReceipt(e).then((ok) => {
            if (ok) {
              receipts.set(e.id, e);
              repaint();
            }
          });
        }
      } as never
    );
    receiptSub = { close: () => closer.close() };
  }

  async function scrollToBottom() {
    await tick();
    if (log) log.scrollTop = log.scrollHeight;
  }

  async function load(latest = false) {
    if (historyBusy) return;
    historyBusy = true;
    loading = loading && latest;
    // Preserve the reader's position across a prepended history page.
    const logEl = log;
    const anchor = logEl ? logEl.scrollHeight - logEl.scrollTop : null;
    const oldest = model.rows()[0];
    try {
      const pageResult = await fetchChatPage({
        pool,
        sources,
        address,
        signal: new AbortController().signal,
        until: latest || !oldest ? undefined : oldest.created_at - 1,
        pageSize: PAGE_SIZE
      });
      for (const event of pageResult.events) model.accept(event, verifyEvent);
      historyComplete = pageResult.complete && !pageResult.events.length;
      await tick();
      // Keep the reader's place when a page prepends above the viewport.
      if (logEl && anchor != null && !latest) logEl.scrollTop = logEl.scrollHeight - anchor;
      if (!pageResult.complete) setNotice('Some chat relays are unavailable — retrying…', 7000);
      repaint();
    } catch {
      setNotice('Could not load chat. Try again.', 7000);
    } finally {
      loading = false;
      historyBusy = false;
    }
  }

  function openChat() {
    sub?.close();
    sub = null;
    receiptSub?.close();
    receiptSub = null;
    address = target || item.key;
    model = new ChatMessages(address);
    hiddenAuthors = new Set();
    rows = [];
    receipts = new Map();
    loading = true;
    historyComplete = false;
    replyTo = null;
    load(true);
    loadReceipts();
    void loadHidden();
    widenReceiptSources();
    sub = subscribeChat({
      pool,
      sources,
      address,
      onEvent: (event) => {
        const atBottom = !log || log.scrollHeight - log.scrollTop - log.clientHeight < 80;
        if (model.accept(event, verifyEvent)) {
          repaint();
          if (!atBottom) setNotice('New messages below', 4000);
        }
      }
    });
    subscribeReceipts();
  }

  openChat();

  async function send() {
    const text = draft.trim();
    const ndkInstance = get(ndk);
    if (!text || sending || !ndkInstance) return;
    const ok = await requireAuth({ kind: 'post', reason: 'post in live chat' });
    if (!ok) return;
    sending = true;
    setNotice('Sending…');
    try {
      // Reply to the message the user selected — not that message's own
      // parent (chatReplyParent would climb the thread).
      const template = chatTemplate(
        address,
        text,
        replyTo ? { id: replyTo.id, pubkey: replyTo.pubkey } : null,
        undefined,
        item.host
      );
      const event = new NDKEvent(ndkInstance, template as never);
      await event.sign();
      await Promise.race([
        event.publish(NDKRelaySet.fromRelayUrls(sources, ndkInstance, true)),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Publish timeout')), 10000)
        )
      ]);
      model.accept(event.rawEvent() as unknown as NostrEventLike, verifyEvent);
      draft = '';
      replyTo = null;
      repaint(true);
      setNotice('Sent', 2000);
    } catch {
      setNotice('Could not send. Check your connection and try again.', 7000);
    } finally {
      sending = false;
    }
  }

  function replyKey(event: NostrEventLike): string {
    const parent = chatReplyParent(event, address);
    return parent?.id || '';
  }

  onDestroy(() => {
    sub?.close();
    sub = null;
    receiptSub?.close();
    receiptSub = null;
    if (noticeTimer) clearTimeout(noticeTimer);
    if (profileTimer) clearTimeout(profileTimer);
    clearInterval(hiddenTimer);
  });
</script>

<section
  class="flex h-full min-h-0 flex-col rounded-xl"
  style="background-color: var(--color-bg-primary); border: 1px solid var(--color-input-border);"
>
  <header
    class="flex items-center justify-between border-b px-3 py-2"
    style="border-color: var(--color-input-border); background-color: color-mix(in srgb, var(--color-bg-secondary) 70%, transparent);"
  >
    <h2 class="text-sm font-semibold" style="color: var(--color-text-primary);">Live chat</h2>
    <span class="text-xs" style="color: var(--color-caption);">
      {rows.length > 0 ? `${rows.length} messages` : ''}
    </span>
  </header>

  {#if topZappers.length}
    <!-- Top zappers strip (Sidecar parity): ranked senders with pfp + sats. -->
    <div
      class="flex gap-1.5 overflow-x-auto border-b px-3 py-2"
      style="border-color: var(--color-input-border);"
      aria-label="Top zappers"
    >
      {#each topZappers as zapper, i (zapper.pubkey)}
        {@const name = displayName(zapper.pubkey)}
        <button
          type="button"
          class="flex shrink-0 items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2 text-xs transition-colors hover:bg-accent-gray cursor-pointer"
          style="background-color: var(--color-bg-secondary);"
          title={'#' + (i + 1) + ' ' + name + ' — ' + zapper.sats.toLocaleString() + ' sats'}
          on:click={() => openProfilePreview(zapper.pubkey)}
        >
          <span
            class="chat-avatar-placeholder overflow-hidden rounded-full"
            style="width:20px;height:20px"
          >
            <Avatar
              pubkey={zapper.pubkey}
              src={profiles.get(zapper.pubkey)?.picture || null}
              size={20}
              alt={name}
              interactive={false}
            />
          </span>
          <span class="max-w-24 truncate" style="color: var(--color-text-primary);">{name}</span>
          <span class="font-semibold tabular-nums text-amber-500">
            {compact(zapper.sats)}
          </span>
        </button>
      {/each}
    </div>
  {/if}

  <div class="px-3 pt-2">
    {#if rows.length >= HISTORY_CAP}
      <p class="mb-2 text-center text-xs" style="color: var(--color-caption);">
        This chat has too many messages to load further history.
      </p>
    {:else if !historyComplete}
      <button
        type="button"
        class="mb-2 w-full rounded-lg py-1 text-xs transition-colors hover:bg-accent-gray disabled:opacity-50 cursor-pointer"
        style="border: 1px solid var(--color-input-border); color: var(--color-caption);"
        disabled={historyBusy || loading}
        on:click={() => load(false)}
      >
        {historyBusy ? 'Loading…' : 'Older messages'}
      </button>
    {/if}
  </div>

  <div bind:this={log} class="flex-1 overflow-y-auto px-3 pb-2" aria-label="Stream chat">
    {#if loading}
      <p class="py-6 text-center text-xs" style="color: var(--color-caption);">
        Looking for messages…
      </p>
    {:else if rows.length === 0}
      <p class="py-6 text-center text-xs" style="color: var(--color-caption);">
        No messages yet. Say something!
      </p>
    {/if}
    {#each rows as row, index (row.event.id)}
      {@const event = row.event}
      {@const divider = dayDividerLabel(
        index === 0 ? null : rows[index - 1].event.created_at,
        event.created_at
      )}
      {#if divider}
        <div
          class="my-2 flex items-center gap-2 text-[11px]"
          style="color: var(--color-caption);"
          role="separator"
          aria-label={divider}
        >
          <span class="h-px flex-1" style="background-color: var(--color-input-border);"></span>
          <span>{divider}</span>
          <span class="h-px flex-1" style="background-color: var(--color-input-border);"></span>
        </div>
      {/if}
      {#if event.kind === 9735}
        <!-- Inline zap receipt, the way Sidecar interleaves them. -->
        <article class="my-1 rounded-lg bg-amber-500/10 px-2 py-1.5">
          <p class="flex items-center gap-1 text-xs">
            <LightningIcon class="shrink-0 text-amber-500" size={12} weight="fill" />
            <span class="font-semibold" title={row.sender ? displayName(row.sender) : undefined}>
              {row.sender ? displayName(row.sender) : 'Someone'}
            </span>
            <span style="color: var(--color-caption);">zapped</span>
            <span class="font-semibold text-amber-500">
              ⚡ {(row.sats || 0).toLocaleString()} sats
            </span>
            {#if isBeforeToday(event.created_at)}
              <span style="color: var(--color-caption);">{formatChatTime(event.created_at)}</span>
            {/if}
          </p>
          {#if row.comment}
            <p class="mt-0.5 text-sm leading-snug break-words" dir="auto">{#each segmentsOf(row.comment) as segment}{#if segment.type === 'mention'}<button type="button" class="chat-mention" title={displayName(segment.pubkey)} on:click={() => openProfilePreview(segment.pubkey)}>@{displayName(segment.pubkey)}</button>{:else if segment.type === 'link'}<a class="chat-link" href={segment.href} target="_blank" rel="noopener noreferrer nofollow ugc">{segment.text}</a>{:else if segment.type === 'ref'}<a class="chat-link" href={segment.href}>{segment.text}</a>{:else}{segment.text}{/if}{/each}</p>
          {/if}
        </article>
      {:else}
        {@const parent = replyKey(event) ? rows.find((r) => r.event.id === replyKey(event)) : null}
        <article class="py-1.5">
          {#if parent}
            <button
              type="button"
              class="text-left text-[11px] hover:opacity-80"
              style="color: var(--color-caption);"
              on:click={() => {
                const el = document.getElementById(`chat-${parent.event.id}`);
                el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
              }}
            >
              ↳ {displayName(parent.event.pubkey)}
            </button>
          {/if}
          <div id={`chat-${event.id}`} class="group flex items-start gap-2">
            <span
              class="chat-avatar-placeholder mt-0.5 shrink-0 overflow-hidden rounded-full"
              style="width:24px;height:24px"
            >
              <Avatar
                pubkey={event.pubkey}
                src={profiles.get(event.pubkey)?.picture || null}
                size={24}
                alt={displayName(event.pubkey)}
              />
            </span>
            <div class="min-w-0 flex-1">
              <p class="text-xs leading-snug break-words">
                <span
                  class="font-semibold"
                  style="color: var(--color-text-primary);"
                  title={displayName(event.pubkey)}>{displayName(event.pubkey)}</span
                >
                <span style="color: var(--color-caption);">
                  {formatChatTime(event.created_at)}
                </span>
              </p>
              <p class="text-sm leading-snug break-words" dir="auto">{#each segmentsOf(event.content) as segment}{#if segment.type === 'mention'}<button type="button" class="chat-mention" title={displayName(segment.pubkey)} on:click={() => openProfilePreview(segment.pubkey)}>@{displayName(segment.pubkey)}</button>{:else if segment.type === 'link'}<a class="chat-link" href={segment.href} target="_blank" rel="noopener noreferrer nofollow ugc">{segment.text}</a>{:else if segment.type === 'ref'}<a class="chat-link" href={segment.href}>{segment.text}</a>{:else}{segment.text}{/if}{/each}</p>
            </div>
            <button
              type="button"
              class="shrink-0 self-center rounded p-1 opacity-0 hover:bg-accent-gray focus:opacity-100 group-hover:opacity-100"
              style="color: var(--color-caption);"
              aria-label="Reply to {displayName(event.pubkey)}"
              title="Reply"
              on:click={() => {
                replyTo = event;
              }}
            >
              <svg
                class="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="m10 5-7 6 7 6M3 11h10a8 8 0 0 1 8 8" />
              </svg>
            </button>
            {#if noteChat && event.pubkey !== $userPublickey}
              <button
                type="button"
                class="shrink-0 self-center rounded p-1 opacity-0 hover:bg-accent-gray focus:opacity-100 group-hover:opacity-100"
                style="color: var(--color-caption);"
                aria-label="Report {displayName(event.pubkey)}'s comment"
                title="Report"
                on:click={() => report(event)}
              >
                <FlagIcon size={14} />
              </button>
            {/if}
            {#if isHost && event.pubkey !== item.host}
              <button
                type="button"
                class="shrink-0 self-center rounded p-1 opacity-0 hover:bg-accent-gray focus:opacity-100 group-hover:opacity-100 disabled:opacity-40"
                style="color: var(--color-caption);"
                aria-label="Hide {displayName(event.pubkey)} from your live chat"
                title="Hide from your live chat"
                disabled={hiding.has(event.pubkey)}
                on:click={() => hide(event.pubkey)}
              >
                <EyeSlashIcon size={14} />
              </button>
            {/if}
          </div>
        </article>
      {/if}
    {/each}
  </div>

  <footer class="border-t px-3 py-2" style="border-color: var(--color-input-border);">
    {#if closed}
      <p class="text-xs" style="color: var(--color-caption);">
        This live stream has ended. The chat is closed.
      </p>
    {:else if signingIn}
      <p class="text-xs" style="color: var(--color-caption);">
        <a
          class="underline hover:opacity-80"
          href={`/login?redirect=${encodeURIComponent($page.url.pathname)}`}>Sign in</a
        > to chat.
      </p>
    {:else}
      {#if replyTo}
        <div
          class="mb-1 flex items-center justify-between gap-2 rounded px-2 py-1 text-xs"
          style="background-color: var(--color-bg-secondary);"
        >
          <span class="truncate" style="color: var(--color-caption);">
            Replying to {displayName(replyTo.pubkey)}
          </span>
          <button
            type="button"
            aria-label="Cancel reply"
            class="hover:opacity-80"
            style="color: var(--color-caption);"
            on:click={() => (replyTo = null)}>✕</button
          >
        </div>
      {/if}
      <div class="flex items-end">
        <!-- Composer per the Messages-panel pattern: attached orange send
             button, NIP-57-style focus ring on the shared accent. -->
        <textarea
          bind:value={draft}
          rows="2"
          maxlength="4000"
          placeholder="Type a message..."
          aria-label="Write a message"
          class="chat-input input min-w-0 flex-1 resize-none text-sm min-h-[42px] max-h-32 transition-colors duration-200"
          style="background-color: var(--color-input-bg); border-radius: 0.75rem 0 0 0.75rem; border: 1px solid rgba(249, 115, 22, 0.35); border-right: none;"
          disabled={sending}
          on:keydown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        ></textarea>
        <button
          type="button"
          class="self-stretch rounded-l-none rounded-r-xl p-2.5 transition-colors cursor-pointer disabled:opacity-40"
          style="background-color: var(--color-primary); color: #ffffff;"
          disabled={sending || !draft.trim()}
          aria-label="Send message"
          on:click={send}
        >
          {#if sending}
            <div
              class="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"
            ></div>
          {:else}
            <PaperPlaneTiltIcon size={20} weight="fill" />
          {/if}
        </button>
      </div>
    {/if}
    {#if notice}
      <p class="mt-1 text-xs" style="color: var(--color-caption);" role="status">{notice}</p>
    {/if}
  </footer>
</section>

{#if noteChat && item.sessionId}
  <LiveReport
    sessionId={item.sessionId}
    hostPubkey={item.host}
    title={item.title}
    comment={reportComment}
    trigger={false}
    bind:open={reportOpen}
  />
{/if}

<style>
  /* Placeholder avatars: a blue-grey tile from the active theme's own
     surfaces, with the glyph tinted to match, so it reads as part of the
     brand in light and dark (and in every mood) instead of a stock blue. */
  .chat-avatar-placeholder {
    background: color-mix(in srgb, #64748b 38%, var(--color-bg-secondary));
  }
  .chat-avatar-placeholder :global(svg path) {
    fill: color-mix(in srgb, #64748b 78%, var(--color-text-primary));
  }
  :global(html.dark) .chat-avatar-placeholder {
    background: color-mix(in srgb, #64748b 40%, var(--color-bg-secondary));
  }
  :global(html.dark) .chat-avatar-placeholder :global(svg path) {
    fill: color-mix(in srgb, #94a3b8 85%, var(--color-bg-secondary));
  }

  .chat-input:focus {
    --tw-ring-shadow: none !important;
    border-color: rgba(249, 115, 22, 0.8) !important;
    box-shadow: inset 0 0 0 1px rgba(249, 115, 22, 0.8) !important;
    outline: none !important;
  }

  .chat-mention {
    display: inline;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-weight: 600;
    color: var(--color-primary);
    cursor: pointer;
  }
  .chat-mention:hover,
  .chat-link:hover {
    text-decoration: underline;
  }
  .chat-link {
    color: var(--color-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
    word-break: break-word;
  }
</style>
