<script lang="ts">
  /**
   * Rapid-fire likes: a persistent heart at the player's corner. Taps and
   * holds fill the picture with floating hearts; a palette lets the viewer
   * pick the reaction (purple heart, fire, hug, 100, grow-nostr, shaka).
   *
   * Likes are ephemeral: each one publishes a signed kind 21111 event
   * (relays broadcast it live but never store it) whose content names the
   * reaction, so other Zap Cooking viewers on the stream — and the host,
   * on their Go live page — see the same icons float up live. It is
   * tagged with both the "Live now" note and the stream's address (see
   * $lib/streams/liveReactions). Best-effort: without a signer, hearts
   * stay local. Unknown reaction ids render as the default heart, so
   * foreign content can never inject arbitrary glyphs.
   *
   * Other people's reactions come from the shared feed
   * ($lib/streams/liveReactionFeed), which leaves out muted and hidden
   * pubkeys.
   */
  import { onDestroy, onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { NDKEvent, NDKRelaySet } from '@nostr-dev-kit/ndk';
  import { ndk } from '$lib/nostr';
  import { streamPlayer } from '$lib/stores/streamPlayer';
  import { DISCOVERY_RELAYS } from '$lib/streams/relays';
  import { openReactionFeed } from '$lib/streams/liveReactionFeed';
  import {
    DEFAULT_REACTION,
    LIKE_KIND,
    LikePacer,
    REACTIONS,
    hasTargets,
    isReactionId,
    reactionTags,
    reactionTargets,
    targetsKey,
    type ReactionId
  } from '$lib/streams/liveReactions';
  import { clickOutside } from '$lib/clickOutside';
  import PlusIcon from 'phosphor-svelte/lib/Plus';
  import ReactionHearts from './ReactionHearts.svelte';

  const REACTION_KEY = 'zap-like-reaction';
  /** Ambient pacing: a welcome burst on start that decays to a trickle. */
  const AMBIENT_START_MS = 700;
  const AMBIENT_STEADY_MS = 4500;
  const AMBIENT_DECAY = 1.35;

  function loadReaction(): ReactionId {
    if (!browser) return DEFAULT_REACTION;
    try {
      const saved = localStorage.getItem(REACTION_KEY);
      return isReactionId(saved) ? saved : DEFAULT_REACTION;
    } catch {
      return DEFAULT_REACTION;
    }
  }

  let reaction: ReactionId = loadReaction();
  let paletteOpen = false;
  let layer: ReactionHearts | null = null;
  let holdTimer: ReturnType<typeof setInterval> | null = null;
  /** Set on pointerdown: the click that follows is pointer-generated. */
  let pointerActivated = false;
  let outsideClosedAt = 0;
  let myPubkey = '';
  const pacer = new LikePacer();
  let stopFeed: (() => void) | null = null;
  let feedKey = '';
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
    if (isReactionId(id)) selectReaction(id);
  }

  /**
   * Discoverability cue: while the stream plays and nothing is flowing,
   * a ghosted heart leaks out of the like button every few seconds so viewers notice the
   * feature. Never published, skipped for reduced motion.
   */
  function spawnAmbient() {
    if (reducedMotion || document.hidden || streamPaused) return;
    layer?.spawnGhost(reaction);
  }

  function press() {
    pointerActivated = true;
    if (holdTimer) return;
    spawnLocal();
    holdTimer = setInterval(spawnLocal, 90);
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
    spawnLocal();
  }

  /**
   * One ephemeral publish. The pacer (see LikePacer) allows one signature
   * request at a time and spaces them by how the signer behaves, so a
   * hold reads as a shower without hammering relays or stacking prompts
   * on a remote signer.
   */
  async function publishLike() {
    const item = $streamPlayer.item;
    if (!item || !browser) return;
    const targets = reactionTargets(item);
    // A stream with neither an address nor a note has nothing to hang a like on.
    if (!hasTargets(targets)) return;
    const startedAt = Date.now();
    if (!pacer.canStart(startedAt)) return;
    const token = pacer.start(startedAt);
    let signed = false;
    try {
      const ev = new NDKEvent($ndk);
      ev.kind = LIKE_KIND;
      ev.content = reaction;
      ev.tags = reactionTags(targets);
      try {
        await ev.sign();
        signed = true;
      } finally {
        pacer.finish(token, Date.now(), signed);
      }
      // Know our own hearts on receive, even after a late login.
      myPubkey = ev.pubkey;
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
    layer?.spawn(reaction);
    if (pacer.canStart(Date.now())) void publishLike();
  }

  // Target changes with the stream: close and resubscribe.
  $: item = $streamPlayer.item;
  $: streamKey = item?.key ?? null;
  $: targets = reactionTargets(item);
  $: itemRelays = item?.relays ?? [];
  $: sessionId = item?.source === 'zapcooking' ? (item.sessionId ?? null) : null;

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

  function resubscribe(key: string | null, targetKey: string, relays: string[], session: string | null) {
    if (key && key !== ambientKey) {
      ambientKey = key;
      startAmbient();
    }
    const next = `${targetKey}|${session ?? ''}|${relays.join(',')}`;
    if (!browser || next === feedKey) return;
    feedKey = next;
    stopFeed?.();
    stopFeed = openReactionFeed({
      ndk: $ndk,
      targets,
      relays,
      sessionId: session,
      // Own hearts already floated when tapped.
      self: () => myPubkey,
      onReaction: (id) => layer?.spawn(id)
    });
  }

  $: resubscribe(streamKey, targetsKey(targets), itemRelays, sessionId);

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') paletteOpen = false;
  }

  onDestroy(() => {
    release();
    if (ambientTimer) clearTimeout(ambientTimer);
    stopFeed?.();
    stopFeed = null;
  });
</script>

{#if paletteOpen}
  <div
    class="like-palette"
    role="radiogroup"
    aria-label="Choose a reaction"
    use:clickOutside
    on:click_outside={() => {
      paletteOpen = false;
      outsideClosedAt = Date.now();
    }}
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
<svelte:window on:keydown={handleKeydown} />

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
      on:click={() => {
        // clickOutside closed it on the capture phase; this very click
        // must not immediately reopen it.
        if (Date.now() - outsideClosedAt < 250) return;
        paletteOpen = !paletteOpen;
      }}
    >
      <PlusIcon size={9} weight="bold" />
    </button>
  </div>
</div>

<ReactionHearts bind:this={layer} />

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
</style>
