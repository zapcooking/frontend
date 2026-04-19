<script lang="ts">
  import type { DirectionPhase } from '$lib/parser';

  export let phases: DirectionPhase[];

  // Directions are no longer grouped into phases — render every step as a
  // single flat numbered list. Prop shape kept for call-site compatibility.
  $: steps = phases.flatMap((p) => p.steps);
</script>

{#if steps.length > 0}
  <div class="directions-phases">
    <h2 class="text-2xl font-bold mb-4">Directions</h2>
    <div id="directions" class="rounded-lg border border-input-border p-4" style="background-color: var(--color-bg-secondary);">
      <ol class="space-y-3 list-none">
        {#each steps as step}
          <li class="flex gap-3">
            <span class="font-semibold text-primary flex-shrink-0">{step.number}.</span>
            <span class="flex-1">{step.text}</span>
          </li>
        {/each}
      </ol>
    </div>
  </div>
{/if}

<style>
  .directions-phases {
    margin-top: 1.5rem;
  }
</style>
