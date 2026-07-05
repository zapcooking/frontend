<script lang="ts">
  import { onMount } from 'svelte';
  import SealCheckIcon from 'phosphor-svelte/lib/SealCheck';
  import HeartIcon from 'phosphor-svelte/lib/Heart';
  import ChatCircleIcon from 'phosphor-svelte/lib/ChatCircle';

  // Original x.com/twitter.com status URL found in the note.
  export let tweetUrl: string;

  interface TwitterMedia {
    type: 'photo' | 'video';
    url: string;
    posterUrl?: string;
    width: number;
    height: number;
  }
  interface TwitterMeta {
    text: string;
    name: string;
    screenName: string;
    verified: boolean;
    avatarUrl: string;
    createdAt: string;
    likeCount: number;
    replyCount: number;
    media: TwitterMedia | null;
  }

  const cache = new Map<string, TwitterMeta | null>();
  let meta: TwitterMeta | null = null;
  let loading = true;
  let playingVideo = false;

  onMount(async () => {
    if (cache.has(tweetUrl)) {
      meta = cache.get(tweetUrl) ?? null;
      loading = false;
      return;
    }
    try {
      const res = await fetch(`/api/twitter-embed?url=${encodeURIComponent(tweetUrl)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && !data.error && data.name) {
          meta = data as TwitterMeta;
        }
      }
    } catch {
      // Silently fall back to a plain link — the note is still readable.
    }
    cache.set(tweetUrl, meta);
    loading = false;
  });

  function formatDate(iso: string): string {
    try {
      const d = new Date(iso);
      const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      const date = d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
      return `${time} · ${date}`;
    } catch {
      return '';
    }
  }

  function formatCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
    return String(n);
  }
</script>

{#if !loading && meta}
  <!-- whitespace-normal: see YouTubeEmbed — NoteContent's container can
       inherit white-space: pre-wrap, which would otherwise turn the
       whitespace between these lines into full line-height gaps. -->
  <div
    class="my-1 w-full overflow-hidden rounded-lg border whitespace-normal"
    style="border-color: var(--color-input-border); background-color: var(--color-card-sunken)"
  >
    <a
      href={tweetUrl}
      target="_blank"
      rel="noopener noreferrer"
      class="block px-3 pt-3 hover:opacity-90 transition-opacity"
    >
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          {#if meta.avatarUrl}
            <img
              src={meta.avatarUrl}
              alt=""
              class="w-9 h-9 rounded-full flex-shrink-0"
              loading="lazy"
            />
          {/if}
          <div class="min-w-0 flex flex-col leading-tight">
            <div class="flex items-center gap-1 min-w-0">
              <span class="text-sm font-semibold truncate" style="color: var(--color-text-primary)">
                {meta.name}
              </span>
              {#if meta.verified}
                <SealCheckIcon size={15} weight="fill" class="flex-shrink-0 text-primary" />
              {/if}
            </div>
            <span class="text-xs text-caption truncate">@{meta.screenName}</span>
          </div>
        </div>
        <!-- X logo mark -->
        <svg viewBox="0 0 24 24" width="18" height="18" class="flex-shrink-0" style="color: var(--color-text-primary)" aria-hidden="true">
          <path
            fill="currentColor"
            d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
          />
        </svg>
      </div>

      {#if meta.text}
        <p
          class="text-sm leading-snug mt-2 whitespace-pre-wrap"
          style="color: var(--color-text-primary)"
        >
          {meta.text}
        </p>
      {/if}
    </a>

    {#if meta.media}
      <div class="mt-2 relative w-full bg-black" style="aspect-ratio: {meta.media.width} / {meta.media.height};">
        {#if meta.media.type === 'photo'}
          <a href={tweetUrl} target="_blank" rel="noopener noreferrer">
            <img
              src={meta.media.url}
              alt=""
              class="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
            />
          </a>
        {:else if playingVideo}
          <!-- svelte-ignore a11y-media-has-caption -->
          <video
            class="absolute inset-0 w-full h-full"
            src={meta.media.url}
            controls
            autoplay
            playsinline
          ></video>
        {:else}
          <button
            type="button"
            class="group absolute inset-0 w-full h-full cursor-pointer"
            on:click={() => (playingVideo = true)}
            aria-label="Play video"
          >
            {#if meta.media.posterUrl}
              <img
                src={meta.media.posterUrl}
                alt=""
                class="absolute inset-0 w-full h-full object-cover"
                loading="lazy"
              />
            {/if}
            <span
              class="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors group-hover:bg-black/35"
            >
              <span
                class="rounded-full bg-white/90 p-3 shadow-lg transition-transform group-hover:scale-110 group-hover:bg-white"
              >
                <svg viewBox="0 0 24 24" width="22" height="22" class="text-gray-900" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </span>
          </button>
        {/if}
      </div>
    {/if}

    <a
      href={tweetUrl}
      target="_blank"
      rel="noopener noreferrer"
      class="flex items-center gap-4 px-3 py-2 mt-1 text-xs text-caption hover:opacity-80 transition-opacity"
    >
      {#if meta.createdAt}
        <span>{formatDate(meta.createdAt)}</span>
      {/if}
      <span class="flex items-center gap-1">
        <HeartIcon size={13} />
        {formatCount(meta.likeCount)}
      </span>
      <span class="flex items-center gap-1">
        <ChatCircleIcon size={13} />
        {formatCount(meta.replyCount)}
      </span>
    </a>
  </div>
{:else if !loading}
  <!-- Couldn't resolve the tweet (deleted, private, or rate-limited) — fall
       back to a plain link so the note stays readable. -->
  <a
    href={tweetUrl}
    target="_blank"
    rel="noopener noreferrer"
    class="text-orange-500 hover:text-orange-600 hover:underline break-all"
  >
    {tweetUrl}
  </a>
{/if}
