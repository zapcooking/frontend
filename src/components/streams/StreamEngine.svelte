<script lang="ts">
  /**
   * The one HLS/video owner for its surface (page, dock, pop-out).
   *
   * hls.js is a 1.7 MB dependency, so it is loaded on the first HLS play
   * through a dynamic import (a separate chunk); plain mp4/webm files use a
   * direct src. Safari also gets hls.js (low-latency mode off) when it can
   * run it, because zap.stream's LL-HLS playlists freeze AVPlayer — see
   * $lib/streams/hlsEngine. Native HLS is the fallback. Status flows into the
   * `streamPlayer` store, where the playing surface's UI reads it.
   *
   * Go live sessions (`item.source === 'zapcooking'`) have no URL. They play
   * over a receive-only WebRTC connection set up through Zap Cooking's play
   * relay (/api/live/<id>/join), with the rejoin rules in WatchPolicy and
   * the rejoin pass from the server. A member is asked to sign only if the
   * session turns out to be full for guests.
   */
  import { onDestroy, onMount } from 'svelte';
  import {
    streamPlayer,
    setStreamStatus,
    setStreamMuted,
    setStreamPosition
  } from '$lib/stores/streamPlayer';
  import { runtime } from '$lib/streams/parse';
  import { hlsJsConfig, pickHlsEngine } from '$lib/streams/hlsEngine';
  import { get } from 'svelte/store';
  import { isGoLiveItem } from '$lib/streams/goLive';
  import { ndk, userPublickey } from '$lib/nostr';
  import { signNip98AuthHeader } from '$lib/nip98';
  import { joinLiveSession, loadPass, savePass } from '$lib/live/watch/joinClient';
  import { WatchPolicy, type WatchStop } from '$lib/live/watch/watchPolicy';
  import PlayIcon from 'phosphor-svelte/lib/Play';
  import SpeakerHighIcon from 'phosphor-svelte/lib/SpeakerHigh';
  import SpeakerXIcon from 'phosphor-svelte/lib/SpeakerX';
  import PictureInPictureIcon from 'phosphor-svelte/lib/PictureInPicture';
  import ArrowsOutIcon from 'phosphor-svelte/lib/ArrowsOut';
  import { showToast } from '$lib/toast';

  export let surface: 'page' | 'dock' | 'popout' = 'page';

  /**
   * Round overlay buttons. 32px in the small corner dock; 40px on touch
   * screens once the player is wide enough (page embed on a phone). The bar
   * they sit in is pointer-events-none, so a tap that lands between small
   * buttons falls through to the video and toggles pause — bigger targets
   * and a wider gap are what make mute / picture-in-picture / full screen
   * reliable under a thumb.
   */
  const ctrlBtn =
    'inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 @min-[340px]:pointer-coarse:h-10 @min-[340px]:pointer-coarse:w-10';

  let video: HTMLVideoElement | null = null;
  let container: HTMLElement | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let hls: any = null;
  /** Generation + media URL this element is currently wired to. */
  let appliedGeneration = -1;
  let appliedUrl: string | null = null;
  let autoplayRejected = false;
  let paused = true;
  let inPictureInPicture = false;

  const isDirectFile = (url: string) => /\.(mp4|webm|ogv)(?:[?#]|$)/i.test(url);
  const supportsNativeHls = (el: HTMLVideoElement) =>
    !!el.canPlayType('application/vnd.apple.mpegurl');

  let hlsPromise: Promise<(typeof import('hls.js'))['default'] | null> | null = null;
  function loadHls() {
    hlsPromise = hlsPromise || import('hls.js').then((m) => m.default).catch(() => null);
    return hlsPromise;
  }

  // ── Go live (WebRTC through our play relay) ──────────────────────
  let pc: RTCPeerConnection | null = null;
  let policy: WatchPolicy | null = null;
  let statsTimer: ReturnType<typeof setInterval> | null = null;

  const passStorage = () => (typeof sessionStorage !== 'undefined' ? sessionStorage : undefined);

  function stopRtc() {
    policy?.shutdown();
    policy = null;
    if (statsTimer) clearInterval(statsTimer);
    statsTimer = null;
    pc?.close();
    pc = null;
    if (video) video.srcObject = null;
  }

  function playVideo() {
    video?.play().then(
      () => {},
      () => {
        // Autoplay with sound can be refused; the play overlay takes over.
        autoplayRejected = true;
      }
    );
  }

  function gathered(conn: RTCPeerConnection): Promise<void> {
    if (conn.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        conn.removeEventListener('icegatheringstatechange', check);
        resolve();
      };
      const check = () => conn.iceGatheringState === 'complete' && done();
      conn.addEventListener('icegatheringstatechange', check);
      setTimeout(done, 2000);
    });
  }

  /** A signed-in viewer with a signer can be counted as a member. */
  function canSignAsMember(): boolean {
    return !!get(userPublickey) && !!get(ndk)?.signer;
  }

  function startRtc(sessionId: string, generation: number) {
    policy = new WatchPolicy({
      rejoin: () => void rtcJoin(sessionId, generation),
      stop: (reason) => rtcStopped(reason, generation),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>)
    });
    policy.setHidden(typeof document !== 'undefined' && document.hidden);
    statsTimer = setInterval(pollFrames, 1000);
    void rtcJoin(sessionId, generation);
  }

  async function rtcJoin(sessionId: string, generation: number, signed = false) {
    if (generation !== appliedGeneration || !policy) return;
    policy.joinStarted();
    pc?.close();
    const conn = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
    pc = conn;
    conn.addTransceiver('video', { direction: 'recvonly' });
    conn.addTransceiver('audio', { direction: 'recvonly' });
    const media = new MediaStream();
    conn.ontrack = (e) => {
      media.addTrack(e.track);
      if (video && video.srcObject !== media) {
        video.srcObject = media;
        playVideo();
      }
    };

    let offerSdp: string;
    let authorization: string | null = null;
    try {
      await conn.setLocalDescription(await conn.createOffer());
      await gathered(conn);
      offerSdp = conn.localDescription?.sdp ?? '';
      if (signed) {
        authorization = await signNip98AuthHeader(get(ndk), {
          method: 'POST',
          url: `${location.origin}/api/live/${sessionId}/join`,
          bodyString: offerSdp
        });
      }
    } catch {
      if (pc === conn) {
        conn.close();
        policy?.joinFailed(signed ? 'full' : 'retry');
      }
      return;
    }

    const out = await joinLiveSession(sessionId, offerSdp, {
      pass: loadPass(passStorage(), sessionId),
      authorization
    });
    if (pc !== conn || generation !== appliedGeneration || !policy) {
      conn.close();
      return;
    }
    if (!out.ok) {
      conn.close();
      // Full for guests: a signed-in member gets in uncounted. Ask the
      // signer only now, so a member is not prompted on every join.
      if (out.failure === 'full' && !signed && canSignAsMember()) {
        void rtcJoin(sessionId, generation, true);
        return;
      }
      if (out.failure === 'not_live' || out.failure === 'retry' || out.failure === 'rejected') {
        setStreamStatus(out.failure === 'not_live' ? 'connecting' : 'buffering');
      }
      policy.joinFailed(out.failure);
      return;
    }
    savePass(passStorage(), sessionId, out.pass);
    try {
      await conn.setRemoteDescription({ type: 'answer', sdp: out.answerSdp });
      policy.joinSucceeded();
    } catch {
      conn.close();
      policy.joinFailed('retry');
    }
  }

  async function pollFrames() {
    if (!pc || !policy) return;
    try {
      const report = await pc.getStats();
      let frames: number | null = null;
      report.forEach((s: { type?: string; kind?: string; framesDecoded?: number }) => {
        if (s.type === 'inbound-rtp' && s.kind === 'video') frames = s.framesDecoded ?? 0;
      });
      if (frames !== null) policy.frames(frames);
    } catch {
      /* stats unavailable this tick */
    }
  }

  function rtcStopped(reason: WatchStop, generation: number) {
    if (generation !== appliedGeneration) return;
    if (statsTimer) clearInterval(statsTimer);
    statsTimer = null;
    pc?.close();
    pc = null;
    setStreamStatus(reason === 'full' ? 'full' : reason === 'gave_up' ? 'unavailable' : 'ended');
  }

  function onVisibility() {
    policy?.setHidden(document.hidden);
  }

  function teardownMedia() {
    stopRtc();
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
    const goLive = isGoLiveItem(state.item);
    if (!state.item || state.surface !== surface || (!goLive && !state.mediaUrl)) {
      if (appliedGeneration !== -1) teardownMedia();
      return;
    }
    if (goLive) {
      const sessionId = state.item.sessionId;
      if (!sessionId || state.item.status === 'ended') {
        if (appliedGeneration !== -1) teardownMedia();
        // Guarded: setting the status re-runs this function through the store.
        if (state.status !== 'ended') setStreamStatus('ended');
        return;
      }
      const target = `rtc:${sessionId}`;
      if (state.generation === appliedGeneration && target === appliedUrl) return;
      teardownMedia();
      appliedGeneration = state.generation;
      appliedUrl = target;
      autoplayRejected = false;
      setStreamStatus('connecting');
      video.muted = state.muted;
      startRtc(sessionId, state.generation);
      return;
    }
    if (!state.mediaUrl) return;
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
    const nativeHls = supportsNativeHls(video);
    const Hls = await loadHls();
    if (appliedGeneration !== state.generation || appliedUrl !== state.mediaUrl) return;

    const playNative = () => {
      if (!video) return;
      video.src = state.mediaUrl!;
      begin();
    };
    const engine = pickHlsEngine({
      nativeHls,
      hlsJsSupported: !!Hls && Hls.isSupported()
    });
    if (engine === 'native') {
      playNative();
      return;
    }
    if (engine === 'none' || !Hls) {
      setStreamStatus('unavailable');
      return;
    }
    hls = new Hls(hlsJsConfig(nativeHls));
    hls.on(Hls.Events.ERROR, (_: unknown, data: { fatal: boolean }) => {
      if (!data.fatal || appliedGeneration !== state.generation) return;
      // hls.js gave up. Where the browser has its own HLS player, hand the
      // stream to it rather than showing "unavailable".
      if (nativeHls) {
        hls?.destroy();
        hls = null;
        playNative();
        return;
      }
      setStreamStatus('unavailable');
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
    document.addEventListener('visibilitychange', onVisibility);
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

  // iPhone Safari has no standard PiP API on the video element; WebKit's own
  // presentation mode is how it enters picture-in-picture there.
  type WebkitVideo = HTMLVideoElement & {
    webkitSetPresentationMode?: (mode: 'inline' | 'picture-in-picture' | 'fullscreen') => void;
    webkitPresentationMode?: string;
    webkitSupportsPresentationMode?: (mode: string) => boolean;
  };

  /**
   * Whether to offer the button: either API exists. Deliberately NOT gated on
   * `pictureInPictureEnabled` or `webkitSupportsPresentationMode`: the latter
   * is false until media has loaded (so a check at render time would hide a
   * working button for good), and both can be false in cases where the tap
   * should still try. A failed attempt says so instead (see below).
   */
  function pipSupported(el: HTMLVideoElement | null): boolean {
    if (!el) return false;
    return (
      typeof el.requestPictureInPicture === 'function' ||
      typeof (el as WebkitVideo).webkitSetPresentationMode === 'function'
    );
  }

  const pipUnavailable = () =>
    showToast('error', 'Picture in picture isn’t available for this stream right now.');

  /** One attempt to enter PiP: the standard API, then WebKit's presentation mode. */
  async function enterPictureInPicture(el: WebkitVideo): Promise<boolean> {
    if (typeof el.requestPictureInPicture === 'function') {
      try {
        await el.requestPictureInPicture();
        return true;
      } catch {
        // Fall through: iPhone Safari may refuse the standard call but take
        // its own presentation mode.
      }
    }
    if (
      typeof el.webkitSetPresentationMode === 'function' &&
      el.webkitSupportsPresentationMode?.('picture-in-picture') !== false
    ) {
      el.webkitSetPresentationMode('picture-in-picture');
      return true;
    }
    return false;
  }

  async function togglePictureInPicture() {
    const el = video as WebkitVideo | null;
    if (!el) return;
    try {
      // Leaving PiP.
      if (document.pictureInPictureElement === el) {
        await document.exitPictureInPicture();
        return;
      }
      if (el.webkitPresentationMode === 'picture-in-picture') {
        el.webkitSetPresentationMode?.('inline');
        return;
      }
      // Entering — straight from the tap: Safari only honors PiP requests
      // made inside the user gesture, so nothing is awaited before this.
      if (await enterPictureInPicture(el)) return;

      // Tapped before the stream's metadata arrived: wait for it once and
      // retry (still inside the gesture window in Chrome).
      if (el.readyState < 1) {
        const ready = await new Promise<boolean>((resolve) => {
          const done = (ok: boolean) => {
            el.removeEventListener('loadedmetadata', onMeta);
            clearTimeout(timer);
            resolve(ok);
          };
          const onMeta = () => done(true);
          const timer = setTimeout(() => done(false), 4000);
          el.addEventListener('loadedmetadata', onMeta, { once: true });
        });
        if (ready && (await enterPictureInPicture(el))) return;
      }
      pipUnavailable();
    } catch {
      pipUnavailable();
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
  function onWebkitPresentationMode() {
    inPictureInPicture =
      (video as WebkitVideo | null)?.webkitPresentationMode === 'picture-in-picture';
  }
  function bindVideo(el: HTMLVideoElement) {
    video = el;
    el.addEventListener('enterpictureinpicture', onEnterPip);
    el.addEventListener('leavepictureinpicture', onLeavePip);
    el.addEventListener('webkitpresentationmodechanged', onWebkitPresentationMode);
    return {
      destroy() {
        el.removeEventListener('enterpictureinpicture', onEnterPip);
        el.removeEventListener('leavepictureinpicture', onLeavePip);
        el.removeEventListener('webkitpresentationmodechanged', onWebkitPresentationMode);
      }
    };
  }

  onDestroy(() => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility);
    }
    teardownMedia();
  });
</script>

<div
  bind:this={container}
  class="@container relative w-full overflow-hidden rounded-xl bg-black aspect-video group"
>
  <!-- Live relay video has no caption track; the a11y rule targets media
       with meaningful content that can carry one. -->
  <!-- svelte-ignore a11y-media-has-caption -->
  <video
    use:bindVideo
    class="h-full w-full"
    playsinline
    on:playing={() => {
      setStreamStatus('playing');
      paused = false;
    }}
    on:pause={() => (paused = true)}
    on:waiting={() => setStreamStatus('buffering')}
    on:error={handleError}
    on:timeupdate={() => {
      const item = $streamPlayer.item;
      if (video && item?.status === 'ended') setStreamPosition(video.currentTime);
    }}
    on:playing={() => (paused = false)}
    on:pause={() => (paused = true)}
    on:click={() => {
      if (video?.paused) video.play().catch(() => {});
      else video?.pause();
    }}
  ></video>
  <!-- Persistent keyboard-accessible play/pause: the video's own click
       handler stays for pointer users; this labeled button serves
       keyboard and screen-reader users at all times. -->
  <button
    type="button"
    class="{ctrlBtn} pointer-events-auto absolute bottom-3 left-3 transition-colors"
    aria-label={paused ? 'Play stream' : 'Pause stream'}
    title={paused ? 'Play' : 'Pause'}
    on:click|stopPropagation={() => {
      if (video?.paused) video.play().catch(() => {});
      else video?.pause();
    }}
  >
    {#if paused}
      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M8 5v14l11-7z" />
      </svg>
    {:else}
      <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
      </svg>
    {/if}
  </button>
  {#if $streamPlayer.item}
    <div class="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
      <span
        class="pointer-events-auto rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide
          {$streamPlayer.item.status === 'ended'
          ? 'bg-zinc-700 text-zinc-200'
          : 'bg-red-600 text-white animate-pulse'}"
      >
        {$streamPlayer.item.status === 'ended'
          ? isGoLiveItem($streamPlayer.item)
            ? 'Ended'
            : 'Replay'
          : 'Live'}
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
      <div class="pointer-events-auto flex shrink-0 items-center gap-1 @min-[340px]:pointer-coarse:gap-2">
        <button
          type="button"
          on:click={toggleMute}
          class={ctrlBtn}
          aria-label={$streamPlayer.muted ? 'Unmute' : 'Mute'}
          title={$streamPlayer.muted ? 'Unmute' : 'Mute'}
        >
          {#if $streamPlayer.muted}
            <SpeakerXIcon class="h-4 w-4" />
          {:else}
            <SpeakerHighIcon class="h-4 w-4" />
          {/if}
        </button>
        {#if pipSupported(video)}
          <button
            type="button"
            on:click={togglePictureInPicture}
            class="{ctrlBtn} {inPictureInPicture ? 'ring-1 ring-white/70' : ''}"
            aria-label="Picture in picture"
            title="Picture in picture"
          >
            <PictureInPictureIcon class="h-4 w-4" />
          </button>
        {/if}
        <button
          type="button"
          on:click={toggleFullscreen}
          class={ctrlBtn}
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

  {#if $streamPlayer.status === 'ended' && isGoLiveItem($streamPlayer.item)}
    <div class="absolute inset-0 flex items-center justify-center bg-black/75 p-4 text-center">
      <p class="text-sm font-medium text-zinc-100">This live stream has ended</p>
    </div>
  {:else if $streamPlayer.status === 'full'}
    <div
      class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 p-4 text-center"
    >
      <p class="text-sm font-medium text-zinc-100">
        This live stream is full for guests. Cook+ members always get in.
      </p>
      <a
        href="/membership"
        class="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-200"
      >
        Become a member
      </a>
    </div>
  {:else if $streamPlayer.status === 'unavailable'}
    <div class="absolute inset-0 flex items-center justify-center bg-black/70 p-4 text-center">
      <p class="text-sm text-zinc-300">
        This stream is not reachable right now.
        {$streamPlayer.item?.recording ? 'A recording may be available later.' : ''}
      </p>
    </div>
  {/if}
</div>
