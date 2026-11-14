<script lang="ts">
  /**
   * Stream page for a Go live session: the same page as a NIP-53 stream
   * (StreamView), fed from Zap Cooking's server instead of relays. The
   * session is re-read every 5 seconds while the tab is visible, so "ended"
   * reaches the player within seconds; the player itself plays the
   * broadcast through our relay (StreamEngine's WebRTC path).
   */
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import type { SimplePool } from 'nostr-tools/pool';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import StreamView from '../../../../components/streams/StreamView.svelte';
  import StreamPageSkeleton from '../../../../components/streams/StreamPageSkeleton.svelte';
  import { ndk } from '$lib/nostr';
  import { createStreamPool } from '$lib/streams/relayPage';
  import { fetchSession, sessionToStreamItem, type GoLiveSession } from '$lib/streams/goLive';
  import { fetchRecipeEventWithRetry, recipeCardOf } from '$lib/streams/recipeCard';
  import type { StreamItem } from '$lib/streams/types';

  const POLL_MS = 5000;

  let session: GoLiveSession | null = null;
  let item: StreamItem | null = null;
  let recipe: NDKEvent | null = null;
  let recipeLoading = false;
  let loading = true;
  let notFound = false;
  let pool: SimplePool | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let currentId: string | null = null;

  function rebuild() {
    if (!session) return;
    item = sessionToStreamItem(session, recipeCardOf(recipe));
  }

  async function loadRecipe(a: string | null) {
    if (!a) return;
    recipeLoading = true;
    const found = await fetchRecipeEventWithRetry(
      () => get(ndk),
      a,
      () => session?.recipe_a === a
    );
    if (session?.recipe_a !== a) return;
    recipe = found;
    recipeLoading = false;
    rebuild();
  }

  async function refresh(id: string) {
    const next = await fetchSession(id);
    if (id !== currentId) return;
    if (next === undefined) return; // could not tell: keep what is shown
    if (next === null) {
      // Gone. Ended sessions are kept for 30 days, so this is an unknown id,
      // or one the admin removed with the host's account.
      if (session) {
        session = { ...session, status: 'ended', ended_at: Math.floor(Date.now() / 1000) };
        rebuild();
        stopPolling();
      } else {
        notFound = true;
      }
      return;
    }
    const recipeChanged = next.recipe_a !== session?.recipe_a;
    session = next;
    rebuild();
    if (recipeChanged) void loadRecipe(next.recipe_a);
    if (next.status === 'ended') stopPolling();
  }

  function stopPolling() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  async function start(id: string) {
    stopPolling();
    currentId = id;
    session = null;
    item = null;
    recipe = null;
    notFound = false;
    loading = true;
    if (!pool) pool = createStreamPool();
    await refresh(id);
    if (id !== currentId) return;
    loading = false;
    // `refresh` set it; TypeScript cannot see that across the await.
    const loaded = session as GoLiveSession | null;
    if (loaded && loaded.status !== 'ended') {
      timer = setInterval(() => {
        if (!document.hidden) void refresh(id);
      }, POLL_MS);
    }
  }

  $: if (browser) void start($page.params.id ?? '');

  function onVisible() {
    if (!document.hidden && currentId && timer) void refresh(currentId);
  }
  if (browser) document.addEventListener('visibilitychange', onVisible);

  onDestroy(() => {
    stopPolling();
    if (browser) document.removeEventListener('visibilitychange', onVisible);
    pool?.destroy();
    pool = null;
  });
</script>

<svelte:head>
  <title>{item ? `${item.title} — zap.cooking Live` : 'Live — zap.cooking'}</title>
</svelte:head>

<div class="mx-auto w-full max-w-3xl px-4 py-6">
  {#if loading}
    <StreamPageSkeleton />
  {:else if notFound || !item || !pool}
    <div class="flex h-64 flex-col items-center justify-center gap-2 text-center">
      <p class="text-sm text-zinc-500">
        This stream could not be found. It may have ended and been removed, or the link is wrong.
      </p>
    </div>
  {:else}
    <StreamView {item} {pool} {recipe} {recipeLoading} />
  {/if}
</div>
