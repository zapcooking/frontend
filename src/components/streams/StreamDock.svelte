<script lang="ts">
  /**
   * The persistent player host, mounted once in the root layout.
   *
   * The `<video>` engine in `container` is created once per page load and
   * never destroyed by navigation: while `/live/[naddr]` is open its slot
   * is registered in the `streamSlot` store and the container moves into
   * it (full-width page player); on navigation away the slot is cleared and
   * the container moves back into the floating corner mini player, still
   * playing. Moving a node within the document does not interrupt playback
   * or close picture-in-picture — which is exactly the point.
   */
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import { prefersReducedMotion } from '$lib/motion';
  import { streamPlayer, stopStream } from '$lib/stores/streamPlayer';
  import { streamSlot } from '$lib/stores/streamSlot';
  import { streamAddress, naddrEncode } from '$lib/streams/parse';
  import StreamEngine from './StreamEngine.svelte';
  import XIcon from 'phosphor-svelte/lib/X';

  // transitions.dev recipe curve for the dock/embed handoff.
  const DOCK_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
  const DOCK_MS = 280;
  let flipToken = 0;

  let container: HTMLElement | null = null;
  let dockWrapper: HTMLElement | null = null;
  let miniSlot: HTMLElement | null = null;

  // ── Drag to reposition ────────────────────────────────────────────────
  // The mini player starts in a CSS corner. Dragging it (by anything that is
  // not a button) pins it to a viewport position instead, clamped on screen
  // and remembered. A small movement threshold keeps taps on the video
  // working as play/pause.
  const POS_KEY = 'zc.streamDock.pos';
  const DRAG_THRESHOLD_PX = 8;
  const EDGE_PX = 8;
  let pos: { x: number; y: number } | null = null;
  let dragging = false;
  let drag: {
    id: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null = null;
  let swallowClick = false;

  const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), Math.max(lo, hi));

  function clampToViewport(x: number, y: number) {
    const rect = dockWrapper?.getBoundingClientRect();
    const w = rect?.width ?? 0;
    const h = rect?.height ?? 0;
    return {
      x: clamp(x, EDGE_PX, window.innerWidth - w - EDGE_PX),
      y: clamp(y, EDGE_PX, window.innerHeight - h - EDGE_PX)
    };
  }

  function onDragStart(event: PointerEvent) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // Buttons keep their own behavior (expand, stop, mute, PiP, full screen…)
    // — except the title, which fills the header bar and is where a drag
    // naturally starts. A drag from it never counts as its click.
    const control = (event.target as HTMLElement | null)?.closest('button, a, input, textarea');
    if (control && !control.hasAttribute('data-drag-handle')) return;
    const rect = dockWrapper?.getBoundingClientRect();
    if (!rect) return;
    drag = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      moved: false
    };
    // Move/up are listened for on the window for the length of the drag: a
    // quick mouse drag outruns the dock, so its first pointermove would
    // otherwise land on whatever is beside it and never arrive. (Capturing
    // the pointer instead would retarget clicks away from the buttons
    // inside the dock.)
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragEnd);
  }

  function onDragMove(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      dragging = true;
    }
    pos = clampToViewport(drag.originX + dx, drag.originY + dy);
  }

  function stopDragListening() {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragEnd);
  }

  function onDragEnd(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.id) return;
    stopDragListening();
    if (drag.moved) {
      swallowClick = true; // the click that ends a drag is not a tap
      setTimeout(() => (swallowClick = false), 0);
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(pos));
      } catch {
        // Private mode / full storage: the position just is not remembered.
      }
    }
    drag = null;
    dragging = false;
  }

  function onClickCapture(event: MouseEvent) {
    if (!swallowClick) return;
    event.stopPropagation();
    event.preventDefault();
    swallowClick = false;
  }

  /** Keep a pinned position on screen across resize / rotation / dock size changes. */
  function reclamp() {
    if (!pos || !dockWrapper) return;
    const next = clampToViewport(pos.x, pos.y);
    if (next.x !== pos.x || next.y !== pos.y) pos = next;
  }

  onMount(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) pos = saved;
    } catch {
      // Unreadable value: keep the default corner.
    }
    window.addEventListener('resize', reclamp);
    return () => {
      window.removeEventListener('resize', reclamp);
      stopDragListening();
    };
  });

  // The wrapper is hidden until a stream plays; clamp once it has a size.
  $: if (browser && pos && dockWrapper && $streamPlayer.item && !slotted && playing) {
    tick().then(reclamp);
  }

  $: playing = browser && !!$streamPlayer.item && $streamPlayer.surface === 'dock';
  // Slotted while the stream page's slot exists; floating corner otherwise.
  $: slotted = playing && !!$streamSlot && $streamSlot.isConnected;

  $: if (browser && container && dockWrapper && miniSlot) {
    place(container, slotted, playing);
  }

  /**
   * Move the engine container between the page slot and the corner, then
   * FLIP-animate the handoff: because it is the same DOM node, we invert the
   * transform from the old rect and glide to identity — playback and PiP
   * never notice. First appearances (no old rect) get the recipe's fade +
   * rise instead. Skipped entirely under reduced motion.
   */
  async function place(node: HTMLElement, intoSlot: boolean, isPlaying: boolean) {
    const first = node.getBoundingClientRect();
    const wasVisible = first.width > 0 && first.height > 0;
    await tick(); // let the page's slot (or its removal) settle first

    if (!intoSlot) {
      // Back to the corner. Also recovers the node from a slot that has
      // since been detached from the document.
      if (miniSlot && node.parentElement !== miniSlot) miniSlot.replaceChildren(node);
      node.classList.toggle('hidden', !isPlaying);
    } else {
      const slot = $streamSlot;
      if (slot && slot.isConnected) {
        if (node.parentElement !== slot) slot.replaceChildren(node);
        node.classList.remove('hidden');
      } else if (miniSlot) {
        // Slot announced but not yet in the document: stay put this round.
        if (node.parentElement !== miniSlot) miniSlot.replaceChildren(node);
        node.classList.toggle('hidden', !isPlaying);
      }
    }

    const last = node.getBoundingClientRect();
    if (prefersReducedMotion() || !isPlaying || !(last.width > 0 && last.height > 0)) {
      return;
    }

    const token = ++flipToken;
    const cleanup = () => {
      if (token !== flipToken) return;
      node.style.transition = '';
      node.style.transform = '';
      node.style.transformOrigin = '';
      node.style.opacity = '';
      node.style.willChange = '';
      node.removeEventListener('transitionend', onEnd);
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.target === node && e.propertyName === 'transform') cleanup();
    };
    node.addEventListener('transitionend', onEnd);

    node.style.willChange = 'transform, opacity';
    node.style.transformOrigin = 'top left';
    if (wasVisible) {
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      const scale = first.width / last.width;
      node.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
      void node.getBoundingClientRect(); // flush before playing
      node.style.transition = `transform ${DOCK_MS}ms ${DOCK_EASE}`;
      node.style.transform = 'translate(0, 0) scale(1)';
    } else {
      node.style.opacity = '0';
      node.style.transform = 'translateY(12px) scale(0.96)';
      void node.getBoundingClientRect();
      node.style.transition = `transform ${DOCK_MS}ms ${DOCK_EASE}, opacity ${DOCK_MS}ms ${DOCK_EASE}`;
      node.style.opacity = '1';
      node.style.transform = 'translate(0, 0) scale(1)';
    }
    setTimeout(cleanup, DOCK_MS + 80);
  }

  function openStreamPage() {
    const item = $streamPlayer.item;
    if (!item) return;
    const address = streamAddress(item);
    if (!address) return;
    try {
      const path = `/live/${naddrEncode(address)}`;
      if ($page.url.pathname === path) {
        // Already on the stream page: the inline player was docked by
        // scroll, so ask the page to take the video back.
        window.dispatchEvent(new CustomEvent('stream-player-restore'));
        return;
      }
      goto(path);
    } catch {
      // An address that cannot encode as an naddr just stays in the corner.
    }
  }
</script>

{#if browser}
  <!-- Floating corner the container returns to when no page slot holds it.
       Wide screens dock it bottom-left, away from the page's right-side rail. -->
  <!-- Pointer drag + a capture-phase click guard; every control inside stays a real button. -->
  <!-- svelte-ignore a11y-no-static-element-interactions a11y-click-events-have-key-events -->
  <div
    bind:this={dockWrapper}
    class="fixed bottom-20 right-3 z-40 w-72 sm:bottom-6 sm:right-6 sm:w-80 xl:bottom-6 xl:left-6 xl:right-auto {$streamPlayer.item &&
    !slotted &&
    playing
      ? 'block'
      : 'hidden'} {dragging ? 'cursor-grabbing select-none' : ''}"
    style="touch-action: none;{pos
      ? ` left:${pos.x}px; top:${pos.y}px; right:auto; bottom:auto;`
      : ''}"
    on:pointerdown={onDragStart}
    on:click|capture={onClickCapture}
  >
    {#if $streamPlayer.item && !slotted && playing}
      <div
        class="flex cursor-grab items-center justify-between gap-2 rounded-t-xl bg-black/90 px-2 py-1.5 active:cursor-grabbing"
        title="Drag to move"
      >
        <button
          type="button"
          class="min-w-0 flex-1 truncate text-left text-xs font-medium text-white hover:underline"
          data-drag-handle
          on:click={openStreamPage}
          title={$streamPlayer.item.title}
        >
          {$streamPlayer.item.title}
        </button>
        <div class="flex shrink-0 items-center gap-1">
          <button
            type="button"
            class="rounded p-1 text-zinc-300 hover:bg-white/10 hover:text-white"
            aria-label="Expand player"
            title="Expand player"
            on:click={openStreamPage}
          >
            <svg
              class="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
          </button>
          <button
            type="button"
            class="rounded p-1 text-zinc-300 hover:bg-white/10 hover:text-white"
            aria-label="Stop playback"
            title="Stop playback"
            on:click={stopStream}
          >
            <XIcon class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    {/if}
    <div
      bind:this={miniSlot}
      class={$streamPlayer.item && !slotted && playing ? '' : 'hidden'}
    ></div>
  </div>

  <!-- The one engine container. Created hidden; `place()` moves it between
       the mini corner and the stream page's slot without ever unmounting it. -->
  <div bind:this={container} class="hidden">
    <StreamEngine surface="dock" />
  </div>
{/if}
