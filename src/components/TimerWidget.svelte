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
    type TimerItem
  } from '$lib/timerStore';
  import {
    timerSettings,
    loadTimerSettings,
    updateTimerSetting,
    saveTimerSettings
  } from '$lib/timerSettings';
  import PlayIcon from 'phosphor-svelte/lib/Play';
  import PauseIcon from 'phosphor-svelte/lib/Pause';
  import TrashIcon from 'phosphor-svelte/lib/Trash';
  import PlusIcon from 'phosphor-svelte/lib/Plus';
  import XIcon from 'phosphor-svelte/lib/X';
  import BellIcon from 'phosphor-svelte/lib/Bell';
  import BellSlashIcon from 'phosphor-svelte/lib/BellSlash';
  import DotsSixVerticalIcon from 'phosphor-svelte/lib/DotsSixVertical';
  import CaretUpIcon from 'phosphor-svelte/lib/CaretUp';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';

  export let open = false;

  // Mobile detection and minimize state
  let isMobile = false;
  let isMinimized = false;

  // Timer state from store
  let timers: TimerItem[] = [];

  // Quick add form
  let quickMinutes = 5;
  let quickLabel = '';

  // Sound state (from settings store)
  let soundEnabled = true;
  let audioContext: AudioContext | null = null;

  // Drag state
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let posX: number | null = null;
  let posY: number | null = null;
  let widgetEl: HTMLDivElement;

  // For live countdown updates
  let tickInterval: ReturnType<typeof setInterval> | null = null;
  let tick = 0;

  let resizeObserver: ResizeObserver | null = null;
  let isObservingOffset = false;

  // Subscribe to timer store
  const unsubscribe = timerStore.subscribe((state) => {
    timers = state.timers;
  });

  // Subscribe to settings store - only for sound, position handled separately
  const unsubscribeSettings = timerSettings.subscribe((settings) => {
    soundEnabled = settings.soundEnabled;
  });

  onMount(async () => {
    if (browser) {
      await loadTimers();
      const settings = await loadTimerSettings();

      // Detect mobile/tablet (use mobile layout when bottom nav is visible)
      isMobile = window.innerWidth < 1024;

      // Load position from settings once on mount, clamped to viewport
      if (settings.positionX !== null && settings.positionY !== null) {
        // Clamp to viewport bounds (use reasonable defaults for widget size if not yet rendered)
        const widgetWidth = 380;
        const widgetHeight = 400;
        const maxX = window.innerWidth - widgetWidth;
        const maxY = window.innerHeight - widgetHeight;

        posX = Math.max(0, Math.min(settings.positionX, maxX));
        posY = Math.max(0, Math.min(settings.positionY, maxY));
      }

      startTicking();
      window.addEventListener('resize', handleResize);
    }
  });

  function handleResize() {
    const wasMobile = isMobile;
    isMobile = window.innerWidth < 1024;

    // Handle transition between mobile and desktop
    if (wasMobile !== isMobile && widgetEl) {
      // Clear all inline styles when switching modes so CSS can take over
      widgetEl.style.left = '';
      widgetEl.style.top = '';
      widgetEl.style.right = '';
      widgetEl.style.transform = '';

      // Switching to desktop - if we have a saved position and not minimized, apply it
      if (!isMobile && !isMinimized && posX !== null && posY !== null) {
        // Clamp to new viewport bounds
        const maxX = window.innerWidth - widgetEl.offsetWidth;
        const maxY = window.innerHeight - widgetEl.offsetHeight;
        posX = Math.max(0, Math.min(posX, maxX));
        posY = Math.max(0, Math.min(posY, maxY));

        widgetEl.style.left = `${posX}px`;
        widgetEl.style.top = `${posY}px`;
        widgetEl.style.right = 'auto';
      }
    } else if (!isMobile && !isMinimized && posX !== null && posY !== null && widgetEl) {
      // Desktop resize without mode change - ensure position stays in bounds
      const maxX = window.innerWidth - widgetEl.offsetWidth;
      const maxY = window.innerHeight - widgetEl.offsetHeight;

      let needsUpdate = false;
      if (posX > maxX) {
        posX = Math.max(0, maxX);
        needsUpdate = true;
      }
      if (posY > maxY) {
        posY = Math.max(0, maxY);
        needsUpdate = true;
      }

      if (needsUpdate) {
        widgetEl.style.left = `${posX}px`;
        widgetEl.style.top = `${posY}px`;
      }
    }
  }

  onDestroy(() => {
    unsubscribe();
    unsubscribeSettings();
    stopTicking();
    teardownMobileOffsetObserver();
    if (browser) {
      window.removeEventListener('resize', handleResize);
    }
  });

  function setMobileOffset(value: number | null) {
    if (!browser) return;
    const root = document.documentElement;
    if (value === null) {
      root.style.removeProperty('--timer-widget-offset');
      return;
    }
    root.style.setProperty('--timer-widget-offset', `${value}px`);
  }

  function updateMobileOffset() {
    if (!browser || !widgetEl) return;
    const height = widgetEl.offsetHeight;
    if (height > 0) {
      setMobileOffset(height);
    }
  }

  function setupMobileOffsetObserver() {
    if (!browser || !widgetEl) return;
    updateMobileOffset();
    if (typeof ResizeObserver === 'undefined') return;
    if (!resizeObserver) {
      resizeObserver = new ResizeObserver(() => updateMobileOffset());
    }
    if (!isObservingOffset) {
      resizeObserver.observe(widgetEl);
      isObservingOffset = true;
    }
  }

  function teardownMobileOffsetObserver() {
    if (resizeObserver && isObservingOffset) {
      resizeObserver.disconnect();
      isObservingOffset = false;
    }
    setMobileOffset(null);
  }

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

    // Initialize position from current element position if not set
    if (posX === null || posY === null) {
      const rect = widgetEl.getBoundingClientRect();
      posX = rect.left;
      posY = rect.top;
    }

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
    if (!isDragging || !widgetEl) return;
    e.preventDefault();

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    let newX = clientX - dragStartX;
    let newY = clientY - dragStartY;

    // Keep widget within viewport bounds
    if (browser) {
      const maxX = window.innerWidth - widgetEl.offsetWidth;
      const maxY = window.innerHeight - widgetEl.offsetHeight;
      newX = Math.max(0, Math.min(newX, maxX));
      newY = Math.max(0, Math.min(newY, maxY));
    }

    posX = newX;
    posY = newY;

    // Apply position directly during drag for smooth movement
    widgetEl.style.left = `${newX}px`;
    widgetEl.style.top = `${newY}px`;
    widgetEl.style.right = 'auto';
  }

  function handleDragEnd() {
    isDragging = false;
    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mouseup', handleDragEnd);
    document.removeEventListener('touchmove', handleDragMove);
    document.removeEventListener('touchend', handleDragEnd);

    // Save position to settings (syncs to relay if logged in)
    if (browser && posX !== null && posY !== null) {
      saveTimerSettings({
        soundEnabled,
        positionX: posX,
        positionY: posY
      });
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
    timers.forEach((timer) => {
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
    const newValue = !soundEnabled;
    soundEnabled = newValue;
    updateTimerSetting('soundEnabled', newValue);
  }

  function toggleMinimize() {
    const wasMinimized = isMinimized;
    isMinimized = !isMinimized;

    if (widgetEl) {
      if (isMinimized) {
        // Minimizing: clear inline styles so CSS can dock to bottom
        widgetEl.style.left = '';
        widgetEl.style.top = '';
        widgetEl.style.right = '';
        widgetEl.style.transform = '';
      } else {
        // Un-minimizing: restore position
        widgetEl.style.transform = '';
        if (posX !== null && posY !== null && !isMobile) {
          widgetEl.style.left = `${posX}px`;
          widgetEl.style.top = `${posY}px`;
          widgetEl.style.right = 'auto';
        }
      }
    }
  }

  function getDisplayTime(timer: TimerItem, _tick: number): string {
    return formatTime(getRemainingTime(timer));
  }

  $: activeTimers = timers.filter((t) => t.status === 'running' || t.status === 'paused');
  $: completedTimers = timers.filter((t) => t.status === 'done');

  // Apply position via DOM when values change (not during drag - drag handles its own updates)
  $: if (browser && widgetEl && !isDragging && !isMinimized && !isMobile) {
    if (posX !== null && posY !== null) {
      widgetEl.style.left = `${posX}px`;
      widgetEl.style.top = `${posY}px`;
      widgetEl.style.right = 'auto';
    } else {
      // No saved position - clear any inline styles so CSS defaults apply
      widgetEl.style.left = '';
      widgetEl.style.top = '';
      widgetEl.style.right = '';
    }
  }

  $: if (browser) {
    if (open && isMobile && widgetEl) {
      setupMobileOffsetObserver();
    } else {
      teardownMobileOffsetObserver();
    }
  }
</script>

{#if open}
  <div
    class="timer-widget {isMobile ? 'mobile' : 'desktop'}"
    class:dragging={isDragging}
    class:minimized={isMinimized}
    bind:this={widgetEl}
  >
    <!-- Header -->
    <div
      class="widget-header"
      on:mousedown={!isMobile && !isMinimized ? handleDragStart : undefined}
      on:touchstart={!isMobile && !isMinimized ? handleDragStart : undefined}
      role="button"
      tabindex="0"
      aria-label={isMobile ? 'Timer controls' : isMinimized ? 'Timer docked' : 'Drag to move'}
    >
      {#if !isMobile && !isMinimized}
        <div class="drag-handle">
          <DotsSixVerticalIcon size={16} />
        </div>
      {/if}
      <span class="widget-title">Timers</span>
      {#if activeTimers.length > 0 && isMinimized}
        <span class="minimized-time">
          {getDisplayTime(activeTimers[0], tick)}
        </span>
      {/if}
      <div class="header-actions">
        <button
          on:click|stopPropagation={toggleMinimize}
          class="minimize-btn"
          aria-label={isMinimized ? 'Expand' : 'Minimize'}
        >
          {#if isMinimized}
            <CaretUpIcon size={18} />
          {:else}
            <CaretDownIcon size={18} />
          {/if}
        </button>
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
        <button
          on:click|stopPropagation={() => (open = false)}
          class="close-btn"
          aria-label="Close"
        >
          <XIcon size={18} />
        </button>
      </div>
    </div>

    <!-- Content (hidden when minimized) -->
    {#if !isMinimized}
      <!-- Quick add -->
      <div class="quick-add">
        <input
          type="text"
          bind:value={quickLabel}
          placeholder="Label"
          class="quick-label"
          on:keydown={(e) => e.key === 'Enter' && handleQuickAdd()}
        />
        <input type="number" bind:value={quickMinutes} min="1" max="999" class="quick-minutes" />
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
            {@const progress =
              timer.status === 'running'
                ? (1 - remaining / timer.durationMs) * 100
                : (1 - (timer.pausedRemainingMs || 0) / timer.durationMs) * 100}
            <div class="timer-item">
              <div class="timer-progress" style="width: {progress}%"></div>
              <div class="timer-content">
                <span class="timer-label">{timer.label}</span>
                <div class="timer-main-row">
                  <span class="timer-time-large {timer.status === 'paused' ? 'paused' : ''}">
                    {getDisplayTime(timer, tick)}
                  </span>
                  <div class="timer-actions">
                    <button on:click={() => handlePauseResume(timer)} class="action-btn">
                      {#if timer.status === 'running'}
                        <PauseIcon size={20} />
                      {:else}
                        <PlayIcon size={20} />
                      {/if}
                    </button>
                    <button on:click={() => handleDelete(timer)} class="action-btn delete">
                      <TrashIcon size={20} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <div class="empty-state">No active timers</div>
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

      <!-- Quick time presets -->
      <div class="time-presets">
        {#each [1, 3, 5, 10, 15, 30] as mins}
          <button
            on:click={() => startTimer(`${mins} min`, mins * 60 * 1000)}
            class="time-preset-btn"
          >
            {mins}m
          </button>
        {/each}
      </div>

      <!-- Fun Cooking Presets -->
      <div class="presets-section">
        <span class="presets-label">Cooking Presets</span>
        <div class="preset-grid">
          <button on:click={() => startTimer('Poached Egg', 4 * 60 * 1000)} class="preset-btn egg">
            <span class="preset-emoji">🥚</span>
            <span class="preset-name">Poached</span>
            <span class="preset-time">4 min</span>
          </button>
          <button
            on:click={() => startTimer('Hard Boiled Egg', 10 * 60 * 1000)}
            class="preset-btn egg"
          >
            <span class="preset-emoji">🥚</span>
            <span class="preset-name">Hard Boiled</span>
            <span class="preset-time">10 min</span>
          </button>
          <button
            on:click={() => startTimer('Pasta Al Dente', 8 * 60 * 1000)}
            class="preset-btn pasta"
          >
            <span class="preset-emoji">🍝</span>
            <span class="preset-name">Pasta</span>
            <span class="preset-time">8 min</span>
          </button>
          <button on:click={() => startTimer('Rice', 18 * 60 * 1000)} class="preset-btn grain">
            <span class="preset-emoji">🍚</span>
            <span class="preset-name">Rice</span>
            <span class="preset-time">18 min</span>
          </button>
          <button on:click={() => startTimer('Steak Rest', 5 * 60 * 1000)} class="preset-btn meat">
            <span class="preset-emoji">🥩</span>
            <span class="preset-name">Steak Rest</span>
            <span class="preset-time">5 min</span>
          </button>
          <button
            on:click={() => startTimer('Veggies Steam', 7 * 60 * 1000)}
            class="preset-btn veg"
          >
            <span class="preset-emoji">🥦</span>
            <span class="preset-name">Steam Veg</span>
            <span class="preset-time">7 min</span>
          </button>
          <button on:click={() => startTimer('Casserole', 45 * 60 * 1000)} class="preset-btn veg">
            <span class="preset-emoji">🥘</span>
            <span class="preset-name">Casserole</span>
            <span class="preset-time">45 min</span>
          </button>
          <button
            on:click={() => startTimer('Baked Potato', 60 * 60 * 1000)}
            class="preset-btn veg"
          >
            <span class="preset-emoji">🥔</span>
            <span class="preset-name">Baked Potato</span>
            <span class="preset-time">60 min</span>
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .timer-widget {
    position: fixed;
    top: 60px;
    right: 16px;
    width: 380px;
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

  .sound-btn,
  .close-btn {
    padding: 4px;
    border-radius: 6px;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--color-text-caption);
    transition: all 0.2s;
  }

  .sound-btn:hover,
  .close-btn:hover {
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
    flex-direction: column;
    padding: 12px 14px;
  }

  .timer-label {
    font-size: 13px;
    color: var(--color-text-caption);
    margin-bottom: 4px;
  }

  .timer-main-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .timer-time-large {
    font-size: 48px;
    font-weight: 700;
    font-family: 'Orbitron', ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
    color: var(--color-text-primary);
    line-height: 1;
    letter-spacing: 2px;
  }

  .timer-time-large.paused {
    color: #f59e0b;
  }

  .minimized-time {
    font-size: 20px;
    font-weight: 700;
    font-family: 'Orbitron', ui-monospace, monospace;
    color: var(--color-text-primary);
    margin-left: auto;
    margin-right: 8px;
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

  .time-presets {
    display: flex !important;
    flex-direction: row !important;
    flex-wrap: wrap !important;
    gap: 6px !important;
    margin-bottom: 12px;
    border-top: 1px solid var(--color-input-border);
    padding-top: 12px;
  }

  .time-preset-btn {
    flex: 1 1 auto !important;
    min-width: 45px !important;
    padding: 8px 4px !important;
    border: 1px solid var(--color-input-border) !important;
    border-radius: 6px;
    background: transparent;
    color: var(--color-text-primary);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    text-align: center;
  }

  .time-preset-btn:hover {
    background: var(--color-input-border);
  }

  .presets-section {
    border-top: 1px solid var(--color-input-border);
    padding-top: 12px;
  }

  .presets-label {
    font-size: 11px;
    color: var(--color-text-caption);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    display: block;
    margin-bottom: 8px;
  }

  .preset-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }

  .preset-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 10px 6px;
    border: 1px solid var(--color-input-border);
    border-radius: 8px;
    background: transparent;
    color: var(--color-text-primary);
    cursor: pointer;
    transition: all 0.2s;
    min-height: 70px;
  }

  .preset-btn:hover {
    background: var(--color-input-border);
    transform: scale(1.02);
  }

  .preset-emoji {
    font-size: 24px;
    line-height: 1;
    margin-bottom: 4px;
  }

  .preset-name {
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
    text-align: center;
  }

  .preset-time {
    font-size: 9px;
    color: var(--color-text-caption);
  }

  /* Mobile styles - bottom-locked widget */
  .timer-widget.mobile {
    top: auto;
    bottom: calc(56px + env(safe-area-inset-bottom, 0px)); /* Sit directly on bottom nav */
    left: 0;
    right: 0;
    width: 100%;
    max-width: 100%;
    border-radius: 16px 16px 0 0;
    max-height: 70vh;
  }

  .timer-widget.mobile.minimized {
    max-height: none;
    overflow: hidden;
  }

  /* Desktop minimized - docked to bottom (use !important to override inline drag styles) */
  .timer-widget.desktop.minimized {
    top: auto !important;
    bottom: calc(56px + env(safe-area-inset-bottom, 0px) + 8px) !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    right: auto !important;
    width: auto;
    min-width: 300px;
    max-height: none;
    overflow: hidden;
    border-radius: 12px;
  }

  /* On larger screens without bottom nav, position closer to bottom */
  @media (min-width: 1024px) {
    .timer-widget.desktop.minimized {
      bottom: 16px !important;
    }
  }

  .timer-widget.desktop.minimized .widget-header {
    cursor: default;
  }

  .timer-widget.mobile .widget-header {
    cursor: default;
  }

  .timer-widget.mobile .timer-time-large {
    font-size: 52px;
  }

  .timer-widget.mobile .preset-grid {
    grid-template-columns: repeat(4, 1fr);
  }

  .timer-widget.mobile .time-presets {
    display: flex;
    flex-wrap: nowrap;
  }

  .minimize-btn {
    padding: 4px;
    border-radius: 6px;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--color-text-caption);
    transition: all 0.2s;
  }

  .minimize-btn:hover {
    background: var(--color-input-border);
  }
</style>
