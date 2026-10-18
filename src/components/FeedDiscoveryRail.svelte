<script lang="ts">
  /**
   * The desktop discovery column beside Fresh on /feed (from 1440px; hidden
   * below, where nothing here loads). Three sections, each with its own job:
   *
   * - Find your people: the relay's suggested topics (NIP-11
   *   `topics.suggested`, in its order). A row opens that topic in Fresh,
   *   exactly like its chip (members open it; everyone else gets the
   *   membership card). Hidden when the list is missing.
   * - More feeds: links to feeds that already exist.
   * - Around the table: one real conversation from the Fresh posts on this
   *   page ($lib/freshFeed/discovery pickConversation). Never a post in the
   *   first rows, in a special card or on screen in the feed: when its row
   *   scrolls into view another one takes its place, or the section goes.
   */
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import type { Unsubscriber } from 'svelte/store';
  import LockIcon from 'phosphor-svelte/lib/LockSimple';
  import { ndk, userPublickey } from '$lib/nostr';
  import { batchFetchEngagement, getEngagementStore } from '$lib/engagementCache';
  import { loadTopics, type Topic } from '$lib/freshFeed/topicList';
  import {
    conversationPool,
    moreFeeds,
    pickConversation,
    suggestedRows,
    type FreshDiscovery,
    type SuggestedRow
  } from '$lib/freshFeed/discovery';
  import { contentWithoutMedia, formatTimeAgo, noteHref } from '$lib/freshFeed/posts';
  import RightRail from './RightRail.svelte';
  import RailCard from './RailCard.svelte';
  import Avatar from './Avatar.svelte';
  import AuthorName from './AuthorName.svelte';

  export let discovery: FreshDiscovery;

  const dispatch = createEventDispatcher<{
    topic: Topic;
    tab: 'following' | 'members';
  }>();

  /** Matches RightRail's `wide` breakpoint: below it nothing is loaded. */
  const WIDE = '(min-width: 1440px)';
  let active = false;
  let mq: MediaQueryList | null = null;
  const onMq = () => (active = !!mq?.matches);

  let rows: SuggestedRow[] = [];
  let topicsAsked = false;
  $: if (active && !topicsAsked) {
    topicsAsked = true;
    loadTopics().then((c) => (rows = suggestedRows(c.suggested)));
  }

  $: feeds = moreFeeds(!!$userPublickey);

  // --- Around the table ---

  const now = () => Math.floor(Date.now() / 1000);
  /** Real reply counts, from the shared engagement cache (the cards' own numbers). */
  let replies = new Map<string, number>();
  const watched = new Map<string, Unsubscriber>();
  const asked = new Set<string>();

  function watch(ids: string[]) {
    for (const id of ids) {
      if (watched.has(id)) continue;
      watched.set(
        id,
        getEngagementStore(id).subscribe((d) => {
          // Known once fetched (by this column or by the post's card);
          // before that the count is unknown, not 0.
          if (d.loading || !d.lastFetched) return;
          replies.set(id, d.comments.count);
          replies = replies;
        })
      );
    }
    const fresh = ids.filter((id) => !asked.has(id));
    fresh.forEach((id) => asked.add(id));
    for (let i = 0; i < fresh.length; i += 20) {
      batchFetchEngagement($ndk, fresh.slice(i, i + 20), $userPublickey).catch(() => {});
    }
  }

  $: candidates = discovery.posts.map((e) => ({
    id: e.id,
    kind: e.kind,
    createdAt: e.created_at,
    content: e.content,
    replies: replies.get(e.id) ?? null
  }));
  $: if (active && !discovery.viewOpen) watch(conversationPool(candidates, now()));

  /** Posts whose feed row has been on screen while featured here: never featured again. */
  let onScreen = new Set<string>();
  $: exclude = new Set([...discovery.specialIds, ...onScreen]);
  $: pickedId = active && !discovery.viewOpen ? pickConversation(candidates, exclude, now()) : null;
  $: picked = pickedId ? (discovery.posts.find((e) => e.id === pickedId) ?? null) : null;
  $: pickedEvent = picked ? new NDKEvent($ndk, picked) : null;
  $: pickedText = picked ? snippet(picked.content) : '';
  $: pickedReplies = pickedId ? (replies.get(pickedId) ?? 0) : 0;

  function snippet(content: string): string {
    return contentWithoutMedia(content)
      .replace(/nostr:(npub|nprofile|note|nevent|naddr)1[0-9a-z]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Watch the featured post's own row in the feed: the moment it's on
  // screen, it leaves this column.
  let rowObserver: IntersectionObserver | null = null;
  $: observeRow(pickedId);
  function observeRow(id: string | null) {
    rowObserver?.disconnect();
    rowObserver = null;
    if (!id || typeof IntersectionObserver === 'undefined') return;
    const el = document.querySelector(`[data-fresh-row="${CSS.escape(id)}"]`);
    if (!el) return;
    rowObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          onScreen.add(id);
          onScreen = onScreen;
        }
      },
      { root: document.getElementById('app-scroll') }
    );
    rowObserver.observe(el);
  }

  function openTopic(row: SuggestedRow) {
    dispatch('topic', { slug: row.slug, name: row.name, count14d: 0 });
  }

  onMount(() => {
    mq = window.matchMedia(WIDE);
    onMq();
    mq.addEventListener('change', onMq);
  });

  onDestroy(() => {
    mq?.removeEventListener('change', onMq);
    rowObserver?.disconnect();
    watched.forEach((u) => u());
  });
</script>

<RightRail wide>
  {#if active}
    {#if rows.length}
      <RailCard title="Find your people">
        <div class="section">
          <p class="lead">Start with something you love</p>
          <ul class="list">
            {#each rows as row (row.slug)}
              <li>
                <button type="button" class="row" on:click={() => openTopic(row)}>
                  <span class="row-text">
                    <span class="row-name">{row.name}</span>
                    {#if row.detail}<span class="row-detail">{row.detail}</span>{/if}
                  </span>
                  {#if discovery.topicsLocked}
                    <LockIcon size={12} weight="bold" class="opacity-60" aria-label="Members" />
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        </div>
      </RailCard>
    {/if}

    <RailCard title="More feeds">
      <ul class="list">
        {#each feeds as f (f.label)}
          <li>
            {#if f.tab}
              {@const tab = f.tab}
              <a
                class="row"
                href="/feed?tab={tab}"
                on:click|preventDefault={() => dispatch('tab', tab)}
              >
                <span class="row-text">
                  <span class="row-name">{f.label}</span>
                  <span class="row-detail">{f.detail}</span>
                </span>
              </a>
            {:else}
              <a class="row" href={f.href}>
                <span class="row-text">
                  <span class="row-name">{f.label}</span>
                  <span class="row-detail">{f.detail}</span>
                </span>
              </a>
            {/if}
          </li>
        {/each}
      </ul>
    </RailCard>

    {#if picked && pickedEvent}
      <RailCard title="Around the table">
        <!-- Keyed: AuthorName and Avatar load their profile once, on mount,
             so a new pick needs fresh ones. -->
        {#key picked.id}
          <a class="talk" href={noteHref(picked.id)}>
            <span class="talk-by">
              <Avatar pubkey={picked.pubkey} size={24} showRing={false} interactive={false} />
              <AuthorName event={pickedEvent} className="talk-author" interactive={false} />
              <span class="talk-age">· {formatTimeAgo(picked.created_at)}</span>
            </span>
            {#if pickedText}<span class="talk-text">{pickedText}</span>{/if}
            <span class="talk-replies">
              {pickedReplies}
              {pickedReplies === 1 ? 'reply' : 'replies'} · Join the conversation
            </span>
          </a>
        {/key}
      </RailCard>
    {/if}
  {/if}
</RightRail>

<style>
  .section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .lead {
    font-size: 0.875rem;
    color: var(--color-text-secondary);
    margin-top: -0.75rem;
  }
  /* Compact rows, so all three sections fit beside the feed on a laptop
     screen (the column scrolls on its own when they don't). */
  .list {
    display: flex;
    flex-direction: column;
    margin: -0.375rem -0.625rem;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    width: 100%;
    min-height: 2.75rem;
    padding: 0.3125rem 0.625rem;
    border-radius: 0.75rem;
    text-align: left;
    color: var(--color-text-primary);
    transition: background-color 0.15s;
  }
  .row:hover {
    background-color: var(--color-input-bg);
  }
  .row:focus-visible,
  .talk:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
  .row-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .row-name {
    font-size: 0.9375rem;
    font-weight: 600;
  }
  .row-detail {
    font-size: 0.8125rem;
    color: var(--color-caption);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .talk {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.875rem 1rem;
    border-radius: 0.75rem;
    border: 1px solid var(--color-input-border);
    background-color: var(--color-input-bg);
    color: var(--color-text-primary);
  }
  .talk-by {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
    font-size: 0.8125rem;
  }
  .talk-by :global(.talk-author) {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .talk-age {
    color: var(--color-caption);
    white-space: nowrap;
  }
  .talk-text {
    font-size: 0.875rem;
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .talk-replies {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--color-primary);
  }
</style>
