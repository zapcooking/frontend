<script lang="ts">
  import {
    UNITS,
    getUnitsByCategory,
    getUnitCategory,
    areUnitsCompatible,
    convert,
    formatNumber,
    getDefaultToUnit,
    type UnitCategory,
    type Unit
  } from '$lib/utils/unitConverter';
  import SwapIcon from 'phosphor-svelte/lib/ArrowsClockwise';
  import XIcon from 'phosphor-svelte/lib/X';

  // State
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

  // Get units for current category
  $: availableUnits = fromCategory ? getUnitsByCategory(fromCategory) : [];

  // Preset chips
  const presets = [
    { amount: '1', unit: 'tsp', label: '1 tsp' },
    { amount: '1', unit: 'tbsp', label: '1 tbsp' },
    { amount: '1', unit: 'cup', label: '1 cup' },
    { amount: '250', unit: 'mL', label: '250 mL' },
    { amount: '100', unit: 'g', label: '100 g' },
    { amount: '1', unit: 'oz', label: '1 oz' },
    { amount: '1', unit: 'lb', label: '1 lb' }
  ];

  function handleAmountInput(e: Event) {
    const target = e.target as HTMLInputElement;
    const value = target.value;

    // Allow empty, numbers, and one decimal point
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      amount = value;
    }
  }

  function handleFromUnitChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    const newFromUnit = target.value;

    fromUnitId = newFromUnit;

    // Auto-adjust toUnit if incompatible
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

  function handleReset() {
    amount = '';
    fromUnitId = 'cup';
    toUnitId = 'mL';
  }

  function handlePreset(preset: { amount: string; unit: string }) {
    amount = preset.amount;
    fromUnitId = preset.unit;
    const defaultTo = getDefaultToUnit(preset.unit);
    if (defaultTo) {
      toUnitId = defaultTo;
    }
  }
</script>

<svelte:head>
  <title>Unit Converter | Zap Cooking</title>
</svelte:head>

<div class="max-w-lg mx-auto">
  <h1 class="text-2xl font-bold mb-6" style="color: var(--color-text-primary)">Unit Converter</h1>

  <!-- Main Converter Card -->
  <div class="bg-surface border border-border rounded-xl p-4 md:p-6 mb-6">
    <div class="space-y-4">
      <!-- Amount Input -->
      <div>
        <label
          for="amount-input"
          class="block text-sm font-medium mb-2"
          style="color: var(--color-text-secondary)"
        >
          Amount
        </label>
        <input
          id="amount-input"
          type="text"
          inputmode="decimal"
          placeholder="0"
          value={amount}
          on:input={handleAmountInput}
          class="w-full px-4 py-3 text-2xl font-semibold bg-input border border-input-border rounded-lg text-primary placeholder:text-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/50"
          style="color: var(--color-text-primary);"
        />
      </div>

      <!-- From Unit -->
      <div>
        <label
          for="from-unit"
          class="block text-sm font-medium mb-2"
          style="color: var(--color-text-secondary)"
        >
          From
        </label>
        <select
          id="from-unit"
          value={fromUnitId}
          on:change={handleFromUnitChange}
          class="w-full px-4 py-3 bg-input border border-input-border rounded-lg text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer"
          style="color: var(--color-text-primary);"
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
      <div class="flex justify-center">
        <button
          on:click={handleSwap}
          class="p-2 rounded-full bg-input border border-input-border hover:bg-input-border transition-colors"
          aria-label="Swap units"
          title="Swap units"
        >
          <SwapIcon size={20} style="color: var(--color-text-primary);" />
        </button>
      </div>

      <!-- To Unit -->
      <div>
        <label
          for="to-unit"
          class="block text-sm font-medium mb-2"
          style="color: var(--color-text-secondary)"
        >
          To
        </label>
        <select
          id="to-unit"
          value={toUnitId}
          on:change={handleToUnitChange}
          class="w-full px-4 py-3 bg-input border border-input-border rounded-lg text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 cursor-pointer"
          style="color: var(--color-text-primary);"
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
      <div class="pt-4 border-t" style="border-color: var(--color-input-border);">
        <div class="text-center">
          <p class="text-sm mb-2" style="color: var(--color-text-secondary)">Result</p>
          {#if compatible && amount && amountNum !== null && !isNaN(amountNum)}
            <p class="text-3xl font-bold" style="color: var(--color-text-primary)">
              {displayResult || '0'}
            </p>
            <p class="text-sm mt-1" style="color: var(--color-text-secondary)">
              {UNITS.find((u) => u.id === toUnitId)?.label || toUnitId}
            </p>
          {:else if amount && amountNum !== null && !isNaN(amountNum) && !compatible}
            <p class="text-sm" style="color: var(--color-text-secondary)">
              Units must be in the same category
            </p>
          {:else}
            <p
              class="text-2xl font-semibold"
              style="color: var(--color-text-secondary); opacity: 0.5;"
            >
              —
            </p>
          {/if}
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex gap-3 pt-2">
        <button
          on:click={handleReset}
          class="flex-1 px-4 py-2.5 bg-input border border-input-border rounded-lg text-primary hover:bg-input-border transition-colors font-medium"
          style="color: var(--color-text-primary);"
        >
          Reset
        </button>
      </div>
    </div>
  </div>

  <!-- Quick Presets -->
  <div>
    <h2 class="text-sm font-medium mb-3" style="color: var(--color-text-secondary)">
      Quick Presets
    </h2>
    <div class="quick-presets-grid">
      {#each presets as preset}
        <button
          on:click={() => handlePreset(preset)}
          class="w-full px-2.5 py-2 bg-input border border-input-border rounded-lg text-sm text-primary hover:bg-input-border transition-colors"
          style="color: var(--color-text-primary);"
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
    background-color: var(--color-bg-secondary, #fff);
  }
  .bg-input {
    background-color: var(--color-input-bg, #f5f5f5);
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
  .hover\:bg-input-border:hover {
    background-color: var(--color-input-border, #e5e5e5);
  }

  .quick-presets-grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 8px;
  }
</style>
