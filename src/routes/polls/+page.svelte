<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ndk, ensureNdkConnected } from '$lib/nostr';
  import { NDKRelaySet } from '@nostr-dev-kit/ndk';
  import type { NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';
  import PollDisplay from '../../components/PollDisplay.svelte';
  import ZapPollDisplay from '../../components/ZapPollDisplay.svelte';
  import Avatar from '../../components/Avatar.svelte';
  import CustomName from '../../components/CustomName.svelte';
  import NoteActionBar from '../../components/NoteActionBar.svelte';
  import CommentThread from '../../components/comments/CommentThread.svelte';
  import { formatDistanceToNow } from 'date-fns';
  import { nip19 } from 'nostr-tools';
  import { goto } from '$app/navigation';
  import PostActionsMenu from '../../components/PostActionsMenu.svelte';

  let polls: NDKEvent[] = [];
  let loading = true;
  let subscription: NDKSubscription | null = null;
  let seenIds = new Set<string>();

  const BLACKLISTED_PUBKEYS = new Set<string>([
    '73d9e19ef07e0d098fc0fc5fb75db0f854824e8b4e43905acce638ddf6469960', // npub1w0v7r8hs0cxsnr7ql30mwhdslp2gyn5tfepeqkkvucudmajxn9sqgz5svp
  ]);

  const MAX_POLLS_PER_HOUR = 5;

  /** Returns true if the event should be filtered out by rate limit */
  function exceedsRateLimit(event: NDKEvent, existing: NDKEvent[]): boolean {
    const createdAt = event.created_at || 0;
    const windowStart = createdAt - 3600;
    const recentByAuthor = existing.filter((e) => {
      const eCreatedAt = e.created_at || 0;
      return e.pubkey === event.pubkey && eCreatedAt > windowStart && eCreatedAt <= createdAt;
    });
    return recentByAuthor.length >= MAX_POLLS_PER_HOUR;
  }

  const POLL_RELAYS = [
    'wss://nos.lol',
    'wss://relay.damus.io',
    'wss://relay.primal.net',
    'wss://nostr.wine',
    'wss://antiprimal.net'
  ];

  function formatTime(timestamp: number): string {
    return formatDistanceToNow(new Date(timestamp * 1000), { addSuffix: true });
  }

  function navigateToNote(event: NDKEvent) {
    try {
      const noteId = nip19.noteEncode(event.id);
      goto(`/${noteId}`);
    } catch {}
  }

  async function loadPolls() {
    // Wait for NDK to connect before querying relays
    try {
      await ensureNdkConnected();
    } catch {
      console.warn('[Polls] NDK connection timed out, trying anyway');
    }

    if (!$ndk) {
      loading = false;
      return;
    }

    if (subscription) {
      subscription.stop();
      subscription = null;
    }

    loading = true;
    polls = [];
    seenIds.clear();

    try {
      const relaySet = NDKRelaySet.fromRelayUrls(POLL_RELAYS, $ndk, true);

      subscription = $ndk.subscribe(
        {
          kinds: [1068 as number, 6969 as number],
          limit: 200,
          since: Math.floor(Date.now() / 1000) - (365 * 24 * 60 * 60)
        },
        { closeOnEose: true },
        relaySet
      );

      subscription.on('event', (event: NDKEvent) => {
        if (seenIds.has(event.id)) return;
        seenIds.add(event.id);

        // Block known spammers
        if (BLACKLISTED_PUBKEYS.has(event.pubkey)) return;

        // Validate: kind 1068 needs 'option' tags, kind 6969 needs 'poll_option' tags
        if (event.kind === 1068) {
          if (!event.tags.some((t) => t[0] === 'option')) return;
        } else if (event.kind === 6969) {
          if (!event.tags.some((t) => t[0] === 'poll_option')) return;
        }

        // Rate limit: max 5 polls per hour per author
        if (exceedsRateLimit(event, polls)) return;

        polls = [...polls, event].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      });

      subscription.on('eose', () => {
        loading = false;
      });

      // Timeout
      setTimeout(() => {
        if (loading) {
          loading = false;
          if (subscription) {
            subscription.stop();
            subscription = null;
          }
        }
      }, 15000);
    } catch (error) {
      console.error('[Polls] Error loading polls:', error);
      loading = false;
    }
  }

  onMount(() => {
    loadPolls();
  });

  onDestroy(() => {
    if (subscription) {
      subscription.stop();
      subscription = null;
    }
  });
</script>

<svelte:head>
  <title>Polls | Zap Cooking</title>
  <meta name="description" content="Vote on polls from across the Nostr network" />
</svelte:head>

<div class="max-w-2xl mx-auto px-4 py-6">
  <header class="mb-4">
    <h1 class="text-2xl font-bold" style="color: var(--color-text-primary);">Polls</h1>
    <p class="text-sm mt-1" style="color: var(--color-text-secondary);">
      Vote on polls from across Nostr
    </p>
  </header>

  {#if loading && polls.length === 0}
    <!-- Skeleton loader -->
    <div>
      {#each Array(4) as _, i}
        <div class="poll-item animate-pulse" class:poll-item-border={i > 0}>
          <div class="flex items-center gap-3 mb-3">
            <div class="w-10 h-10 rounded-full" style="background: var(--color-skeleton-base);"></div>
            <div class="flex-1">
              <div class="h-3.5 w-28 rounded" style="background: var(--color-skeleton-base);"></div>
              <div class="h-3 w-16 rounded mt-1.5" style="background: var(--color-skeleton-base);"></div>
            </div>
          </div>
          <div class="h-4 w-3/4 rounded mb-3" style="background: var(--color-skeleton-base);"></div>
          <div class="space-y-2">
            <div class="h-11 rounded-lg" style="background: var(--color-skeleton-base);"></div>
            <div class="h-11 rounded-lg" style="background: var(--color-skeleton-base);"></div>
            <div class="h-11 rounded-lg" style="background: var(--color-skeleton-base);"></div>
          </div>
        </div>
      {/each}
    </div>
  {:else if polls.length === 0}
    <div class="text-center py-16">
      <div class="text-5xl mb-4">📊</div>
      <h2 class="text-lg font-semibold mb-2" style="color: var(--color-text-primary);">No polls found</h2>
      <p style="color: var(--color-text-secondary);">Check back later for polls from the Nostr network.</p>
    </div>
  {:else}
    <div>
      {#each polls as poll, i (poll.id)}
        {@const pubkey = poll.author?.hexpubkey || poll.pubkey}
        {@const isZapPoll = poll.kind === 6969}
        <article class="poll-item" class:poll-item-border={i > 0} class:poll-item-zap={isZapPoll}>
          <!-- Author row -->
          <div class="flex items-center gap-3 mb-3">
            <a href="/user/{nip19.npubEncode(pubkey)}" class="flex-shrink-0">
              <Avatar {pubkey} size={40} />
            </a>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <a
                  href="/user/{nip19.npubEncode(pubkey)}"
                  class="font-semibold text-sm hover:opacity-80 transition-opacity block"
                  style="color: var(--color-text-primary);"
                >
                  <CustomName {pubkey} />
                </a>
                {#if isZapPoll}
                  <span class="zap-poll-badge">⚡ Zap Poll</span>
                {/if}
              </div>
              <div class="flex items-center gap-2">
                <button
                  class="poll-time"
                  on:click={() => navigateToNote(poll)}
                >
                  {poll.created_at ? formatTime(poll.created_at) : ''}
                </button>
                <PostActionsMenu event={poll} />
              </div>
            </div>
          </div>

          <!-- Poll content -->
          {#if isZapPoll}
            <ZapPollDisplay event={poll} />
          {:else}
            <PollDisplay event={poll} />
          {/if}

          <!-- Actions -->
          <div class="mt-2">
            <NoteActionBar event={poll} variant="compact" />
          </div>

          <!-- Comments -->
          <CommentThread variant="feed" event={poll} />
        </article>
      {/each}
    </div>

    {#if loading}
      <div class="flex justify-center py-6">
        <div class="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .poll-item {
    padding: 1.25rem 0;
  }

  .poll-item-border {
    border-top: 1px solid var(--color-input-border);
  }

  .poll-time {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font: inherit;
    transition: color 0.15s;
  }

  .poll-time:hover {
    text-decoration: underline;
    color: var(--color-text-primary);
  }

  .poll-item-zap {
    background: rgba(250, 204, 21, 0.06);
    border-left: 3px solid rgba(250, 204, 21, 0.5);
    padding-left: 1rem;
    border-radius: 0.5rem;
    margin: 0.25rem 0;
  }

  :global(.dark) .poll-item-zap {
    background: rgba(250, 204, 21, 0.04);
    border-left-color: rgba(250, 204, 21, 0.3);
  }

  .zap-poll-badge {
    font-size: 0.6875rem;
    font-weight: 600;
    color: #facc15;
    background: rgba(250, 204, 21, 0.1);
    padding: 0.0625rem 0.375rem;
    border-radius: 9999px;
    white-space: nowrap;
  }
</style>
