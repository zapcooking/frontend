<!--
  ConverterWidget - Floating draggable unit converter panel that overlays page content

  Allows users to quickly convert units while viewing recipes.
  Can be dragged anywhere on screen (desktop) or docked at bottom (mobile).
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import {
    UNITS,
    getUnitsByCategory,
    getUnitCategory,
    areUnitsCompatible,
    convert,
    formatNumber,
    getDefaultToUnit
  } from '$lib/utils/unitConverter';
  import SwapIcon from 'phosphor-svelte/lib/ArrowsClockwise';
  import XIcon from 'phosphor-svelte/lib/X';
  import DotsSixVerticalIcon from 'phosphor-svelte/lib/DotsSixVertical';
  import CaretUpIcon from 'phosphor-svelte/lib/CaretUp';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';

  export let open = false;

  // Mobile detection and minimize state
  let isMobile = false;
  let isMinimized = false;

  // Converter state
  let amount: string = '';
  let fromUnitId: string = 'cup';
  let toUnitId: string = 'mL';

  // Computed
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

  // Drag state
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let posX: number | null = null;
  let posY: number | null = null;
  let widgetEl: HTMLDivElement;

  // Preset chips
  const presets = [
    { amount: '1', unit: 'tsp', label: '1 tsp' },
    { amount: '1', unit: 'tbsp', label: '1 tbsp' },
    { amount: '1', unit: 'cup', label: '1 cup' },
    { amount: '250', unit: 'mL', label: '250 mL' },
    { amount: '100', unit: 'g', label: '100 g' },
    { amount: '1', unit: 'oz', label: '1 oz' }
  ];

  onMount(() => {
    if (browser) {
      isMobile = window.innerWidth < 1024;

      // Load saved position
      const savedPos = localStorage.getItem('zapcooking_converter_position');
      if (savedPos) {
        try {
          const { x, y } = JSON.parse(savedPos);
          const widgetWidth = 340;
          const widgetHeight = 400;
          const maxX = window.innerWidth - widgetWidth;
          const maxY = window.innerHeight - widgetHeight;
          posX = Math.max(0, Math.min(x, maxX));
          posY = Math.max(0, Math.min(y, maxY));
        } catch {}
      }

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
    }
  }

  onDestroy(() => {
    if (browser) {
      window.removeEventListener('resize', handleResize);
    }
  });

  // Drag handlers
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

    // Save position
    if (browser && posX !== null && posY !== null) {
      localStorage.setItem('zapcooking_converter_position', JSON.stringify({ x: posX, y: posY }));
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

  function handleAmountInput(e: Event) {
    const target = e.target as HTMLInputElement;
    const value = target.value;
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      amount = value;
    }
  }

  function handleFromUnitChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    const newFromUnit = target.value;
    fromUnitId = newFromUnit;

    const newCategory = getUnitCategory(newFromUnit);
    if (newCategory && !areUnitsCompatible(newFromUnit, toUnitId)) {
      const defaultTo = getDefaultToUnit(newFromUnit);
      if (defaultTo) {
        toUnitId = defaultTo;
      }
    }
  }

  function handleToUnitChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    toUnitId = target.value;
  }

  function handleSwap() {
    const tempUnit = fromUnitId;
    fromUnitId = toUnitId;
    toUnitId = tempUnit;
  }

  function handlePreset(preset: { amount: string; unit: string }) {
    amount = preset.amount;
    fromUnitId = preset.unit;
    const defaultTo = getDefaultToUnit(preset.unit);
    if (defaultTo) {
      toUnitId = defaultTo;
    }
  }

  // Apply position via DOM when values change
  $: if (browser && widgetEl && !isDragging && !isMinimized && !isMobile) {
    if (posX !== null && posY !== null) {
      widgetEl.style.left = `${posX}px`;
      widgetEl.style.top = `${posY}px`;
      widgetEl.style.right = 'auto';
    }
  }
</script>

{#if open}
  <div
    class="converter-widget {isMobile ? 'mobile' : 'desktop'}"
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
      aria-label={isMobile
        ? 'Converter controls'
        : isMinimized
          ? 'Converter docked'
          : 'Drag to move'}
    >
      {#if !isMobile && !isMinimized}
        <div class="drag-handle">
          <DotsSixVerticalIcon size={16} />
        </div>
      {/if}
      <span class="widget-title">⚖️ Converter</span>
      {#if isMinimized && displayResult && amount}
        <span class="minimized-result">
          {amount} → {displayResult}
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
      <div class="converter-content">
        <!-- Amount Input -->
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

        <!-- From Unit -->
        <div class="input-group">
          <label for="widget-from" class="input-label">From</label>
          <select
            id="widget-from"
            value={fromUnitId}
            on:change={handleFromUnitChange}
            class="unit-select"
          >
            {#each availableUnits as unit}
              <option value={unit.id}>
                {unit.label}
                {unit.abbreviation ? `(${unit.abbreviation})` : ''}
              </option>
            {/each}
          </select>
        </div>

        <!-- Swap Button -->
        <div class="swap-row">
          <button on:click={handleSwap} class="swap-btn" aria-label="Swap units">
            <SwapIcon size={18} />
          </button>
        </div>

        <!-- To Unit -->
        <div class="input-group">
          <label for="widget-to" class="input-label">To</label>
          <select
            id="widget-to"
            value={toUnitId}
            on:change={handleToUnitChange}
            class="unit-select"
          >
            {#each availableUnits as unit}
              <option value={unit.id}>
                {unit.label}
                {unit.abbreviation ? `(${unit.abbreviation})` : ''}
              </option>
            {/each}
          </select>
        </div>

        <!-- Result Display -->
        <div class="result-section">
          {#if compatible && amount && amountNum !== null && !isNaN(amountNum)}
            <div class="result-value">{displayResult || '0'}</div>
            <div class="result-unit">
              {UNITS.find((u) => u.id === toUnitId)?.label || toUnitId}
            </div>
          {:else if amount && amountNum !== null && !isNaN(amountNum) && !compatible}
            <div class="result-error">Units must be in the same category</div>
          {:else}
            <div class="result-placeholder">—</div>
          {/if}
        </div>

        <!-- Quick Presets -->
        <div class="presets-section">
          <span class="presets-label">Quick Presets</span>
          <div class="preset-grid">
            {#each presets as preset}
              <button on:click={() => handlePreset(preset)} class="preset-btn">
                {preset.label}
              </button>
            {/each}
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .converter-widget {
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

  .converter-widget.dragging {
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

  .minimized-result {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-primary);
    margin-left: auto;
    margin-right: 8px;
  }

  .header-actions {
    display: flex;
    gap: 4px;
  }

  .minimize-btn,
  .close-btn {
    padding: 4px;
    border-radius: 6px;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--color-text-caption);
    transition: all 0.2s;
  }

  .minimize-btn:hover,
  .close-btn:hover {
    background: var(--color-input-border);
  }

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
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }

  .preset-btn {
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

  .preset-btn:hover {
    background: var(--color-input-border);
  }

  /* Mobile styles */
  .converter-widget.mobile {
    top: auto;
    bottom: calc(var(--bottom-nav-height, 40px) + env(safe-area-inset-bottom, 0px));
    left: 0;
    right: 0;
    width: 100%;
    max-width: 100%;
    border-radius: 16px 16px 0 0;
    border-bottom: none;
    max-height: 70vh;
  }

  .converter-widget.mobile.minimized {
    max-height: none;
    overflow: hidden;
  }

  .converter-widget.mobile .widget-header {
    cursor: default;
  }

  /* Desktop minimized */
  .converter-widget.desktop.minimized {
    top: auto !important;
    bottom: calc(40px + env(safe-area-inset-bottom, 0px) + 8px) !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    right: auto !important;
    width: auto;
    min-width: 280px;
    max-height: none;
    overflow: hidden;
    border-radius: 12px;
  }

  @media (min-width: 1024px) {
    .converter-widget.desktop.minimized {
      bottom: 16px !important;
    }
  }

  .converter-widget.desktop.minimized .widget-header {
    cursor: default;
  }
</style>
