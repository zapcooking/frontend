<!--
  CookingToolsWidget - Unified floating panel with tabs for Timer and Converter

  Combines timer and unit converter functionality in a single draggable widget.
  Features tabbed interface to switch between tools.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { cookingToolsStore, type ToolsTab } from '$lib/stores/cookingToolsWidget';

  // Timer imports
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

  // Converter imports
  import {
    UNITS,
    getUnitsByCategory,
    getUnitCategory,
    areUnitsCompatible,
    convert,
    formatNumber,
    getDefaultToUnit
  } from '$lib/utils/unitConverter';

  // Icons
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
  import SwapIcon from 'phosphor-svelte/lib/ArrowsClockwise';
  import TimerIcon from 'phosphor-svelte/lib/Timer';
  import CalculatorIcon from 'phosphor-svelte/lib/Calculator';

  // Widget state from store
  let isOpen = false;
  let activeTab: ToolsTab = 'timer';

  const unsubscribeStore = cookingToolsStore.subscribe((state) => {
    isOpen = state.open;
    activeTab = state.activeTab;
  });

  // Mobile detection and minimize state
  let isMobile = false;
  let isMinimized = false;

  // ============ TIMER STATE ============
  let timers: TimerItem[] = [];
  let quickMinutesInput = '5';
  let quickLabel = '';
  let soundEnabled = true;
  let audioContext: AudioContext | null = null;
  let showSoundPrompt = false;
  let audioStateListenerAttached = false;
  let tickInterval: ReturnType<typeof setInterval> | null = null;
  let tick = 0;

  const unsubscribeTimers = timerStore.subscribe((state) => {
    timers = state.timers;
  });

  const unsubscribeSettings = timerSettings.subscribe((settings) => {
    soundEnabled = settings.soundEnabled;
  });

  // ============ CONVERTER STATE ============
  let amount: string = '';
  let fromUnitId: string = 'cup';
  let toUnitId: string = 'mL';

  $: amountNum = amount === '' ? null : parseFloat(amount);
  $: fromCategory = getUnitCategory(fromUnitId);
  $: toCategory = getUnitCategory(toUnitId);
  $: compatible = fromCategory && toCategory && fromCategory === toCategory;
  $: convertedAmount =
    compatible && amountNum !== null && !isNaN(amountNum)
      ? convert(amountNum, fromUnitId, toUnitId)
      : null;
  $: displayResult = formatNumber(convertedAmount);
  $: availableUnits = fromCategory ? getUnitsByCategory(fromCategory) : [];

  const presets = [
    { amount: '1', unit: 'tsp', label: '1 tsp' },
    { amount: '1', unit: 'tbsp', label: '1 tbsp' },
    { amount: '1', unit: 'cup', label: '1 cup' },
    { amount: '250', unit: 'mL', label: '250 mL' },
    { amount: '100', unit: 'g', label: '100 g' },
    { amount: '1', unit: 'oz', label: '1 oz' }
  ];

  // ============ DRAG STATE ============
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let posX: number | null = null;
  let posY: number | null = null;
  let widgetEl: HTMLDivElement;

  let resizeObserver: ResizeObserver | null = null;
  let isObservingOffset = false;

  onMount(async () => {
    if (browser) {
      await loadTimers();
      const settings = await loadTimerSettings();

      isMobile = window.innerWidth < 1024;

      // Load position from settings
      if (settings.positionX !== null && settings.positionY !== null) {
        const widgetWidth = 380;
        const widgetHeight = 500;
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

    if (wasMobile !== isMobile && widgetEl) {
      widgetEl.style.left = '';
      widgetEl.style.top = '';
      widgetEl.style.right = '';
      widgetEl.style.transform = '';

      if (!isMobile && !isMinimized && posX !== null && posY !== null) {
        const maxX = window.innerWidth - widgetEl.offsetWidth;
        const maxY = window.innerHeight - widgetEl.offsetHeight;
        posX = Math.max(0, Math.min(posX, maxX));
        posY = Math.max(0, Math.min(posY, maxY));
        widgetEl.style.left = `${posX}px`;
        widgetEl.style.top = `${posY}px`;
        widgetEl.style.right = 'auto';
      }
    } else if (!isMobile && !isMinimized && posX !== null && posY !== null && widgetEl) {
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
    unsubscribeStore();
    unsubscribeTimers();
    unsubscribeSettings();
    stopTicking();
    teardownMobileOffsetObserver();
    if (browser) {
      window.removeEventListener('resize', handleResize);
    }
  });

  // ============ MOBILE OFFSET HELPERS ============
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
    if (height > 0) setMobileOffset(height);
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

  // ============ TIMER FUNCTIONS ============
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

  function initAudio() {
    if (!audioContext && browser) {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (!audioStateListenerAttached) {
        audioContext.addEventListener('statechange', () => updateSoundPrompt());
        audioStateListenerAttached = true;
      }
    }
  }

  function updateSoundPrompt() {
    if (!browser) return;
    showSoundPrompt =
      isOpen && isMobile && soundEnabled && (!audioContext || audioContext.state !== 'running');
  }

  async function enableSound() {
    initAudio();
    if (!audioContext) return;
    try {
      await audioContext.resume();
    } catch {}
    updateSoundPrompt();
  }

  function playTimerDing() {
    if (!audioContext || !soundEnabled) return;
    const now = audioContext.currentTime;
    const fundamentalFreq = 2200;
    const harmonics = [1, 2.0, 3.0];
    const repeatCount = 5;
    const repeatInterval = 1;

    for (let repeat = 0; repeat < repeatCount; repeat++) {
      const startAt = now + repeat * repeatInterval;
      harmonics.forEach((harmonic, i) => {
        const osc = audioContext!.createOscillator();
        const gain = audioContext!.createGain();
        osc.type = 'sine';
        osc.frequency.value = fundamentalFreq * harmonic;
        const volume = 0.4 / (i + 1);
        gain.gain.setValueAtTime(volume, startAt);
        gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.6);
        osc.connect(gain);
        gain.connect(audioContext!.destination);
        osc.start(startAt);
        osc.stop(startAt + 0.6);
      });
    }
  }

  function checkForCompletedTimers() {
    const now = Date.now();
    const expiryMs = import.meta.env.DEV ? 2 * 60 * 1000 : 60 * 60 * 1000;
    timers.forEach((timer) => {
      if (timer.status === 'running' && now >= timer.endsAt) {
        markTimerDone(timer.id);
        if (soundEnabled) {
          initAudio();
          playTimerDing();
        }
        // Auto-switch to timer tab and un-minimize when a timer completes
        if (isOpen) {
          if (activeTab !== 'timer') {
            cookingToolsStore.setTab('timer');
          }
          if (isMinimized) {
            toggleMinimize();
          }
        }
      }
      if (timer.status === 'done' && timer.endsAt && now - timer.endsAt >= expiryMs) {
        void cancelTimer(timer.id);
      }
    });
  }

  function normalizeMinutes(value: number): number {
    if (!Number.isFinite(value)) return 0.1;
    return Math.round(Math.max(0.1, Math.min(999, value)) * 10) / 10;
  }

  function formatMinutesLabel(value: number): string {
    const rounded = Math.round(value * 10) / 10;
    return Math.abs(rounded - Math.round(rounded)) < 1e-9
      ? String(Math.round(rounded))
      : rounded.toFixed(1);
  }

  function sanitizeMinutesInput(raw: string): string {
    const normalized = raw.replace(',', '.');
    const cleaned = normalized.replace(/[^\d.]/g, '');
    const firstDot = cleaned.indexOf('.');
    if (firstDot === -1) return cleaned;
    const intPart = cleaned.slice(0, firstDot);
    const decPart = cleaned
      .slice(firstDot + 1)
      .replace(/\./g, '')
      .slice(0, 1);
    return `${intPart}.${decPart}`.replace(/\.$/, '.');
  }

  function applyQuickMinutesClamp() {
    const value = Number(quickMinutesInput);
    const normalized = normalizeMinutes(value);
    quickMinutesInput = formatMinutesLabel(normalized);
    return normalized;
  }

  function handleMinutesInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const sanitized = sanitizeMinutesInput(input.value);
    quickMinutesInput = sanitized;
    input.value = sanitized;
  }

  function handleMinutesBlur() {
    applyQuickMinutesClamp();
  }

  async function handleQuickAdd() {
    const minutes = applyQuickMinutesClamp();
    const durationMs = minutes * 60 * 1000;
    const label = quickLabel.trim() || `${formatMinutesLabel(minutes)} min`;
    await startTimer(label, durationMs);
    quickLabel = '';
  }

  async function handlePauseResume(timer: TimerItem) {
    if (timer.status === 'running') await pauseTimer(timer.id);
    else if (timer.status === 'paused') await resumeTimer(timer.id);
  }

  async function handleDelete(timer: TimerItem) {
    await cancelTimer(timer.id);
  }

  function toggleSound() {
    initAudio();
    const newValue = !soundEnabled;
    soundEnabled = newValue;
    updateTimerSetting('soundEnabled', newValue);
    updateSoundPrompt();
  }

  function getDisplayTime(timer: TimerItem, _tick: number): string {
    return formatTime(getRemainingTime(timer));
  }

  function formatElapsedTime(ms: number): string {
    if (ms <= 0) return '00:00';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return hours > 0
      ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
      : `${pad(minutes)}:${pad(seconds)}`;
  }

  function getElapsedTime(timer: TimerItem, _tick: number): string {
    if (timer.status !== 'done' || !timer.endsAt) return '';
    return formatElapsedTime(Date.now() - timer.endsAt);
  }

  $: alertTimers = timers.filter((t) => t.status === 'done');
  $: activeTimers = timers.filter((t) => t.status === 'running' || t.status === 'paused');
  $: displayTimers = [...alertTimers, ...activeTimers];
  $: hasActiveTimers = activeTimers.length > 0 || alertTimers.length > 0;

  // ============ CONVERTER FUNCTIONS ============
  function handleAmountInput(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.value === '' || /^\d*\.?\d*$/.test(target.value)) {
      amount = target.value;
    }
  }

  function handleFromUnitChange(e: Event) {
    const newFromUnit = (e.target as HTMLSelectElement).value;
    fromUnitId = newFromUnit;
    const newCategory = getUnitCategory(newFromUnit);
    if (newCategory && !areUnitsCompatible(newFromUnit, toUnitId)) {
      const defaultTo = getDefaultToUnit(newFromUnit);
      if (defaultTo) toUnitId = defaultTo;
    }
  }

  function handleToUnitChange(e: Event) {
    toUnitId = (e.target as HTMLSelectElement).value;
  }

  function handleSwap() {
    const temp = fromUnitId;
    fromUnitId = toUnitId;
    toUnitId = temp;
  }

  function handlePreset(preset: { amount: string; unit: string }) {
    amount = preset.amount;
    fromUnitId = preset.unit;
    const defaultTo = getDefaultToUnit(preset.unit);
    if (defaultTo) toUnitId = defaultTo;
  }

  // ============ DRAG HANDLERS ============
  function handleDragStart(e: MouseEvent | TouchEvent) {
    if (isMobile || isMinimized) return;
    isDragging = true;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

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

    if (browser) {
      const maxX = window.innerWidth - widgetEl.offsetWidth;
      const maxY = window.innerHeight - widgetEl.offsetHeight;
      newX = Math.max(0, Math.min(newX, maxX));
      newY = Math.max(0, Math.min(newY, maxY));
    }

    posX = newX;
    posY = newY;
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

    if (browser && posX !== null && posY !== null) {
      saveTimerSettings({ soundEnabled, positionX: posX, positionY: posY });
    }
  }

  function toggleMinimize() {
    isMinimized = !isMinimized;
    if (widgetEl) {
      if (isMinimized) {
        widgetEl.style.left = '';
        widgetEl.style.top = '';
        widgetEl.style.right = '';
        widgetEl.style.transform = '';
      } else {
        widgetEl.style.transform = '';
        if (posX !== null && posY !== null && !isMobile) {
          widgetEl.style.left = `${posX}px`;
          widgetEl.style.top = `${posY}px`;
          widgetEl.style.right = 'auto';
        }
      }
    }
  }

  function handleClose() {
    cookingToolsStore.close();
  }

  function switchTab(tab: ToolsTab) {
    cookingToolsStore.setTab(tab);
  }

  // ============ REACTIVE STATEMENTS ============
  $: if (browser) {
    showSoundPrompt =
      isOpen &&
      isMobile &&
      soundEnabled &&
      activeTab === 'timer' &&
      (!audioContext || audioContext.state !== 'running');
  }

  $: if (browser && widgetEl && !isDragging && !isMinimized && !isMobile) {
    if (posX !== null && posY !== null) {
      widgetEl.style.left = `${posX}px`;
      widgetEl.style.top = `${posY}px`;
      widgetEl.style.right = 'auto';
    } else {
      widgetEl.style.left = '';
      widgetEl.style.top = '';
      widgetEl.style.right = '';
    }
  }

  $: if (browser) {
    if (isOpen && isMobile && widgetEl) {
      setupMobileOffsetObserver();
    } else {
      teardownMobileOffsetObserver();
    }
  }
</script>

{#if isOpen}
  <div
    class="tools-widget {isMobile ? 'mobile' : 'desktop'}"
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
      aria-label={isMobile ? 'Tools controls' : isMinimized ? 'Tools docked' : 'Drag to move'}
    >
      {#if !isMobile && !isMinimized}
        <div class="drag-handle">
          <DotsSixVerticalIcon size={16} />
        </div>
      {/if}

      <!-- Minimized icon -->
      {#if isMinimized}
        <div class="minimized-icon">
          {#if activeTab === 'timer'}
            <TimerIcon size={18} weight="bold" />
          {:else}
            <CalculatorIcon size={18} weight="bold" />
          {/if}
        </div>
      {/if}

      <!-- Tabs in header -->
      {#if !isMinimized}
        <div class="header-tabs">
          <button
            class="tab-btn"
            class:active={activeTab === 'timer'}
            on:click|stopPropagation={() => switchTab('timer')}
          >
            <TimerIcon size={16} weight={activeTab === 'timer' ? 'fill' : 'regular'} />
            <span>Timer</span>
            {#if hasActiveTimers}
              <span class="timer-badge">{displayTimers.length}</span>
            {/if}
          </button>
          <button
            class="tab-btn"
            class:active={activeTab === 'converter'}
            on:click|stopPropagation={() => switchTab('converter')}
          >
            <CalculatorIcon size={16} weight={activeTab === 'converter' ? 'fill' : 'regular'} />
            <span>Converter</span>
          </button>
        </div>
      {:else}
        <span class="widget-title-minimized">
          {activeTab === 'timer' ? 'Timer' : 'Converter'}
        </span>
        {#if activeTab === 'timer' && displayTimers.length > 0}
          {@const minimizedDone = displayTimers[0].status === 'done'}
          <span class="minimized-time" class:done={minimizedDone}>
            {getDisplayTime(displayTimers[0], tick)}
          </span>
        {:else if activeTab === 'converter' && displayResult && amount}
          <span class="minimized-result">{amount} = {displayResult}</span>
        {/if}
      {/if}

      <div class="header-actions">
        <button
          on:click|stopPropagation={toggleMinimize}
          class="action-btn-header"
          aria-label={isMinimized ? 'Expand' : 'Minimize'}
        >
          {#if isMinimized}
            <CaretUpIcon size={18} />
          {:else}
            <CaretDownIcon size={18} />
          {/if}
        </button>
        {#if activeTab === 'timer' && !isMinimized}
          <button
            on:click|stopPropagation={toggleSound}
            class="action-btn-header {soundEnabled ? 'sound-on' : 'sound-off'}"
            aria-label={soundEnabled ? 'Mute' : 'Unmute'}
          >
            {#if soundEnabled}
              <BellIcon size={16} weight="fill" />
            {:else}
              <BellSlashIcon size={16} />
            {/if}
          </button>
        {/if}
        <button on:click|stopPropagation={handleClose} class="action-btn-header" aria-label="Close">
          <XIcon size={18} />
        </button>
      </div>
    </div>

    <!-- Content (hidden when minimized) -->
    {#if !isMinimized}
      {#if activeTab === 'timer'}
        <!-- TIMER CONTENT -->
        {#if showSoundPrompt}
          <button class="sound-prompt" on:click|stopPropagation={enableSound}>
            <span class="sound-prompt-text">Tap to enable timer sound</span>
            <span class="sound-prompt-action">Enable</span>
          </button>
        {/if}

        <div class="quick-add">
          <input
            type="text"
            bind:value={quickLabel}
            placeholder="Label"
            class="quick-label"
            on:keydown={(e) => e.key === 'Enter' && handleQuickAdd()}
          />
          <input
            type="text"
            inputmode="decimal"
            bind:value={quickMinutesInput}
            class="quick-minutes"
            on:input={handleMinutesInput}
            on:blur={handleMinutesBlur}
          />
          <span class="min-label">min</span>
          <button on:click={handleQuickAdd} class="add-btn" aria-label="Add timer">
            <PlusIcon size={18} weight="bold" />
          </button>
        </div>

        {#if displayTimers.length > 0}
          <div class="timers-list">
            {#each displayTimers as timer (timer.id)}
              {@const isDone = timer.status === 'done'}
              {@const remaining = getRemainingTime(timer)}
              {@const progress =
                timer.status === 'running'
                  ? (1 - remaining / timer.durationMs) * 100
                  : (1 - (timer.pausedRemainingMs || 0) / timer.durationMs) * 100}
              <div class="timer-item" class:timer-item-done={isDone}>
                <div
                  class="timer-progress"
                  class:timer-progress-done={isDone}
                  style="width: {progress}%"
                ></div>
                <div class="timer-content">
                  <div class="timer-label-row">
                    <span class="timer-label">{timer.label}</span>
                    {#if isDone}
                      <span class="timer-elapsed">+{getElapsedTime(timer, tick)}</span>
                    {/if}
                  </div>
                  <div class="timer-main-row">
                    <span
                      class="timer-time-large {timer.status === 'paused' ? 'paused' : ''}"
                      class:done={isDone}
                    >
                      {getDisplayTime(timer, tick)}
                    </span>
                    <div class="timer-actions">
                      {#if !isDone}
                        <button on:click={() => handlePauseResume(timer)} class="action-btn">
                          {#if timer.status === 'running'}
                            <PauseIcon size={20} />
                          {:else}
                            <PlayIcon size={20} />
                          {/if}
                        </button>
                      {/if}
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

        <div class="presets-section">
          <span class="presets-label">Cooking Presets</span>
          <div class="preset-grid">
            <button on:click={() => startTimer('Poached Egg', 4 * 60 * 1000)} class="preset-btn"
              ><span class="preset-emoji">🥚</span><span class="preset-name">Poached</span><span
                class="preset-time">4 min</span
              ></button
            >
            <button
              on:click={() => startTimer('Hard Boiled Egg', 10 * 60 * 1000)}
              class="preset-btn"
              ><span class="preset-emoji">🥚</span><span class="preset-name">Hard Boiled</span><span
                class="preset-time">10 min</span
              ></button
            >
            <button on:click={() => startTimer('Pasta Al Dente', 8 * 60 * 1000)} class="preset-btn"
              ><span class="preset-emoji">🍝</span><span class="preset-name">Pasta</span><span
                class="preset-time">8 min</span
              ></button
            >
            <button on:click={() => startTimer('Rice', 18 * 60 * 1000)} class="preset-btn"
              ><span class="preset-emoji">🍚</span><span class="preset-name">Rice</span><span
                class="preset-time">18 min</span
              ></button
            >
            <button on:click={() => startTimer('Steak Rest', 5 * 60 * 1000)} class="preset-btn"
              ><span class="preset-emoji">🥩</span><span class="preset-name">Steak Rest</span><span
                class="preset-time">5 min</span
              ></button
            >
            <button on:click={() => startTimer('Veggies Steam', 7 * 60 * 1000)} class="preset-btn"
              ><span class="preset-emoji">🥦</span><span class="preset-name">Steam Veg</span><span
                class="preset-time">7 min</span
              ></button
            >
            <button on:click={() => startTimer('Casserole', 45 * 60 * 1000)} class="preset-btn"
              ><span class="preset-emoji">🥘</span><span class="preset-name">Casserole</span><span
                class="preset-time">45 min</span
              ></button
            >
            <button on:click={() => startTimer('Baked Potato', 60 * 60 * 1000)} class="preset-btn"
              ><span class="preset-emoji">🥔</span><span class="preset-name">Baked Potato</span
              ><span class="preset-time">60 min</span></button
            >
          </div>
        </div>
      {:else}
        <!-- CONVERTER CONTENT -->
        <div class="converter-content">
          <div class="input-group">
            <label for="widget-amount" class="input-label">Amount</label>
            <input
              id="widget-amount"
              type="text"
              inputmode="decimal"
              placeholder="0"
              value={amount}
              on:input={handleAmountInput}
              class="amount-input"
            />
          </div>

          <div class="input-group">
            <label for="widget-from" class="input-label">From</label>
            <select
              id="widget-from"
              value={fromUnitId}
              on:change={handleFromUnitChange}
              class="unit-select"
            >
              {#each availableUnits as unit}
                <option value={unit.id}
                  >{unit.label} {unit.abbreviation ? `(${unit.abbreviation})` : ''}</option
                >
              {/each}
            </select>
          </div>

          <div class="swap-row">
            <button on:click={handleSwap} class="swap-btn" aria-label="Swap units">
              <SwapIcon size={18} />
            </button>
          </div>

          <div class="input-group">
            <label for="widget-to" class="input-label">To</label>
            <select
              id="widget-to"
              value={toUnitId}
              on:change={handleToUnitChange}
              class="unit-select"
            >
              {#each availableUnits as unit}
                <option value={unit.id}
                  >{unit.label} {unit.abbreviation ? `(${unit.abbreviation})` : ''}</option
                >
              {/each}
            </select>
          </div>

          <div class="result-section">
            {#if compatible && amount && amountNum !== null && !isNaN(amountNum)}
              <div class="result-value">{displayResult || '0'}</div>
              <div class="result-unit">
                {UNITS.find((u) => u.id === toUnitId)?.label || toUnitId}
              </div>
            {:else if amount && amountNum !== null && !isNaN(amountNum) && !compatible}
              <div class="result-error">Units must be in the same category</div>
            {:else}
              <div class="result-placeholder">-</div>
            {/if}
          </div>

          <div class="presets-section">
            <span class="presets-label">Quick Presets</span>
            <div class="converter-preset-grid">
              {#each presets as preset}
                <button on:click={() => handlePreset(preset)} class="converter-preset-btn"
                  >{preset.label}</button
                >
              {/each}
            </div>
          </div>
        </div>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .tools-widget {
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

  .tools-widget.dragging {
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
    cursor: grabbing;
    user-select: none;
  }

  .widget-header {
    display: flex;
    align-items: center;
    gap: 8px;
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
    display: flex;
    align-items: center;
  }

  .minimized-icon {
    color: var(--color-text-primary);
    display: flex;
    align-items: center;
  }

  .header-tabs {
    display: flex;
    gap: 4px;
    flex: 1;
  }

  .tab-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 10px;
    border: none;
    background: transparent;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    color: var(--color-text-caption);
    cursor: pointer;
    transition: all 0.2s;
  }

  .tab-btn:hover {
    background: var(--color-input-border);
  }

  .tab-btn.active {
    background: var(--color-primary);
    color: white;
  }

  .timer-badge {
    background: rgba(255, 255, 255, 0.3);
    padding: 1px 5px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
  }

  .tab-btn:not(.active) .timer-badge {
    background: var(--color-input-border);
    color: var(--color-text-primary);
  }

  .widget-title-minimized {
    font-weight: 600;
    color: var(--color-text-primary);
    font-size: 14px;
  }

  .header-actions {
    display: flex;
    gap: 4px;
    margin-left: auto;
  }

  .action-btn-header {
    padding: 4px;
    border-radius: 6px;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--color-text-caption);
    transition: all 0.2s;
  }

  .action-btn-header:hover {
    background: var(--color-input-border);
  }
  .action-btn-header.sound-on {
    color: #f59e0b;
  }
  .action-btn-header.sound-off {
    opacity: 0.5;
  }

  .minimized-time {
    font-size: 18px;
    font-weight: 700;
    font-family: 'Orbitron', ui-monospace, monospace;
    color: var(--color-text-primary);
    margin-left: auto;
    margin-right: 8px;
  }

  .minimized-time.done {
    color: #f59e0b;
    animation: timer-pulse 1.2s ease-in-out infinite;
  }

  .minimized-result {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-primary);
    margin-left: auto;
    margin-right: 8px;
  }

  /* Timer styles */
  .sound-prompt {
    width: 100%;
    border: 1px solid var(--color-input-border);
    background: var(--color-input-bg);
    border-radius: 10px;
    padding: 8px 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 12px;
    color: var(--color-text-primary);
    cursor: pointer;
    margin-bottom: 10px;
  }

  .sound-prompt-action {
    font-weight: 600;
    color: var(--color-primary);
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

  .timer-item.timer-item-done {
    border-color: rgba(245, 158, 11, 0.45);
  }

  .timer-progress {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    background: color-mix(in srgb, var(--color-primary) 15%, transparent);
    transition: width 0.3s ease;
  }

  .timer-progress.timer-progress-done {
    background: color-mix(in srgb, #f59e0b 25%, transparent);
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
  }

  .timer-label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 4px;
  }

  .timer-main-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
  }

  .timer-time-large {
    font-size: 48px;
    font-weight: 700;
    font-family: 'Orbitron', ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
    color: var(--color-text-primary);
    line-height: 1;
    letter-spacing: 2px;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .timer-time-large.paused {
    color: #f59e0b;
  }
  .timer-time-large.done {
    color: #f59e0b;
    animation: timer-pulse 1.2s ease-in-out infinite;
  }

  .timer-elapsed {
    font-size: 13px;
    color: var(--color-text-caption);
    white-space: nowrap;
  }

  @keyframes timer-pulse {
    0%,
    100% {
      transform: scale(1);
      opacity: 1;
    }
    50% {
      transform: scale(1.06);
      opacity: 0.7;
    }
  }

  .timer-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
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

  .empty-state {
    text-align: center;
    padding: 20px;
    color: var(--color-text-caption);
    font-size: 14px;
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

  /* Converter styles */
  .converter-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .input-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .input-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--color-text-secondary);
  }

  .amount-input {
    width: 100%;
    padding: 10px 12px;
    font-size: 18px;
    font-weight: 600;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    border-radius: 8px;
    color: var(--color-text-primary);
  }

  .amount-input:focus {
    outline: none;
    border-color: var(--color-primary);
  }

  .unit-select {
    width: 100%;
    padding: 10px 12px;
    font-size: 14px;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    border-radius: 8px;
    color: var(--color-text-primary);
    cursor: pointer;
  }

  .unit-select:focus {
    outline: none;
    border-color: var(--color-primary);
  }

  .swap-row {
    display: flex;
    justify-content: center;
  }

  .swap-btn {
    padding: 8px;
    border-radius: 50%;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    cursor: pointer;
    color: var(--color-text-primary);
    transition: all 0.2s;
  }

  .swap-btn:hover {
    background: var(--color-input-border);
  }

  .result-section {
    text-align: center;
    padding: 16px;
    background: var(--color-bg-secondary);
    border-radius: 8px;
    border: 1px solid var(--color-input-border);
  }

  .result-value {
    font-size: 32px;
    font-weight: 700;
    color: var(--color-text-primary);
  }
  .result-unit {
    font-size: 14px;
    color: var(--color-text-secondary);
    margin-top: 4px;
  }
  .result-error {
    font-size: 13px;
    color: var(--color-text-secondary);
  }
  .result-placeholder {
    font-size: 24px;
    font-weight: 600;
    color: var(--color-text-secondary);
    opacity: 0.5;
  }

  .converter-preset-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }

  .converter-preset-btn {
    padding: 8px 6px;
    border: 1px solid var(--color-input-border);
    border-radius: 6px;
    background: transparent;
    color: var(--color-text-primary);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .converter-preset-btn:hover {
    background: var(--color-input-border);
  }

  /* Mobile styles - uses --bottom-nav-height set by BottomNav component */
  .tools-widget.mobile {
    top: auto;
    bottom: calc(var(--bottom-nav-height, 40px) + env(safe-area-inset-bottom, 0px));
    left: 0;
    right: 0;
    width: 100%;
    max-width: 100%;
    border-radius: 16px 16px 0 0;
    border-bottom: none;
    max-height: 70vh;
    z-index: 50;
  }

  .tools-widget.mobile.minimized {
    max-height: none;
    overflow: hidden;
  }
  .tools-widget.mobile .widget-header {
    cursor: default;
  }
  .tools-widget.mobile .timer-time-large {
    font-size: 52px;
  }
  .tools-widget.mobile .preset-grid {
    grid-template-columns: repeat(4, 1fr);
  }
  .tools-widget.mobile .time-presets {
    display: flex;
    flex-wrap: nowrap;
  }

  /* Desktop minimized */
  .tools-widget.desktop.minimized {
    top: auto !important;
    bottom: calc(40px + env(safe-area-inset-bottom, 0px) + 8px) !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    right: auto !important;
    width: auto;
    min-width: 300px;
    max-height: none;
    overflow: hidden;
    border-radius: 12px;
    z-index: 50;
  }

  @media (min-width: 1024px) {
    .tools-widget.desktop.minimized {
      bottom: 16px !important;
    }
  }

  .tools-widget.desktop.minimized .widget-header {
    cursor: default;
    margin-bottom: 0;
  }
  .tools-widget.minimized .widget-header {
    margin-bottom: 0;
  }
</style>
