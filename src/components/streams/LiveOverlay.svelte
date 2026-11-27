<script lang="ts">
  /**
   * Go live overlays drawn over the video: the newest comments along the
   * bottom (avatar, name, text; each fades after ~8 s) and, for each
   * verified zap, lightning falling over the picture with
   * "⚡ N sats from Name". Zaps within a few seconds of each other share one
   * animation with a combined total; its size follows the total.
   *
   * Reads `overlayFeed`, which the chat fills: hidden and muted commenters
   * are already left out there. Nothing here is interactive — the layer
   * takes no taps, so the player's controls and the video work as before.
   *
   * Cheap on purpose: CSS transforms and opacity only (no filters, no
   * canvas), at most a few dozen small SVG bolts, and nothing runs while
   * there is nothing to show. With prefers-reduced-motion a static banner
   * replaces the lightning and comments appear and go without fading.
   */
  import { onDestroy, onMount } from 'svelte';
  import { overlayFeed } from '$lib/live/overlay/overlayFeed';
  import {
    truncateComment,
    visibleComments,
    zapBannerText,
    ZapGrouper,
    type ZapGroup
  } from '$lib/live/overlay/overlay';
  import {
    LIVE_OVERLAY_COMMENT_MS,
    LIVE_ZAP_ANIMATION,
    LIVE_ZAP_BANNER_MS
  } from '$lib/live/config';
  import Avatar from '../Avatar.svelte';

  /** The session's chat address this overlay belongs to. */
  export let target: string | null;
  export let showComments = true;
  export let showZaps = true;
  /** Space kept clear under the comments for the player's control bar. */
  export let bottom = '4.25rem';
  /** A small player: fewer, smaller rows. */
  export let compact = false;

  $: feed = $overlayFeed.target && $overlayFeed.target === target ? $overlayFeed : null;

  let reducedMotion = false;
  let now = Date.now();
  const mountedAt = now;
  let timer: ReturnType<typeof setInterval> | null = null;

  onMount(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => (reducedMotion = mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  });

  // ── Zaps ────────────────────────────────────────────────────────────
  const grouper = new ZapGrouper();
  let group: ZapGroup | null = null;
  const handled = new Set<string>();
  $: if (feed) takeZaps(feed.zaps);
  function takeZaps(zaps: typeof $overlayFeed.zaps) {
    for (const zap of zaps) {
      if (handled.has(zap.id)) continue;
      handled.add(zap.id);
      // Only zaps that arrive while this overlay is up: no replay on mount.
      if (zap.at < mountedAt - 1000) continue;
      const g = grouper.add(zap);
      if (g) group = g;
    }
    now = Date.now();
  }

  $: bannerUntil = group ? Math.max(group.until, group.lastAt + LIVE_ZAP_BANNER_MS) : 0;
  $: zapShown = showZaps && !!group && now < bannerUntil;
  $: boltsShown = zapShown && !reducedMotion && !!group && now < group.until;
  $: boltCount = group ? LIVE_ZAP_ANIMATION[group.tier].bolts : 0;
  $: ending = !!group && group.until - now < 700;

  /** Fixed random layout for the most bolts any size uses. */
  const BOLTS = Array.from({ length: LIVE_ZAP_ANIMATION.large.bolts }, (_, i) => ({
    i,
    left: Math.random() * 96,
    delay: Math.random() * 1.2,
    fall: 1.3 + Math.random() * 1.1,
    size: 14 + Math.random() * 16,
    drift: (Math.random() - 0.5) * 40,
    spin: (Math.random() - 0.5) * 50
  }));

  function nameOf(pubkey: string): string {
    return feed?.profiles[pubkey]?.name || 'someone';
  }
  $: banner = group ? zapBannerText(group, (pk) => nameOf(pk)) : '';

  // ── Comments ────────────────────────────────────────────────────────
  $: comments =
    showComments && feed ? visibleComments(feed.comments, now).slice(compact ? -2 : -3) : [];

  // Tick only while something is on screen or about to change.
  $: needTick =
    (showComments && !!feed && feed.comments.some((c) => now - c.at < LIVE_OVERLAY_COMMENT_MS)) ||
    (!!group && now < bannerUntil);
  $: setTicking(needTick);
  function setTicking(on: boolean) {
    if (on && !timer) {
      timer = setInterval(() => (now = Date.now()), 250);
    } else if (!on && timer) {
      clearInterval(timer);
      timer = null;
    }
  }
  onDestroy(() => {
    if (timer) clearInterval(timer);
  });
</script>

{#if feed && (comments.length || zapShown)}
  <div class="live-overlay" class:compact class:reduced={reducedMotion} aria-hidden="true">
    {#if boltsShown && group}
      {#key group.id}
        <div class="bolts" class:ending>
          {#each BOLTS.slice(0, boltCount) as b (b.i)}
            <!-- The lane is as tall as the video, so translateY(100%) is
                 exactly the fall height; only its transform animates. -->
            <span
              class="lane"
              style="left:{b.left}%; width:{b.size}px; animation-delay:{b.delay}s; animation-duration:{b.fall}s; --drift:{b.drift}px;"
            >
              <svg
                class="bolt"
                viewBox="0 0 24 24"
                style="width:{b.size}px; height:{b.size}px; transform: rotate({b.spin}deg);"
              >
                <path d="M13.5 1.5 3.5 13.5h6.8L8.8 22.5 20.5 9.8h-7z" />
              </svg>
            </span>
          {/each}
        </div>
      {/key}
    {/if}

    {#if zapShown && group}
      {#key group.id}
        <div class="zap-banner tier-{group.tier}">{banner}</div>
      {/key}
    {/if}

    {#if comments.length}
      <ul class="comments" style="bottom:{bottom}">
        {#each comments as c (c.id)}
          <li
            class="comment"
            style="animation-delay:-{Math.max(
              0,
              now - c.at
            )}ms; animation-duration:{LIVE_OVERLAY_COMMENT_MS}ms;"
          >
            <Avatar
              pubkey={c.pubkey}
              src={feed.profiles[c.pubkey]?.picture ?? null}
              size={compact ? 20 : 24}
              alt=""
              showRing={false}
              interactive={false}
            />
            <span class="body">
              <strong class="name">{feed.profiles[c.pubkey]?.name ?? ''}</strong>
              <span class="text" dir="auto">{truncateComment(c.text)}</span>
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .live-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
    contain: layout paint;
  }

  /* ── Lightning ── */
  .bolts {
    position: absolute;
    inset: 0;
    transition: opacity 0.6s ease;
  }
  .bolts.ending {
    opacity: 0;
  }
  .lane {
    position: absolute;
    top: 0;
    height: 100%;
    opacity: 0;
    will-change: transform, opacity;
    animation-name: bolt-fall;
    animation-timing-function: cubic-bezier(0.45, 0, 0.8, 0.6);
    animation-iteration-count: infinite;
  }
  .bolt {
    display: block;
    fill: #fbbf24;
    stroke: #b45309;
    stroke-width: 0.6;
  }
  @keyframes bolt-fall {
    0% {
      transform: translate3d(0, -12%, 0);
      opacity: 0;
    }
    10% {
      opacity: 1;
    }
    85% {
      opacity: 1;
    }
    100% {
      transform: translate3d(var(--drift), 100%, 0);
      opacity: 0;
    }
  }

  .zap-banner {
    position: absolute;
    top: max(3rem, 18%);
    left: 50%;
    transform: translateX(-50%);
    max-width: calc(100% - 1.5rem);
    padding: 0.4rem 0.9rem;
    border-radius: 9999px;
    background: rgba(0, 0, 0, 0.7);
    color: #fde68a;
    font-weight: 700;
    font-size: 0.9375rem;
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    box-shadow: 0 0 0 1.5px rgba(251, 191, 36, 0.75);
    animation: banner-in 0.25s ease-out both;
  }
  .zap-banner.tier-large {
    font-size: 1.0625rem;
    box-shadow: 0 0 0 2px #fbbf24;
  }
  @keyframes banner-in {
    from {
      opacity: 0;
      transform: translate(-50%, -6px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }

  /* ── Comments ── */
  .comments {
    position: absolute;
    left: max(0.75rem, env(safe-area-inset-left, 0px));
    right: max(0.75rem, env(safe-area-inset-right, 0px));
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.35rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .comment {
    display: flex;
    align-items: flex-start;
    gap: 0.45rem;
    max-width: min(26rem, 85%);
    padding: 0.3rem 0.65rem 0.3rem 0.3rem;
    border-radius: 0.9rem;
    background: rgba(0, 0, 0, 0.58);
    color: #fff;
    font-size: 0.8125rem;
    line-height: 1.3;
    animation-name: comment-life;
    animation-timing-function: linear;
    animation-fill-mode: both;
  }
  .compact .comment {
    font-size: 0.75rem;
    max-width: 92%;
  }
  .body {
    min-width: 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .name {
    font-weight: 700;
    margin-right: 0.3rem;
    color: #fde68a;
  }
  .name:empty {
    display: none;
  }
  /* In over 0.25 s, hold, out over the last ~0.8 s of the 8 s. */
  @keyframes comment-life {
    0% {
      opacity: 0;
      transform: translateY(6px);
    }
    3% {
      opacity: 1;
      transform: none;
    }
    90% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }

  /* Reduced motion: nothing moves; comments and the banner just appear and go. */
  .reduced .comment,
  .reduced .zap-banner {
    animation: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .comment,
    .zap-banner,
    .lane {
      animation: none;
    }
    .bolts {
      display: none;
    }
  }
</style>
