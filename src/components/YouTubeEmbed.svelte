<script lang="ts">
  import PlayIcon from 'phosphor-svelte/lib/Play';

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
</script>

<div
  class="my-1 relative w-full overflow-hidden rounded-lg bg-black"
  style="aspect-ratio: 16 / 9;"
>
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
