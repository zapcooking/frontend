<!--
  TimerWidget - Floating draggable timer panel that overlays page content

  Shows active timers in a compact floating panel so users can
  see timers while viewing recipes. Can be dragged anywhere on screen.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import {
    timerStore,
    loadTimers,
    startTimer,
    pauseTimer,
    resumeTimer,
    cancelTimer,
    markTimerDone,
    formatTime,
    getRemainingTime,
    type TimerItem,
  } from '$lib/timerStore';
  import PlayIcon from 'phosphor-svelte/lib/Play';
  import PauseIcon from 'phosphor-svelte/lib/Pause';
  import TrashIcon from 'phosphor-svelte/lib/Trash';
  import PlusIcon from 'phosphor-svelte/lib/Plus';
  import XIcon from 'phosphor-svelte/lib/X';
  import BellIcon from 'phosphor-svelte/lib/Bell';
  import BellSlashIcon from 'phosphor-svelte/lib/BellSlash';
  import DotsSixVerticalIcon from 'phosphor-svelte/lib/DotsSixVertical';

  export let open = false;

  // Timer state from store
  let timers: TimerItem[] = [];

  // Quick add form
  let quickMinutes = 5;
  let quickLabel = '';

  // Sound state
  let soundEnabled = true;
  let audioContext: AudioContext | null = null;

  // Drag state
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let posX = 0;
  let posY = 0;
  let widgetEl: HTMLDivElement;

  // For live countdown updates
  let tickInterval: ReturnType<typeof setInterval> | null = null;
  let tick = 0;

  // Subscribe to store
  const unsubscribe = timerStore.subscribe(state => {
    timers = state.timers;
  });

  onMount(async () => {
    if (browser) {
      await loadTimers();
      startTicking();
      // Load saved position
      const savedPos = localStorage.getItem('timerWidgetPosition');
      if (savedPos) {
        const { x, y } = JSON.parse(savedPos);
        posX = x;
        posY = y;
      }
    }
  });

  onDestroy(() => {
    unsubscribe();
    stopTicking();
  });

  function startTicking() {
    if (tickInterval) return;
    tickInterval = setInterval(() => {
      tick++;
      checkForCompletedTimers();
    }, 250);
  }

  function stopTicking() {
    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
  }

  // Drag handlers
  function handleDragStart(e: MouseEvent | TouchEvent) {
    isDragging = true;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragStartX = clientX - posX;
    dragStartY = clientY - posY;

    if ('touches' in e) {
      document.addEventListener('touchmove', handleDragMove, { passive: false });
      document.addEventListener('touchend', handleDragEnd);
    } else {
      document.addEventListener('mousemove', handleDragMove);
      document.addEventListener('mouseup', handleDragEnd);
    }
  }

  function handleDragMove(e: MouseEvent | TouchEvent) {
    if (!isDragging) return;
    e.preventDefault();

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    let newX = clientX - dragStartX;
    let newY = clientY - dragStartY;

    // Keep widget within viewport bounds
    if (browser && widgetEl) {
      const rect = widgetEl.getBoundingClientRect();
      const maxX = window.innerWidth - rect.width;
      const maxY = window.innerHeight - rect.height;
      newX = Math.max(0, Math.min(newX, maxX));
      newY = Math.max(0, Math.min(newY, maxY));
    }

    posX = newX;
    posY = newY;
  }

  function handleDragEnd() {
    isDragging = false;
    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mouseup', handleDragEnd);
    document.removeEventListener('touchmove', handleDragMove);
    document.removeEventListener('touchend', handleDragEnd);

    // Save position
    if (browser) {
      localStorage.setItem('timerWidgetPosition', JSON.stringify({ x: posX, y: posY }));
    }
  }

  // Initialize audio context
  function initAudio() {
    if (!audioContext && browser) {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }

  // Play kitchen timer ding
  function playTimerDing() {
    if (!audioContext || !soundEnabled) return;

    const now = audioContext.currentTime;
    const fundamentalFreq = 2200;
    const harmonics = [1, 2.0, 3.0];

    harmonics.forEach((harmonic, i) => {
      const osc = audioContext!.createOscillator();
      const gain = audioContext!.createGain();

      osc.type = 'sine';
      osc.frequency.value = fundamentalFreq * harmonic;

      const volume = 0.4 / (i + 1);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

      osc.connect(gain);
      gain.connect(audioContext!.destination);

      osc.start(now);
      osc.stop(now + 0.6);
    });
  }

  function checkForCompletedTimers() {
    const now = Date.now();
    timers.forEach(timer => {
      if (timer.status === 'running' && now >= timer.endsAt) {
        markTimerDone(timer.id);
        if (soundEnabled) {
          initAudio();
          playTimerDing();
        }
      }
    });
  }

  async function handleQuickAdd() {
    if (quickMinutes <= 0) return;
    const durationMs = quickMinutes * 60 * 1000;
    const label = quickLabel.trim() || `${quickMinutes} min`;
    await startTimer(label, durationMs);
    quickLabel = '';
  }

  async function handlePauseResume(timer: TimerItem) {
    if (timer.status === 'running') {
      await pauseTimer(timer.id);
    } else if (timer.status === 'paused') {
      await resumeTimer(timer.id);
    }
  }

  async function handleDelete(timer: TimerItem) {
    await cancelTimer(timer.id);
  }

  function toggleSound() {
    initAudio();
    soundEnabled = !soundEnabled;
  }

  function getDisplayTime(timer: TimerItem, _tick: number): string {
    return formatTime(getRemainingTime(timer));
  }

  $: activeTimers = timers.filter(t => t.status === 'running' || t.status === 'paused');
  $: completedTimers = timers.filter(t => t.status === 'done');

  // Compute style for position
  $: widgetStyle = posX || posY
    ? `left: ${posX}px; top: ${posY}px; right: auto;`
    : '';
</script>

{#if open}
  <div
    class="timer-widget"
    class:dragging={isDragging}
    style={widgetStyle}
    bind:this={widgetEl}
  >
    <!-- Drag handle + Header -->
    <div
      class="widget-header"
      on:mousedown={handleDragStart}
      on:touchstart={handleDragStart}
      role="button"
      tabindex="0"
      aria-label="Drag to move"
    >
      <div class="drag-handle">
        <DotsSixVerticalIcon size={16} />
      </div>
      <span class="widget-title">Timers</span>
      <div class="header-actions">
        <button
          on:click|stopPropagation={toggleSound}
          class="sound-btn {soundEnabled ? 'sound-on' : 'sound-off'}"
          aria-label={soundEnabled ? 'Mute' : 'Unmute'}
        >
          {#if soundEnabled}
            <BellIcon size={16} weight="fill" />
          {:else}
            <BellSlashIcon size={16} />
          {/if}
        </button>
        <button on:click|stopPropagation={() => open = false} class="close-btn" aria-label="Close">
          <XIcon size={18} />
        </button>
      </div>
    </div>

    <!-- Quick add -->
    <div class="quick-add">
      <input
        type="text"
        bind:value={quickLabel}
        placeholder="Label"
        class="quick-label"
        on:keydown={(e) => e.key === 'Enter' && handleQuickAdd()}
      />
      <input
        type="number"
        bind:value={quickMinutes}
        min="1"
        max="999"
        class="quick-minutes"
      />
      <span class="min-label">min</span>
      <button on:click={handleQuickAdd} class="add-btn" aria-label="Add timer">
        <PlusIcon size={18} weight="bold" />
      </button>
    </div>

    <!-- Active timers -->
    {#if activeTimers.length > 0}
      <div class="timers-list">
        {#each activeTimers as timer (timer.id)}
          {@const remaining = getRemainingTime(timer)}
          {@const progress = timer.status === 'running'
            ? (1 - remaining / timer.durationMs) * 100
            : (1 - (timer.pausedRemainingMs || 0) / timer.durationMs) * 100}
          <div class="timer-item">
            <div class="timer-progress" style="width: {progress}%"></div>
            <div class="timer-content">
              <div class="timer-info">
                <span class="timer-label">{timer.label}</span>
                <span class="timer-time {timer.status === 'paused' ? 'paused' : ''}">
                  {getDisplayTime(timer, tick)}
                </span>
              </div>
              <div class="timer-actions">
                <button on:click={() => handlePauseResume(timer)} class="action-btn">
                  {#if timer.status === 'running'}
                    <PauseIcon size={16} />
                  {:else}
                    <PlayIcon size={16} />
                  {/if}
                </button>
                <button on:click={() => handleDelete(timer)} class="action-btn delete">
                  <TrashIcon size={16} />
                </button>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty-state">
        No active timers
      </div>
    {/if}

    <!-- Completed (if any) -->
    {#if completedTimers.length > 0}
      <div class="completed-section">
        <span class="completed-label">Done ({completedTimers.length})</span>
        {#each completedTimers as timer (timer.id)}
          <div class="completed-item">
            <span>{timer.label}</span>
            <button on:click={() => handleDelete(timer)} class="action-btn delete small">
              <TrashIcon size={14} />
            </button>
          </div>
        {/each}
      </div>
    {/if}

    <!-- Presets -->
    <div class="presets">
      {#each [1, 3, 5, 10, 15] as mins}
        <button
          on:click={() => startTimer(`${mins} min`, mins * 60 * 1000)}
          class="preset-btn"
        >
          {mins}m
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .timer-widget {
    position: fixed;
    top: 60px;
    right: 16px;
    width: 340px;
    max-height: calc(100vh - 80px);
    overflow-y: auto;
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    z-index: 50;
    padding: 12px;
    transition: box-shadow 0.2s;
  }

  .timer-widget.dragging {
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
    cursor: grabbing;
    user-select: none;
  }

  .widget-header {
    display: flex;
    align-items: center;
    margin-bottom: 12px;
    cursor: grab;
    user-select: none;
  }

  .widget-header:active {
    cursor: grabbing;
  }

  .drag-handle {
    color: var(--color-text-caption);
    opacity: 0.5;
    margin-right: 4px;
    display: flex;
    align-items: center;
  }

  .widget-title {
    font-weight: 600;
    color: var(--color-text-primary);
    flex: 1;
  }

  .header-actions {
    display: flex;
    gap: 4px;
  }

  .sound-btn, .close-btn {
    padding: 4px;
    border-radius: 6px;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--color-text-caption);
    transition: all 0.2s;
  }

  .sound-btn:hover, .close-btn:hover {
    background: var(--color-input-border);
  }

  .sound-btn.sound-on {
    color: #f59e0b;
  }

  .sound-btn.sound-off {
    color: var(--color-text-caption);
    opacity: 0.5;
  }

  .quick-add {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 12px;
  }

  .quick-label {
    flex: 1;
    min-width: 0;
    padding: 8px 10px;
    border: 1px solid var(--color-input-border);
    border-radius: 6px;
    background: var(--color-input-bg);
    color: var(--color-text-primary);
    font-size: 14px;
  }

  .quick-minutes {
    width: 60px;
    padding: 8px 10px;
    border: 1px solid var(--color-input-border);
    border-radius: 6px;
    background: var(--color-input-bg);
    color: var(--color-text-primary);
    font-size: 14px;
    text-align: center;
  }

  .min-label {
    color: var(--color-text-caption);
    font-size: 13px;
    flex-shrink: 0;
  }

  .add-btn {
    padding: 8px;
    border-radius: 6px;
    background: var(--color-primary);
    border: none;
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .add-btn:hover {
    opacity: 0.9;
  }

  .timers-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 12px;
  }

  .timer-item {
    position: relative;
    border: 1px solid var(--color-input-border);
    border-radius: 8px;
    overflow: hidden;
  }

  .timer-progress {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    background: color-mix(in srgb, var(--color-primary) 15%, transparent);
    transition: width 0.3s ease;
  }

  .timer-content {
    position: relative;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px;
  }

  .timer-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .timer-label {
    font-size: 12px;
    color: var(--color-text-caption);
  }

  .timer-time {
    font-size: 24px;
    font-weight: 700;
    font-family: ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
    color: var(--color-text-primary);
  }

  .timer-time.paused {
    color: #f59e0b;
  }

  .timer-actions {
    display: flex;
    gap: 6px;
  }

  .action-btn {
    padding: 8px;
    border-radius: 6px;
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
    cursor: pointer;
    color: var(--color-text-primary);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .action-btn:hover {
    background: var(--color-input-border);
  }

  .action-btn.delete:hover {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.3);
    color: #ef4444;
  }

  .action-btn.small {
    padding: 4px;
  }

  .empty-state {
    text-align: center;
    padding: 20px;
    color: var(--color-text-caption);
    font-size: 14px;
  }

  .completed-section {
    border-top: 1px solid var(--color-input-border);
    padding-top: 10px;
    margin-bottom: 10px;
  }

  .completed-label {
    font-size: 11px;
    color: var(--color-text-caption);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .completed-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 0;
    font-size: 13px;
    color: var(--color-text-caption);
  }

  .presets {
    display: flex;
    gap: 8px;
    border-top: 1px solid var(--color-input-border);
    padding-top: 12px;
  }

  .preset-btn {
    flex: 1;
    padding: 8px 6px;
    border: 1px solid var(--color-input-border);
    border-radius: 6px;
    background: transparent;
    color: var(--color-text-primary);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .preset-btn:hover {
    background: var(--color-input-border);
  }

  /* Mobile adjustments */
  @media (max-width: 640px) {
    .timer-widget {
      right: 8px;
      left: 8px;
      width: auto;
      max-width: none;
    }
  }
</style>
