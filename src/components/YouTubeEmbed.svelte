<script lang="ts">
  import { onMount } from 'svelte';
  import PlayIcon from 'phosphor-svelte/lib/Play';
  import CaretRightIcon from 'phosphor-svelte/lib/CaretRight';

  // 11-char YouTube video id, plus an optional start offset in seconds.
  export let videoId: string;
  export let start = 0;

  // Facade pattern: show the lightweight thumbnail + a play button and only
  // load YouTube's (heavy) iframe player once the user actually clicks. This
  // keeps a feed/thread with several videos from pulling in a player per note.
  let playing = false;

  // hqdefault always exists for a valid id (unlike maxresdefault, which 404s
  // for some uploads). Served from the privacy-friendly no-cookie host.
  $: thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  $: embedSrc =
    `https://www.youtube-nocookie.com/embed/${videoId}` +
    `?autoplay=1&rel=0${start > 0 ? `&start=${start}` : ''}`;
  $: watchUrl =
    `https://youtu.be/${videoId}` + (start > 0 ? `?t=${start}` : '');

  // Title + channel name caption, mirroring how other clients (Amethyst,
  // Jumble) show YouTube previews. YouTube's oEmbed endpoint sends no CORS
  // header, so this goes through our own server proxy.
  interface OEmbedMeta {
    title: string;
    authorName: string;
  }
  const oembedCache = new Map<string, OEmbedMeta | null>();
  let meta: OEmbedMeta | null = null;

  onMount(async () => {
    if (oembedCache.has(videoId)) {
      meta = oembedCache.get(videoId) ?? null;
      return;
    }
    try {
      const res = await fetch(`/api/youtube-oembed?v=${encodeURIComponent(videoId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && !data.error && data.title) {
          meta = { title: data.title, authorName: data.authorName || '' };
        }
      }
    } catch {
      // Silently fall back to video-only — the embed itself still works.
    }
    oembedCache.set(videoId, meta);
  });
</script>

<!-- whitespace-normal: NoteContent's container inherits white-space: pre-wrap
     for author text, which would otherwise cascade down and turn the
     whitespace between this embed's caption lines into full line-height
     gaps. Reset it locally so the caption renders tight regardless of the
     ancestor's white-space mode. -->
<div
  class="my-1 w-full overflow-hidden rounded-lg border whitespace-normal"
  style="border-color: var(--color-input-border)"
>
  <div class="relative w-full bg-black" style="aspect-ratio: 16 / 9;">
    {#if playing}
      <iframe
        class="absolute inset-0 h-full w-full"
        src={embedSrc}
        title="YouTube video player"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerpolicy="strict-origin-when-cross-origin"
        allowfullscreen
      ></iframe>
    {:else}
      <button
        type="button"
        class="group absolute inset-0 h-full w-full cursor-pointer"
        on:click={() => (playing = true)}
        aria-label="Play YouTube video"
      >
        <img
          src={thumbnail}
          alt="YouTube video thumbnail"
          class="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
        />
        <span
          class="absolute inset-0 flex items-center justify-center bg-black/30 transition-colors group-hover:bg-black/40"
        >
          <span
            class="rounded-full bg-white/90 p-4 shadow-lg transition-transform group-hover:scale-110 group-hover:bg-white"
          >
            <PlayIcon size={32} weight="fill" class="ml-1 text-gray-900" />
          </span>
        </span>
      </button>
    {/if}
  </div>

  {#if meta}
    <a
      href={watchUrl}
      target="_blank"
      rel="noopener noreferrer"
      class="flex items-center gap-2 px-3 py-2.5 whitespace-normal hover:opacity-90 transition-opacity"
      style="background-color: var(--color-card-sunken)"
    >
      <div class="min-w-0 flex-1">
        <h4
          class="text-sm font-semibold line-clamp-2 leading-snug"
          style="color: var(--color-text-primary)"
        >
          {meta.title}
        </h4>
        <p class="text-xs text-caption mt-0.5 truncate">
          youtube.com{meta.authorName ? ` · ${meta.authorName}` : ''}
        </p>
      </div>
      <CaretRightIcon size={18} class="flex-shrink-0 text-caption" />
    </a>
  {/if}
</div>

<style>
  .line-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
