<script lang="ts">
  /**
   * NIP-53 live chat (kind 1311) for one stream. History pages backward
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
  import { ndk, userPublickey } from '$lib/nostr';
  import { mutedPubkeys } from '$lib/muteListStore';
  import { extractZapAmountSats } from '$lib/zapAmount';
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
  import { DISCOVERY_RELAYS, RECEIPT_RELAYS } from '$lib/streams/relays';
  import { resolveAuthorPubkey, zapReceiptRelayUrls } from '$lib/nip65Routing';
  import type { NostrEventLike, StreamItem } from '$lib/streams/types';

  export let item: StreamItem;
  export let pool: SimplePool;

  const PAGE_SIZE = 50;
  const HISTORY_CAP = 1000;

  // Plain declarations: openChat() runs during component init, before any
  // `$:` reactive statement would have fired.
  let address = item.key;
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
  let receiptSub: { close: () => void } | null = null;
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

  function timelineFromModel(): TimelineRow[] {
    const muted = get(mutedPubkeys);
    const messages = model
      .rows()
      .filter((e) => !muted.has(e.pubkey))
      .map((event) => ({ event }));
    const zaps = [...receipts.values()].map(receiptRow).filter((row): row is TimelineRow => !!row);
    return [...messages, ...zaps].sort(
      (a, b) => a.event.created_at - b.event.created_at || a.event.id.localeCompare(b.event.id)
    );
  }

  /** Deterministic avatar placeholder color while a pfp loads or fails. */
  function avatarColor(pubkey: string): string {
    let hash = 0;
    for (const ch of pubkey) hash = (Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0) % 360;
    return `hsl(${hash}, 55%, 42%)`;
  }

  $: signingIn = !$userPublickey;

  function setNotice(text: string, duration = 0) {
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = null;
    notice = text;
    if (duration) noticeTimer = setTimeout(() => (notice = ''), duration);
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

  function repaint() {
    rows = timelineFromModel();
    scheduleProfiles([...new Set(rows.map((row) => row.sender || row.event.pubkey))]);
    scrollToBottom();
  }

  /** Recent receipts so the log opens with the zap history, like Sidecar. */
  async function loadReceipts() {
    try {
      const events = (await pool.querySync(
        receiptSources,
        { kinds: [9735], '#a': [address], limit: 200 } as Filter,
        { maxWait: 5000 }
      )) as unknown as NostrEventLike[];
      for (const event of events) {
        if (receiptRow(event)) receipts.set(event.id, event);
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
        '#a': [address],
        since: Math.floor(Date.now() / 1000) - 10
      } as Filter,
      {
        onevent: (event: unknown) => {
          const e = event as NostrEventLike;
          if (receiptRow(e)) {
            receipts.set(e.id, e);
            repaint();
          }
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
      repaint();
      if (!pageResult.complete) setNotice('Some chat relays are unavailable — retrying…', 7000);
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
    address = item.key;
    model = new ChatMessages(address);
    rows = [];
    receipts = new Map();
    loading = true;
    historyComplete = false;
    replyTo = null;
    load(true);
    loadReceipts();
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
    sending = true;
    setNotice('Sending…');
    try {
      const template = chatTemplate(
        address,
        text,
        replyTo ? chatReplyParent(replyTo) || { id: replyTo.id, pubkey: replyTo.pubkey } : null
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
      repaint();
      setNotice('Sent', 2000);
    } catch {
      setNotice('Could not send. Check your connection and try again.', 7000);
    } finally {
      sending = false;
    }
  }

  function replyKey(event: NostrEventLike): string {
    const parent = chatReplyParent(event);
    return parent?.id || '';
  }

  onDestroy(() => {
    sub?.close();
    sub = null;
    receiptSub?.close();
    receiptSub = null;
    if (noticeTimer) clearTimeout(noticeTimer);
    if (profileTimer) clearTimeout(profileTimer);
  });
</script>

<section
  class="flex h-full min-h-0 flex-col rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
>
  <header
    class="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800"
  >
    <h2 class="text-sm font-semibold">Live chat</h2>
    <span class="text-xs text-zinc-500">{rows.length > 0 ? `${rows.length} messages` : ''}</span>
  </header>

  <div class="px-3 pt-2">
    {#if rows.length >= HISTORY_CAP}
      <p class="mb-2 text-center text-xs text-zinc-500">
        This chat has too many messages to load further history.
      </p>
    {:else if !historyComplete}
      <button
        type="button"
        class="mb-2 w-full rounded-lg border border-zinc-200 py-1 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        disabled={historyBusy || loading}
        on:click={() => load(false)}
      >
        {historyBusy ? 'Loading…' : 'Older messages'}
      </button>
    {/if}
  </div>

  <div bind:this={log} class="flex-1 overflow-y-auto px-3 pb-2" aria-label="Stream chat">
    {#if loading}
      <p class="py-6 text-center text-xs text-zinc-500">Looking for messages…</p>
    {:else if rows.length === 0}
      <p class="py-6 text-center text-xs text-zinc-500">No messages yet. Say something!</p>
    {/if}
    {#each rows as row (row.event.id)}
      {@const event = row.event}
      {#if event.kind === 9735}
        <!-- Inline zap receipt, the way Sidecar interleaves them. -->
        <article class="my-1 rounded-lg bg-amber-500/10 px-2 py-1.5">
          <p class="flex items-center gap-1 text-xs">
            <LightningIcon class="shrink-0 text-amber-500" size={12} weight="fill" />
            <span class="font-semibold" title={row.sender ? displayName(row.sender) : undefined}>
              {row.sender ? displayName(row.sender) : 'Someone'}
            </span>
            <span class="text-zinc-500">zapped</span>
            <span class="font-semibold text-amber-500">
              ⚡ {(row.sats || 0).toLocaleString()} sats
            </span>
          </p>
          {#if row.comment}
            <p class="mt-0.5 text-sm leading-snug break-words" dir="auto">{row.comment}</p>
          {/if}
        </article>
      {:else}
        {@const parent = replyKey(event) ? rows.find((r) => r.event.id === replyKey(event)) : null}
        <article class="py-1.5">
          {#if parent}
            <button
              type="button"
              class="text-left text-[11px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
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
              class="mt-0.5 shrink-0 overflow-hidden rounded-full"
              style="width:24px;height:24px;background:{avatarColor(event.pubkey)}"
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
                <span class="font-semibold" title={displayName(event.pubkey)}
                  >{displayName(event.pubkey)}</span
                >
                <span class="text-zinc-400">
                  {new Date(event.created_at * 1000).toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit'
                  })}
                </span>
              </p>
              <p class="text-sm leading-snug break-words" dir="auto">{event.content}</p>
            </div>
            <button
              type="button"
              class="shrink-0 self-center rounded p-1 text-zinc-400 opacity-0 hover:bg-zinc-100 hover:text-zinc-600 focus:opacity-100 group-hover:opacity-100 dark:hover:bg-zinc-800"
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
          </div>
        </article>
      {/if}
    {/each}
  </div>

  <footer class="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
    {#if signingIn}
      <p class="text-xs text-zinc-500">
        <a
          class="underline hover:opacity-80"
          href={`/login?redirect=${encodeURIComponent($page.url.pathname)}`}>Sign in</a
        > to chat.
      </p>
    {:else}
      {#if replyTo}
        <div
          class="mb-1 flex items-center justify-between gap-2 rounded bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-800"
        >
          <span class="truncate">Replying to {displayName(replyTo.pubkey)}</span>
          <button
            type="button"
            aria-label="Cancel reply"
            class="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            on:click={() => (replyTo = null)}>✕</button
          >
        </div>
      {/if}
      <div class="flex items-end gap-2">
        <textarea
          bind:value={draft}
          rows="2"
          maxlength="4000"
          placeholder="Write a message"
          aria-label="Write a message"
          class="min-w-0 flex-1 resize-none rounded-lg border border-zinc-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
          on:keydown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        ></textarea>
        <button
          type="button"
          class="shrink-0 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
          disabled={sending || !draft.trim()}
          on:click={send}
        >
          Send
        </button>
      </div>
    {/if}
    {#if notice}
      <p class="mt-1 text-xs text-zinc-500" role="status">{notice}</p>
    {/if}
  </footer>
</section>
