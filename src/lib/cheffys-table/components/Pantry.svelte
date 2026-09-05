<script lang="ts">
  import { onDestroy } from 'svelte';
  import FoodArt from '../FoodArt.svelte';
  import { pantry, type Dish, type Role } from '../service';
  import SquaresFour from 'phosphor-svelte/lib/SquaresFour';
  import Leaf from 'phosphor-svelte/lib/Leaf';
  import Egg from 'phosphor-svelte/lib/Egg';
  import BowlFood from 'phosphor-svelte/lib/BowlFood';
  import Flame from 'phosphor-svelte/lib/Flame';
  import Sparkle from 'phosphor-svelte/lib/Sparkle';
  import Check from 'phosphor-svelte/lib/Check';
  export let dish: Dish;
  export let onToggle: (id: string) => void;
  export let onInspect: (id: string) => void;
  let filter: Role | 'all' = 'all';
  const filters = [
    { id: 'all', name: 'All', icon: SquaresFour },
    { id: 'vegetable', name: 'Veg', icon: Leaf },
    { id: 'protein', name: 'Protein', icon: Egg },
    { id: 'base', name: 'Base', icon: BowlFood },
    { id: 'aromatic', name: 'Flavor', icon: Flame },
    { id: 'finish', name: 'Finish', icon: Sparkle }
  ] as const;
  let hold: ReturnType<typeof setTimeout> | undefined,
    held = false,
    startX = 0,
    startY = 0;
  function clear() {
    if (hold) clearTimeout(hold);
  }
  function down(e: PointerEvent, id: string) {
    clear();
    held = false;
    startX = e.clientX;
    startY = e.clientY;
    hold = setTimeout(() => {
      held = true;
      onInspect(id);
    }, 550);
  }
  function move(e: PointerEvent) {
    if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > 10) clear();
  }
  function select(id: string) {
    clear();
    if (!held) onToggle(id);
    held = false;
  }
  function drag(e: DragEvent, id: string) {
    clear();
    e.dataTransfer?.setData('text/plain', `cheffys-table:${id}`);
  }
  onDestroy(clear);
</script>

<div class="pantry-title">
  <div>
    <h2 class="stage-title" tabindex="-1">What’s your idea?</h2>
    <p class="stage-description">Choose 3–6 ingredients. Make them count.</p>
  </div>
  <span>{dish.ingredients.length}<small>/6</small></span>
</div>
<div class="filters" role="group" aria-label="Pantry categories">
  {#each filters as f}<button on:click={() => (filter = f.id)} aria-pressed={filter === f.id}
      ><svelte:component this={f.icon} size={17} />{f.name}</button
    >{/each}
</div>
<p class="screen-reader" id="pantry-instructions">
  Tap or press Enter to add or remove an ingredient. Hold, or press I, to read its note. Dragging to
  your dish is optional.
</p>
<div class="pantry-grid">
  {#each pantry.filter((f) => filter === 'all' || f.role === filter) as food (food.id)}
    <button
      class="ingredient-tile"
      class:chosen={dish.ingredients.includes(food.id)}
      aria-pressed={dish.ingredients.includes(food.id)}
      aria-label={`${dish.ingredients.includes(food.id) ? 'Remove' : 'Add'} ${food.name}`}
      aria-describedby="pantry-instructions"
      draggable="true"
      on:dragstart={(e) => drag(e, food.id)}
      on:click={() => select(food.id)}
      on:pointerdown={(e) => down(e, food.id)}
      on:pointermove={move}
      on:pointerup={clear}
      on:pointercancel={clear}
      on:contextmenu|preventDefault={() => onInspect(food.id)}
      on:keydown={(e) => {
        if (e.key.toLowerCase() === 'i' || e.key === '?') {
          e.preventDefault();
          onInspect(food.id);
        }
      }}
    >
      <div class="art"><FoodArt id={food.id} /></div>
      <span>{food.name}</span>{#if dish.ingredients.includes(food.id)}<i
          ><Check size={13} weight="bold" /></i
        >{/if}
    </button>
  {/each}
</div>
<button class="note-link table-text" on:click={() => onInspect(dish.ingredients.at(-1) || 'tomato')}
  >Curious about an ingredient? Hold for a note.</button
>

<style>
  .pantry-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .pantry-title > span {
    font-size: 25px;
    font-weight: 700;
  }
  .pantry-title small {
    font-size: 14px;
    color: var(--table-muted);
    font-weight: 500;
  }
  .filters {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    padding: 6px 2px 10px;
    margin: 17px -2px 6px;
    scrollbar-width: none;
  }
  .filters::-webkit-scrollbar {
    display: none;
  }
  .filters button {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 5px;
    min-height: 44px;
    padding: 7px 10px;
    border: 0;
    border-radius: 10px;
    color: var(--table-muted);
    background: transparent;
    font-size: 13px;
  }
  .filters button[aria-pressed='true'] {
    background: var(--table-ink);
    color: var(--table-surface);
  }
  .pantry-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
  }
  .ingredient-tile {
    background: #faf7ed;
    color: #313a30;
    border: 2px solid transparent;
    border-radius: 17px;
    padding: 4px 4px 10px;
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
    box-shadow: 0 3px 0 #b1ae952c;
    transition:
      transform 0.16s,
      box-shadow 0.16s,
      border-color 0.16s;
    touch-action: pan-y;
  }
  .art {
    width: min(100%, 96px);
    --food-size: 100%;
    mix-blend-mode: multiply;
    pointer-events: none;
  }
  .ingredient-tile > span {
    font-size: 12px;
    line-height: 1.2;
    min-height: 28px;
    display: grid;
    align-items: center;
    font-weight: 650;
  }
  .ingredient-tile.chosen {
    border-color: #547459;
    background: #edf0dc;
    box-shadow: 0 3px 0 #547459;
  }
  .ingredient-tile i {
    position: absolute;
    top: 6px;
    right: 6px;
    border-radius: 50%;
    padding: 3px;
    background: #547459;
    color: white;
  }
  .note-link {
    width: 100%;
    font-size: 12px;
    color: var(--table-muted);
    margin-top: 10px;
    text-align: center;
  }
  @media (hover: hover) {
    .ingredient-tile:hover {
      transform: translateY(-4px) rotate(-1deg);
      box-shadow: 0 7px 0 #b1ae9528;
    }
    .filters button:hover {
      box-shadow: inset 0 0 0 1px var(--table-line);
    }
  }
  @media (min-width: 1200px) {
    .pantry-grid {
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 12px;
    }
  }
  @media (max-width: 699px) {
    .pantry-grid {
      gap: 9px;
    }
    .filters {
      margin-top: 10px;
    }
    .ingredient-tile {
      border-radius: 13px;
      padding-bottom: 6px;
    }
    .ingredient-tile > span {
      font-size: 12px;
    }
    .note-link {
      padding-inline: 0;
      font-size: 12px;
    }
  }
</style>
