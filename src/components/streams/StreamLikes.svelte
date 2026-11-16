<script lang="ts">
  /**
   * Rapid-fire likes: a persistent heart at the player's corner. Taps and
   * holds fill the picture with floating hearts; a palette lets the viewer
   * pick the reaction (purple heart, fire, star, 100, grow-nostr, shaka).
   *
   * Likes are ephemeral: each one publishes an unsigned-persistence event
   * (kind 21111 — relays broadcast it live but never store it) whose
   * content names the reaction, so other Zap Cooking viewers on the stream
   * see the same icons float up live. Best-effort: without a signer,
   * hearts stay local. Unknown reaction ids render as the default heart,
   * so foreign content can never inject arbitrary glyphs.
   */
  import { onDestroy, onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { NDKEvent, NDKRelaySet, type NDKSubscription } from '@nostr-dev-kit/ndk';
  import { ndk } from '$lib/nostr';
  import { streamPlayer } from '$lib/stores/streamPlayer';
  import { DISCOVERY_RELAYS } from '$lib/streams/relays';
  import { clickOutside } from '$lib/clickOutside';
  import PlusIcon from 'phosphor-svelte/lib/Plus';

  interface ReactionSpec {
    label: string;
    emoji: string;
  }
  const REACTIONS: Record<ReactionId, ReactionSpec> = {
    purple: { label: 'Purple heart', emoji: '💜' },
    fire: { label: 'Fire', emoji: '🔥' },
    hug: { label: 'Hug', emoji: '🫂' },
    hundred: { label: '100', emoji: '💯' },
    plant: { label: 'Grow Nostr', emoji: '🌱' },
    shaka: { label: 'Shaka', emoji: '🤙' }
  };
  type ReactionId = 'purple' | 'fire' | 'hug' | 'hundred' | 'plant' | 'shaka';
  const DEFAULT_REACTION: ReactionId = 'purple';
  const REACTION_KEY = 'zap-like-reaction';
  /** Relay-ephemeral kind: broadcast live, never stored (NIP-16 range). */
  const LIKE_KIND = 21111;
  const MAX_LIVE_HEARTS = 36;
  const PUBLISH_MIN_GAP_MS = 400;
  /** Ambient pacing: a welcome burst on start that decays to a trickle. */
  const AMBIENT_START_MS = 700;
  const AMBIENT_STEADY_MS = 4500;
  const AMBIENT_DECAY = 1.35;

  function loadReaction(): ReactionId {
    if (!browser) return DEFAULT_REACTION;
    try {
      const saved = localStorage.getItem(REACTION_KEY);
      return saved && saved in REACTIONS ? (saved as ReactionId) : DEFAULT_REACTION;
    } catch {
      return DEFAULT_REACTION;
    }
  }

  interface Heart {
    id: number;
    reaction: ReactionId;
    x: number;
    rise: number;
    drift: number;
    scale: number;
    duration: number;
    /** Ambient cue: ghosted, slower, never published. */
    ghost?: boolean;
  }

  let reaction: ReactionId = loadReaction();
  let paletteOpen = false;
  let hearts: Heart[] = [];
  let idCounter = 0;
  let holdTimer: ReturnType<typeof setInterval> | null = null;
  /** Set on pointerdown: the click that follows is pointer-generated. */
  let pointerActivated = false;
  let myPubkey = '';
  let lastPublishAt = 0;
  let sub: NDKSubscription | null = null;
  let ambientTimer: ReturnType<typeof setTimeout> | null = null;
  let ambientDelay = AMBIENT_START_MS;
  let ambientKey = '';
  let streamPaused = false;
  $: streamPaused = $streamPlayer.paused === true;
  const reducedMotion =
    browser && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function selectReaction(id: ReactionId) {
    reaction = id;
    paletteOpen = false;
    try {
      localStorage.setItem(REACTION_KEY, id);
    } catch {
      /* not remembered: the picker just resets next visit */
    }
  }

  /** Template event handlers receive plain strings; narrow before cast. */
  function pickReaction(id: string) {
    if (id in REACTIONS) selectReaction(id as ReactionId);
  }

  /**
   * Discoverability cue: while the stream plays and nothing is flowing,
   * a ghosted heart leaks out of the like button every few seconds so viewers notice the
   * feature. Never published, skipped for reduced motion.
   */
  function spawnAmbient() {
    // Ghosts may stack a little (that's the burst) but never crowd out a
    // busy reaction shower.
    if (reducedMotion || document.hidden || streamPaused || hearts.length >= 3) {
      return;
    }
    const id = idCounter++;
    hearts = [
      ...hearts.slice(-(MAX_LIVE_HEARTS - 1)),
      {
        id,
        reaction,
        x: 8 + Math.random() * 36,
        rise: 100 + Math.random() * 60,
        drift: (Math.random() - 0.5) * 70,
        scale: 0.65 + Math.random() * 0.35,
        duration: 2.6 + Math.random() * 1.2,
        ghost: true
      }
    ];
    // Clear on the heart's own clock, so short ghosts free the guard early.
    setTimeout(() => (hearts = hearts.filter((h) => h.id !== id)), (2.6 + Math.random() * 1.2) * 1000 + 150);
  }

  function spawn(id: ReactionId = reaction) {
    const heartId = idCounter++;
    hearts = [
      ...hearts.slice(-(MAX_LIVE_HEARTS - 1)),
      {
        id: heartId,
        reaction: id,
        x: 8 + Math.random() * 40,
        rise: 150 + Math.random() * 110,
        drift: (Math.random() - 0.5) * 90,
        scale: 0.65 + Math.random() * 0.7,
        duration: 1.5 + Math.random() * 1.1
      }
    ];
    setTimeout(() => (hearts = hearts.filter((h) => h.id !== heartId)), 2700);
  }

  /** A heart from another viewer: same rise, spawned at the button. */
  function spawnRemote(id: ReactionId) {
    spawn(id);
  }

  function press() {
    pointerActivated = true;
    if (holdTimer) return;
    spawn();
    holdTimer = setInterval(() => spawn(), 90);
  }

  function release() {
    if (holdTimer) {
      clearInterval(holdTimer);
      holdTimer = null;
    }
  }

  /** Keyboard activation (Enter/Space/synthesized click) likes too —
      pointer clicks already liked in press(), without a duplicate. */
  function activate() {
    if (pointerActivated) {
      pointerActivated = false;
      return;
    }
    spawn();
  }

  /** Throttled ephemeral publish: at most one signed event per 400ms of
      liking — a hold still reads as a shower without hammering relays. */
  async function publishLike() {
    const item = $streamPlayer.item;
    if (!item || !browser) return;
    try {
      const ev = new NDKEvent($ndk);
      ev.kind = LIKE_KIND;
      ev.content = reaction;
      const aTag = item.key.startsWith('30311:') ? item.key : null;
      ev.tags = aTag ? [['a', aTag]] : item.noteId ? [['e', item.noteId]] : [];
      await ev.sign();
      const urls = [
        ...new Set([...(item.relays || []), ...DISCOVERY_RELAYS, ...$ndk.pool.relays.keys()])
      ];
      await Promise.race([
        ev.publish(NDKRelaySet.fromRelayUrls(urls, $ndk, true)),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
      ]);
    } catch {
      // Best-effort: a failed publish just means a local-only heart.
    }
  }

  function spawnLocal() {
    spawn();
    const now = Date.now();
    if (now - lastPublishAt >= PUBLISH_MIN_GAP_MS) {
      lastPublishAt = now;
      void publishLike();
    }
  }

  // Target changes with the stream: close and resubscribe.
  $: item = $streamPlayer.item;
  $: streamKey = item?.key ?? null;
  $: noteId = item?.noteId ?? null;
  $: itemRelays = item?.relays ?? [];
  $: aTag = streamKey?.startsWith('30311:') ? streamKey : null;

  /** Welcome burst on start (and on stream switches): ticks come quick
      and decay toward the steady trickle. */
  function startAmbient() {
    if (reducedMotion) return;
    if (ambientTimer) clearTimeout(ambientTimer);
    ambientDelay = AMBIENT_START_MS;
    const tick = () => {
      spawnAmbient();
      ambientDelay = Math.min(AMBIENT_STEADY_MS, Math.round(ambientDelay * AMBIENT_DECAY));
      ambientTimer = setTimeout(tick, ambientDelay);
    };
    ambientTimer = setTimeout(tick, ambientDelay);
  }

  onMount(async () => {
    startAmbient();
    try {
      const user = await $ndk.signer?.user();
      myPubkey = user?.pubkey ?? '';
    } catch {
      myPubkey = '';
    }
  });

  async function resubscribe(
    key: string | null,
    a: string | null,
    n: string | null,
    relays: string[]
  ) {
    sub?.stop();
    sub = null;
    if (key && key !== ambientKey) {
      ambientKey = key;
      startAmbient();
    }
    if (!browser || (!a && !n) || relays.length === 0) return;
    try {
      const relaySet = NDKRelaySet.fromRelayUrls(relays, $ndk);
      const filter = a ? { kinds: [LIKE_KIND], '#a': [a] } : { kinds: [LIKE_KIND], '#e': [n] };
      if (!filter) return;
      sub = $ndk.subscribe(filter as never, { closeOnEose: false }, relaySet);
      sub.on('event', (e) => {
        // Own hearts already floated when published.
        if (myPubkey && e.pubkey === myPubkey) return;
        const id = (e.content || '').trim();
        spawnRemote(id in REACTIONS ? (id as ReactionId) : DEFAULT_REACTION);
      });
    } catch {
      // Subscribe failure only loses other viewers' hearts.
    }
  }

  $: resubscribe(streamKey, aTag, noteId, itemRelays);

  onDestroy(() => {
    release();
    if (ambientTimer) clearTimeout(ambientTimer);
    sub?.stop();
    sub = null;
  });
</script>

{#if paletteOpen}
  <div
    class="like-palette"
    role="radiogroup"
    aria-label="Choose a reaction"
    use:clickOutside
    on:click_outside={() => (paletteOpen = false)}
  >
    {#each Object.entries(REACTIONS) as [id, r] (id)}
      <button
        type="button"
        class="palette-item"
        aria-label={r.label}
        aria-pressed={reaction === id}
        title={r.label}
        on:click={() => pickReaction(id)}
      >
        <span class="like-emoji">{r.emoji}</span>
      </button>
    {/each}
  </div>
{/if}

<!-- The reaction buttons sit in a small cluster above the player's
     control bar, so they never land on top of the video UI. -->
<div class="like-cluster">
  <div class="like-wrap">
    <button
      type="button"
      class="like-btn"
      aria-label={`Send a ${REACTIONS[reaction].label} like`}
      title="Like (hold to shower)"
      on:pointerdown={press}
      on:pointerup={release}
      on:pointerleave={release}
      on:pointercancel={release}
      on:keydown={(e) => {
        // Enter/Space on a button fire click; nothing extra to do here, but
        // prevent scroll on Space.
        if (e.key === ' ') e.preventDefault();
      }}
      on:click={activate}
      on:contextmenu|preventDefault
    >
      <span class="like-emoji">{REACTIONS[reaction].emoji}</span>
    </button>
    <!-- The tiny + badge opens the reaction palette: distinct from the
         like button, so no emoji shows twice. -->
    <button
      type="button"
      class="palette-toggle"
      aria-label="Change reaction"
      aria-expanded={paletteOpen}
      title="Change reaction"
      on:click={() => (paletteOpen = !paletteOpen)}
    >
      <PlusIcon size={9} weight="bold" />
    </button>
  </div>
</div>

<div class="like-hearts" aria-hidden="true">
  {#each hearts as heart (heart.id)}
    <span
      class="like-heart"
      class:like-heart--ghost={heart.ghost}
      style="right: {heart.x}px; --rise: -{Math.round(
        heart.rise
      )}px; --drift: {Math.round(heart.drift)}px; --scale: {heart.scale.toFixed(
        2
      )}; animation-duration: {heart.duration.toFixed(2)}s;"
    >
      <span class="like-emoji">{REACTIONS[heart.reaction].emoji}</span>
    </span>
  {/each}
</div>

<style>
  /* The cluster rides above the player's control bar (scrub + buttons),
     so the reaction buttons never overlap the video UI. */
  .like-cluster {
    position: absolute;
    right: 0.75rem;
    bottom: 6rem;
    z-index: 40;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    user-select: none;
  }
  .like-btn {
    display: grid;
    place-items: center;
    border-radius: 9999px;
    background: rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(4px);
    cursor: pointer;
    touch-action: none;
    user-select: none;
    transition:
      transform 0.12s ease,
      background-color 0.2s ease;
  }
  .like-wrap {
    position: relative;
    display: grid;
  }
  .palette-toggle {
    position: absolute;
    top: -7px;
    left: -7px;
    z-index: 2;
    width: 16px;
    height: 16px;
    padding: 0;
    display: grid;
    place-items: center;
    border-radius: 9999px;
    border: 1px solid rgba(255, 255, 255, 0.3);
    background: rgba(0, 0, 0, 0.75);
    color: #fff;
    cursor: pointer;
    transition: transform 0.12s ease;
  }
  .palette-toggle:hover {
    transform: scale(1.15);
    background: rgba(0, 0, 0, 0.95);
  }
  .like-btn {
    width: 2.25rem;
    height: 2.25rem;
  }
  .like-btn:hover {
    background: rgba(0, 0, 0, 0.55);
    transform: scale(1.06);
  }
  .like-btn:active {
    transform: scale(0.92);
  }
  .like-palette {
    position: absolute;
    right: 0.75rem;
    bottom: 9rem;
    z-index: 45;
    display: flex;
    gap: 0.25rem;
    padding: 0.375rem;
    border-radius: 9999px;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(6px);
    user-select: none;
    cursor: default;
  }

  .palette-item .like-emoji {
    font-size: 22px;
  }
  .like-btn .like-emoji {
    font-size: 20px;
  }
  .like-heart .like-emoji {
    font-size: 26px;
  }
  .like-emoji {
    line-height: 1;
  }
  .palette-item {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border-radius: 9999px;
    cursor: pointer;
    transition: transform 0.12s ease, background-color 0.15s ease;
  }
  .palette-item:hover {
    background: rgba(255, 255, 255, 0.12);
    transform: scale(1.12);
  }
  .palette-item[aria-pressed='true'] {
    background: rgba(255, 255, 255, 0.18);
  }
  .like-hearts {
    position: absolute;
    inset: 0;
    z-index: 35;
    overflow: hidden;
    pointer-events: none;
  }
  .like-heart {
    position: absolute;
    bottom: 6.5rem;
    /* Dark halo + light glow: readable on bright and dark video alike. */
    filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.8)) drop-shadow(0 0 6px rgba(255, 255, 255, 0.35));
    animation: like-rise ease-out forwards;
  }
  .like-heart--ghost {
    animation-name: like-rise-ghost;
  }
  @keyframes like-rise-ghost {
    0% {
      transform: translate(0, 0) scale(calc(var(--scale) * 0.6));
      opacity: 0;
    }
    18% {
      opacity: 0.3;
    }
    100% {
      transform: translate(var(--drift), var(--rise)) scale(var(--scale));
      opacity: 0;
    }
  }
  @keyframes like-rise {
    0% {
      transform: translate(0, 0) scale(calc(var(--scale) * 0.6));
      opacity: 0;
    }
    8% {
      transform: translate(0, calc(var(--rise) * 0.12)) scale(var(--scale));
      opacity: 1;
    }
    78% {
      transform: translate(calc(var(--drift) * 0.8), calc(var(--rise) * 0.82)) scale(var(--scale));
      opacity: 1;
    }
    100% {
      transform: translate(var(--drift), var(--rise)) scale(calc(var(--scale) * 0.9));
      opacity: 0;
    }
  }
</style>
