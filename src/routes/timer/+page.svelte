<!--
  Timer Page - Multi-timer support
  
  This page allows users to:
  - Create multiple named cooking timers
  - See live countdown while app is open
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
    clearCompletedTimers,
    formatTime,
    getRemainingTime,
    type TimerItem,
  } from '$lib/timerStore';
  import PlusIcon from 'phosphor-svelte/lib/Plus';
  import PlayIcon from 'phosphor-svelte/lib/Play';
  import PauseIcon from 'phosphor-svelte/lib/Pause';
  import TrashIcon from 'phosphor-svelte/lib/Trash';
  import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircle';
  import BellIcon from 'phosphor-svelte/lib/Bell';
  import BellSlashIcon from 'phosphor-svelte/lib/BellSlash';

  // Form state
  let label = '';
  let minutes = 0;
  let seconds = 0;
  let isCreating = false;

  // Timer state from store
  let timers: TimerItem[] = [];

  // Sound state
  let soundEnabled = true;
  let audioContext: AudioContext | null = null;
  let isRinging = false;
  let ringInterval: ReturnType<typeof setInterval> | null = null;

  // Initialize audio context on user interaction
  function initAudio() {
    if (!audioContext && browser) {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }

  // Play a single bell tone
  function playBellTone() {
    if (!audioContext || !soundEnabled) return;

    const now = audioContext.currentTime;

    // Create oscillators for bell harmonics
    const fundamentalFreq = 800;
    const harmonics = [1, 2.4, 3, 4.5]; // Bell-like harmonics

    harmonics.forEach((harmonic, i) => {
      const osc = audioContext!.createOscillator();
      const gain = audioContext!.createGain();

      osc.type = 'sine';
      osc.frequency.value = fundamentalFreq * harmonic;

      // Louder fundamental, quieter harmonics
      const volume = 0.3 / (i + 1);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

      osc.connect(gain);
      gain.connect(audioContext!.destination);

      osc.start(now);
      osc.stop(now + 1.5);
    });
  }

  // Start ringing (repeating bell)
  function startRinging() {
    if (isRinging || !soundEnabled) return;
    isRinging = true;
    initAudio();
    playBellTone();
    // Ring every 2 seconds
    ringInterval = setInterval(() => {
      if (soundEnabled && isRinging) {
        playBellTone();
      }
    }, 2000);
  }

  // Stop ringing
  function stopRinging() {
    isRinging = false;
    if (ringInterval) {
      clearInterval(ringInterval);
      ringInterval = null;
    }
  }

  // Toggle sound
  function toggleSound() {
    initAudio();
    soundEnabled = !soundEnabled;
    if (!soundEnabled) {
      stopRinging();
    }
  }

  // For live countdown updates
  let tickInterval: ReturnType<typeof setInterval> | null = null;
  let tick = 0; // Increment to trigger reactivity

  // Subscribe to store
  const unsubscribe = timerStore.subscribe(state => {
    timers = state.timers;
  });

  onMount(async () => {
    if (browser) {
      await loadTimers();
      startTicking();
    }
  });

  onDestroy(() => {
    unsubscribe();
    stopTicking();
    stopRinging();
  });

  function startTicking() {
    if (tickInterval) return;
    // Update every 250ms for smooth countdown
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

  function checkForCompletedTimers() {
    const now = Date.now();
    timers.forEach(timer => {
      if (timer.status === 'running' && now >= timer.endsAt) {
        markTimerDone(timer.id);
        // Play bell sound when timer completes
        if (soundEnabled) {
          startRinging();
        }
      }
    });
  }

  async function handleCreateTimer() {
    const durationMs = (minutes * 60 + seconds) * 1000;
    if (durationMs <= 0) return;

    isCreating = true;
    try {
      await startTimer(label, durationMs);
      // Reset form
      label = '';
      minutes = 0;
      seconds = 0;
    } finally {
      isCreating = false;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      handleCreateTimer();
    }
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
    // Stop ringing if deleting a completed timer
    if (timer.status === 'done') {
      stopRinging();
    }
  }

  function handleClearCompleted() {
    clearCompletedTimers();
    stopRinging();
  }

  // Reactive: get remaining time for each timer (updates with tick)
  function getDisplayTime(timer: TimerItem, _tick: number): string {
    return formatTime(getRemainingTime(timer));
  }

  // Check if any timers are completed/done
  $: hasCompletedTimers = timers.some(t => t.status === 'done' || t.status === 'canceled');
  $: runningTimers = timers.filter(t => t.status === 'running' || t.status === 'paused');
  $: completedTimers = timers.filter(t => t.status === 'done');
</script>

<svelte:head>
  <title>Timer | Zap Cooking</title>
</svelte:head>

<div class="max-w-lg mx-auto">
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-bold">Cooking Timer</h1>
    <button
      on:click={toggleSound}
      class="sound-toggle p-2 rounded-full transition-colors {soundEnabled ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500'}"
      aria-label={soundEnabled ? 'Mute sound' : 'Enable sound'}
      title={soundEnabled ? 'Sound on - click to mute' : 'Sound off - click to enable'}
    >
      {#if soundEnabled}
        <BellIcon size={24} weight="fill" />
      {:else}
        <BellSlashIcon size={24} />
      {/if}
    </button>
  </div>

  <!-- Create Timer Form -->
  <div class="bg-surface border border-border rounded-xl p-4 mb-6">
    <h2 class="text-sm font-medium text-secondary mb-3">New Timer</h2>
    
    <div class="space-y-3">
      <!-- Label input -->
      <input
        type="text"
        bind:value={label}
        placeholder="Timer name (e.g., Pasta, Eggs)"
        class="w-full px-3 py-2 bg-input border border-input-border rounded-lg text-primary placeholder:text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/50"
        on:keydown={handleKeydown}
      />

      <!-- Duration inputs -->
      <div class="flex items-center gap-3">
        <div class="flex-1">
          <label for="timer-minutes" class="block text-xs text-secondary mb-1">Minutes</label>
          <input
            id="timer-minutes"
            type="number"
            bind:value={minutes}
            min="0"
            max="999"
            class="w-full px-3 py-2 bg-input border border-input-border rounded-lg text-primary text-center focus:outline-none focus:ring-2 focus:ring-primary/50"
            on:keydown={handleKeydown}
          />
        </div>
        <span class="text-2xl text-secondary mt-4">:</span>
        <div class="flex-1">
          <label for="timer-seconds" class="block text-xs text-secondary mb-1">Seconds</label>
          <input
            id="timer-seconds"
            type="number"
            bind:value={seconds}
            min="0"
            max="59"
            class="w-full px-3 py-2 bg-input border border-input-border rounded-lg text-primary text-center focus:outline-none focus:ring-2 focus:ring-primary/50"
            on:keydown={handleKeydown}
          />
        </div>
      </div>

      <!-- Start button -->
      <button
        on:click={handleCreateTimer}
        disabled={isCreating || (minutes === 0 && seconds === 0)}
        class="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary text-white rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <PlusIcon size={20} />
        Start Timer
      </button>
    </div>
  </div>

  <!-- Active Timers -->
  {#if runningTimers.length > 0}
    <div class="mb-6">
      <h2 class="text-sm font-medium mb-3" style="color: #000000;">Active Timers</h2>
      <div class="space-y-3">
        {#each runningTimers as timer (timer.id)}
          {@const remaining = getRemainingTime(timer)}
          {@const progress = timer.status === 'running' ? (1 - remaining / timer.durationMs) * 100 : (1 - (timer.pausedRemainingMs || 0) / timer.durationMs) * 100}
          <div class="bg-surface border border-border rounded-xl p-4 relative overflow-hidden">
            <!-- Progress bar background -->
            <div
              class="absolute inset-0 bg-primary/10 transition-all duration-300"
              style="width: {progress}%"
            />
            
            <div class="relative flex items-center justify-between">
              <div class="flex-1 min-w-0">
                <h3 class="font-medium truncate" style="color: #000000;">{timer.label}</h3>
                <p class="text-3xl font-mono font-bold tabular-nums" style="color: #000000;">
                  {getDisplayTime(timer, tick)}
                </p>
                {#if timer.status === 'paused'}
                  <span class="text-xs text-amber-600 dark:text-amber-400 font-medium">PAUSED</span>
                {/if}
              </div>
              
              <div class="flex items-center gap-2 ml-3">
                <!-- Pause/Resume button -->
                <button
                  on:click={() => handlePauseResume(timer)}
                  class="p-3 rounded-full bg-input border border-input-border hover:bg-input-border transition-colors"
                  aria-label={timer.status === 'running' ? 'Pause' : 'Resume'}
                >
                  {#if timer.status === 'running'}
                    <PauseIcon size={24} />
                  {:else}
                    <PlayIcon size={24} />
                  {/if}
                </button>
                
                <!-- Delete button -->
                <button
                  on:click={() => handleDelete(timer)}
                  class="p-3 rounded-full bg-input border border-input-border hover:bg-red-100 dark:hover:bg-red-900/30 hover:border-red-300 dark:hover:border-red-700 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                  aria-label="Delete timer"
                >
                  <TrashIcon size={24} />
                </button>
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Completed Timers -->
  {#if completedTimers.length > 0}
    <div class="mb-6">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm font-medium text-secondary">Completed</h2>
        <button
          on:click={handleClearCompleted}
          class="text-xs text-secondary hover:text-primary transition-colors"
        >
          Clear all
        </button>
      </div>
      <div class="space-y-2">
        {#each completedTimers as timer (timer.id)}
          <div class="bg-surface/50 border border-border/50 rounded-xl p-3 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <CheckCircleIcon size={20} class="text-green-600 dark:text-green-400" />
              <span class="text-primary">{timer.label}</span>
            </div>
            <button
              on:click={() => handleDelete(timer)}
              class="p-2 rounded-full hover:bg-input transition-colors text-secondary hover:text-red-500"
              aria-label="Delete timer"
            >
              <TrashIcon size={18} />
            </button>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Empty State -->
  {#if timers.length === 0}
    <div class="text-center py-12 text-secondary">
      <p class="text-lg mb-2">No timers yet</p>
      <p class="text-sm opacity-75">Create a timer above to get started</p>
    </div>
  {/if}

  <!-- Quick preset buttons -->
  <div class="mt-8">
    <h2 class="text-sm font-medium text-secondary mb-3">Quick Start</h2>
    <div class="flex flex-wrap gap-2">
      {#each [
        { label: '1 min', m: 1, s: 0 },
        { label: '3 min', m: 3, s: 0 },
        { label: '5 min', m: 5, s: 0 },
        { label: '10 min', m: 10, s: 0 },
        { label: '15 min', m: 15, s: 0 },
        { label: '30 min', m: 30, s: 0 },
      ] as preset}
        <button
          on:click={() => startTimer(preset.label, (preset.m * 60 + preset.s) * 1000)}
          class="px-4 py-2 bg-input border border-input-border rounded-lg text-sm text-primary hover:bg-input-border transition-colors"
        >
          {preset.label}
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  /* Use CSS variables from the app theme */
  .bg-surface {
    background-color: var(--color-surface, #fff);
  }
  .bg-input {
    background-color: var(--color-input, #f5f5f5);
  }
  .border-border {
    border-color: var(--color-input-border, #e5e5e5);
  }
  .border-input-border {
    border-color: var(--color-input-border, #e5e5e5);
  }
  .text-primary {
    color: var(--color-text-primary, #1a1a1a);
  }
  .text-secondary {
    color: var(--color-text-secondary, #666);
  }
  .bg-primary {
    background-color: var(--color-primary, #ef4444);
  }
  .hover\:bg-primary\/90:hover {
    background-color: color-mix(in srgb, var(--color-primary, #ef4444) 90%, transparent);
  }
  .bg-primary\/10 {
    background-color: color-mix(in srgb, var(--color-primary, #ef4444) 10%, transparent);
  }
  .hover\:bg-input-border:hover {
    background-color: var(--color-input-border, #e5e5e5);
  }

  /* Tabular numbers for countdown display */
  .tabular-nums {
    font-variant-numeric: tabular-nums;
  }
</style>
