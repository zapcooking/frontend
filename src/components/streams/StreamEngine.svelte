<script lang="ts">
  /**
   * The one HLS/video owner for its surface (page, dock, pop-out).
   *
   * hls.js is a 1.7 MB dependency, so it is loaded on the first HLS play
   * through a dynamic import (a separate chunk); Safari plays native HLS and
   * plain mp4/webm files use a direct src. Status flows into the
   * `streamPlayer` store, where the playing surface's UI reads it.
   */
  import { onDestroy, onMount } from 'svelte';
  import {
    streamPlayer,
    setStreamStatus,
    setStreamMuted,
    setStreamPosition
  } from '$lib/stores/streamPlayer';
  import { runtime } from '$lib/streams/parse';
  import PlayIcon from 'phosphor-svelte/lib/Play';
  import SpeakerHighIcon from 'phosphor-svelte/lib/SpeakerHigh';
  import SpeakerXIcon from 'phosphor-svelte/lib/SpeakerX';
  import PictureInPictureIcon from 'phosphor-svelte/lib/PictureInPicture';
  import ArrowsOutIcon from 'phosphor-svelte/lib/ArrowsOut';

  export let surface: 'page' | 'dock' | 'popout' = 'page';

  let video: HTMLVideoElement | null = null;
  let container: HTMLElement | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let hls: any = null;
  /** Generation + media URL this element is currently wired to. */
  let appliedGeneration = -1;
  let appliedUrl: string | null = null;
  let autoplayRejected = false;
  let inPictureInPicture = false;

  const isDirectFile = (url: string) => /\.(mp4|webm|ogv)(?:[?#]|$)/i.test(url);
  const supportsNativeHls = (el: HTMLVideoElement) =>
    !!el.canPlayType('application/vnd.apple.mpegurl');

  let hlsPromise: Promise<(typeof import('hls.js'))['default'] | null> | null = null;
  function loadHls() {
    hlsPromise = hlsPromise || import('hls.js').then((m) => m.default).catch(() => null);
    return hlsPromise;
  }

  function teardownMedia() {
    if (hls) {
      hls.destroy();
      hls = null;
    }
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    appliedGeneration = -1;
    appliedUrl = null;
    autoplayRejected = false;
  }

  function handleError() {
    setStreamStatus('unavailable');
  }

  async function wire(state: typeof $streamPlayer) {
    if (!video) return;
    if (!state.item || !state.mediaUrl || state.surface !== surface) {
      if (appliedGeneration !== -1) teardownMedia();
      return;
    }
    if (state.generation === appliedGeneration && state.mediaUrl === appliedUrl) return;

    teardownMedia();
    appliedGeneration = state.generation;
    appliedUrl = state.mediaUrl;
    autoplayRejected = false;
    setStreamStatus('connecting');
    video.muted = state.muted;

    const begin = () =>
      video?.play().then(
        () => {},
        () => {
          // Autoplay with sound can be refused; the play overlay takes over.
          autoplayRejected = true;
        }
      );

    if (isDirectFile(state.mediaUrl)) {
      video.src = state.mediaUrl;
      begin();
      return;
    }
    if (supportsNativeHls(video)) {
      video.src = state.mediaUrl;
      begin();
      return;
    }
    const Hls = await loadHls();
    if (!Hls || !Hls.isSupported()) {
      if (appliedGeneration === state.generation) setStreamStatus('unavailable');
      return;
    }
    if (appliedGeneration !== state.generation || appliedUrl !== state.mediaUrl) return;
    hls = new Hls({ enableWorker: false, backBufferLength: 15, maxBufferLength: 20 });
    hls.on(Hls.Events.ERROR, (_: unknown, data: { fatal: boolean }) => {
      if (data.fatal && appliedGeneration === state.generation) setStreamStatus('unavailable');
    });
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (appliedGeneration === state.generation) begin();
    });
    hls.loadSource(state.mediaUrl);
    hls.attachMedia(video);
  }

  $: wire($streamPlayer);
  // Reactive statements run before bind:this lands, so wire once more after mount.
  onMount(() => {
    wire($streamPlayer);
  });

  $: if ($streamPlayer.muted && video) {
    video.muted = true;
  }

  function toggleMute() {
    setStreamMuted(!video?.muted);
    if (video) video.muted = !video.muted;
  }

  async function toggleFullscreen() {
    if (!container) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (container.requestFullscreen) {
        await container.requestFullscreen();
      } else if (
        (container as HTMLElement & { webkitRequestFullscreen?: () => void })
          .webkitRequestFullscreen
      ) {
        (
          container as HTMLElement & { webkitRequestFullscreen?: () => void }
        ).webkitRequestFullscreen?.();
      }
    } catch {
      // Fullscreen refusal (permissions, iPad quirks) is fine to ignore.
    }
  }

  async function togglePictureInPicture() {
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch {
      // PiP unsupported (Firefox) or refused — the button simply does nothing.
    }
  }

  // The video element's PiP events are not in Svelte's HTMLProps typing, so
  // they are attached here rather than in the template.
  function onEnterPip() {
    inPictureInPicture = true;
  }
  function onLeavePip() {
    inPictureInPicture = false;
  }
  function bindVideo(el: HTMLVideoElement) {
    video = el;
    el.addEventListener('enterpictureinpicture', onEnterPip);
    el.addEventListener('leavepictureinpicture', onLeavePip);
    return {
      destroy() {
        el.removeEventListener('enterpictureinpicture', onEnterPip);
        el.removeEventListener('leavepictureinpicture', onLeavePip);
      }
    };
  }

  onDestroy(() => {
    teardownMedia();
  });
</script>

<div
  bind:this={container}
  class="relative w-full overflow-hidden rounded-xl bg-black aspect-video group"
>
  <!-- Live relay video has no caption track; the a11y rule targets media
       with meaningful content that can carry one. -->
  <!-- svelte-ignore a11y-media-has-caption -->
  <video
    use:bindVideo
    class="h-full w-full"
    playsinline
    on:playing={() => setStreamStatus('playing')}
    on:waiting={() => setStreamStatus('buffering')}
    on:error={handleError}
    on:timeupdate={() => {
      const item = $streamPlayer.item;
      if (video && item?.status === 'ended') setStreamPosition(video.currentTime);
    }}
    on:click={() => {
      if (video?.paused) video.play().catch(() => {});
      else video?.pause();
    }}
  ></video>
  {#if $streamPlayer.item}
    <div class="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
      <span
        class="pointer-events-auto rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide
          {$streamPlayer.item.status === 'ended'
          ? 'bg-zinc-700 text-zinc-200'
          : 'bg-red-600 text-white animate-pulse'}"
      >
        {$streamPlayer.item.status === 'ended' ? 'Replay' : 'Live'}
      </span>
      {#if $streamPlayer.item.viewers != null && $streamPlayer.item.status !== 'ended'}
        <span class="rounded-full bg-black/60 px-2 py-0.5 text-xs text-zinc-200">
          {$streamPlayer.item.viewers.toLocaleString()} watching
        </span>
      {/if}
    </div>

    <div
      class="pointer-events-none absolute bottom-0 left-0 right-0 flex items-end justify-between gap-2 p-3
      bg-gradient-to-t from-black/70 to-transparent"
    >
      <div class="min-w-0">
        <p
          class="truncate text-sm font-medium text-white"
          dir="auto"
          title={$streamPlayer.item.title}
        >
          {$streamPlayer.item.title}
        </p>
        <p class="text-xs text-zinc-300">
          {#if $streamPlayer.status === 'connecting'}
            Connecting…
          {:else if $streamPlayer.status === 'buffering'}
            Buffering…
          {:else if $streamPlayer.status === 'unavailable'}
            Stream unavailable — try another stream or come back later.
          {:else if $streamPlayer.item.starts && $streamPlayer.item.status !== 'ended'}
            Live for {runtime($streamPlayer.item.starts)?.minutes ?? 0} min
          {/if}
        </p>
      </div>
      <div class="pointer-events-auto flex shrink-0 items-center gap-1">
        <button
          type="button"
          on:click={toggleMute}
          class="rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
          aria-label={$streamPlayer.muted ? 'Unmute' : 'Mute'}
          title={$streamPlayer.muted ? 'Unmute' : 'Mute'}
        >
          {#if $streamPlayer.muted}
            <SpeakerXIcon class="h-4 w-4" />
          {:else}
            <SpeakerHighIcon class="h-4 w-4" />
          {/if}
        </button>
        {#if video && typeof video.requestPictureInPicture === 'function'}
          <button
            type="button"
            on:click={togglePictureInPicture}
            class="rounded-full bg-black/60 p-2 text-white hover:bg-black/80 {inPictureInPicture
              ? 'ring-1 ring-white/70'
              : ''}"
            aria-label="Picture in picture"
            title="Picture in picture"
          >
            <PictureInPictureIcon class="h-4 w-4" />
          </button>
        {/if}
        <button
          type="button"
          on:click={toggleFullscreen}
          class="rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
          aria-label="Full screen"
          title="Full screen"
        >
          <ArrowsOutIcon class="h-4 w-4" />
        </button>
      </div>
    </div>

    {#if autoplayRejected && video?.paused && $streamPlayer.status !== 'unavailable'}
      <button
        type="button"
        class="absolute inset-0 m-auto flex h-16 w-16 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black/90"
        aria-label="Play"
        title="Play"
        on:click={() => {
          autoplayRejected = false;
          video?.play().catch(() => {});
        }}
      >
        <PlayIcon class="h-7 w-7" />
      </button>
    {/if}
  {/if}

  {#if $streamPlayer.status === 'unavailable'}
    <div class="absolute inset-0 flex items-center justify-center bg-black/70 p-4 text-center">
      <p class="text-sm text-zinc-300">
        This stream is not reachable right now.
        {$streamPlayer.item?.recording ? 'A recording may be available later.' : ''}
      </p>
    </div>
  {/if}
</div>
