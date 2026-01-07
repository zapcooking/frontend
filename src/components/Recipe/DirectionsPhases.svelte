<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import type { DirectionPhase } from '$lib/parser';
  import ChevronDownIcon from 'phosphor-svelte/lib/CaretDown';
  import ChevronUpIcon from 'phosphor-svelte/lib/CaretUp';

  export let phases: DirectionPhase[];

  // Track expanded state for each phase
  let expandedPhases: Set<string> = new Set();
  
  // Initialize: first phase expanded by default
  $: if (phases.length > 0 && expandedPhases.size === 0) {
    expandedPhases = new Set([phases[0].id]);
  }

  // Handle URL hash on mount and when hash changes
  onMount(() => {
    if (browser) {
      // Check for hash on mount
      const hash = window.location.hash;
      if (hash) {
        const phaseId = hash.replace('#directions-', '');
        if (phases.some(p => p.id === phaseId)) {
          expandedPhases = new Set([phaseId]);
          // Scroll to the phase
          setTimeout(() => {
            const element = document.getElementById(`directions-${phaseId}`);
            if (element) {
              element.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }, 100);
        }
      }

      // Listen for hash changes
      const handleHashChange = () => {
        const hash = window.location.hash;
        if (hash) {
          const phaseId = hash.replace('#directions-', '');
          if (phases.some(p => p.id === phaseId)) {
            expandedPhases.add(phaseId);
            setTimeout(() => {
              const element = document.getElementById(`directions-${phaseId}`);
              if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }, 100);
          }
        }
      };

      window.addEventListener('hashchange', handleHashChange);
      return () => window.removeEventListener('hashchange', handleHashChange);
    }
  });

  function togglePhase(phaseId: string) {
    if (expandedPhases.has(phaseId)) {
      expandedPhases.delete(phaseId);
    } else {
      expandedPhases.add(phaseId);
    }
    expandedPhases = expandedPhases; // Trigger reactivity
  }

  function expandAll() {
    expandedPhases = new Set(phases.map(p => p.id));
  }

  function collapseAll() {
    expandedPhases = new Set();
  }

  function updateHash(phaseId: string) {
    if (browser) {
      window.history.replaceState(null, '', `#directions-${phaseId}`);
    }
  }

  function isExpanded(phaseId: string): boolean {
    return expandedPhases.has(phaseId);
  }
</script>

<div class="directions-phases">
  <div class="flex justify-between items-center mb-4">
    <h2 class="text-2xl font-bold">Directions</h2>
    <div class="flex gap-2">
      <button
        on:click={expandAll}
        class="text-sm text-caption hover:text-primary transition-colors px-2 py-1 rounded"
        aria-label="Expand all phases"
      >
        Expand all
      </button>
      <span class="text-caption">|</span>
      <button
        on:click={collapseAll}
        class="text-sm text-caption hover:text-primary transition-colors px-2 py-1 rounded"
        aria-label="Collapse all phases"
      >
        Collapse all
      </button>
    </div>
  </div>

  <div class="flex flex-col gap-3">
    {#each phases as phase (phase.id)}
      <div
        id="directions-{phase.id}"
        class="phase-container border border-input-border rounded-lg overflow-hidden transition-all"
      >
        <div>
          <button
            class="phase-header w-full flex justify-between items-center p-4 hover:bg-input-bg transition-colors text-left"
            on:click={() => {
              togglePhase(phase.id);
              updateHash(phase.id);
            }}
            aria-expanded={isExpanded(phase.id)}
            aria-controls="phase-content-{phase.id}"
          >
            <div class="flex flex-col gap-1 flex-1">
              <h3 class="font-semibold text-lg">{phase.title}</h3>
              <span class="text-sm text-caption">
                {phase.steps.length} {phase.steps.length === 1 ? 'step' : 'steps'}
              </span>
            </div>
            <div class="flex-shrink-0 ml-4">
              {#if isExpanded(phase.id)}
                <ChevronUpIcon size={20} class="text-caption" />
              {:else}
                <ChevronDownIcon size={20} class="text-caption" />
              {/if}
            </div>
          </button>

          {#if !isExpanded(phase.id) && phase.steps.length > 0}
            <!-- Preview: show first 1-2 steps when collapsed -->
            <div class="px-4 pb-4 text-caption opacity-50 space-y-1.5 text-sm">
              {#each phase.steps.slice(0, Math.min(2, phase.steps.length)) as step}
                <div class="flex gap-2">
                  <span class="font-medium opacity-70">{step.number}.</span>
                  <span>{step.text}</span>
                </div>
              {/each}
              {#if phase.steps.length > 2}
                <div class="text-xs italic opacity-60 mt-1">... and {phase.steps.length - 2} more {phase.steps.length - 2 === 1 ? 'step' : 'steps'}</div>
              {/if}
            </div>
          {/if}
        </div>

        <div
          id="phase-content-{phase.id}"
          class="phase-content overflow-hidden transition-all duration-300"
          style="max-height: {isExpanded(phase.id) ? '10000px' : '0px'}; opacity: {isExpanded(phase.id) ? '1' : '0'};"
        >
          <div class="p-4 pt-0">
            <!-- Full steps when expanded -->
            <ol class="space-y-3 list-none">
              {#each phase.steps as step}
                <li class="flex gap-3">
                  <span class="font-semibold text-primary flex-shrink-0">{step.number}.</span>
                  <span class="flex-1">{step.text}</span>
                </li>
              {/each}
            </ol>
          </div>
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .directions-phases {
    margin-top: 1.5rem;
  }

  .phase-container {
    background-color: var(--color-bg-secondary);
  }

  .phase-header {
    cursor: pointer;
    outline: none;
  }

  .phase-header:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: -2px;
  }

  .phase-content {
    will-change: max-height, opacity;
  }
</style>

