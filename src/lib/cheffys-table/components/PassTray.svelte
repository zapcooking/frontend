<script lang="ts">
  import DishVisual from '../DishVisual.svelte';
  import FoodArt from '../FoodArt.svelte';
  import ArrowRight from 'phosphor-svelte/lib/ArrowRight';
  import Info from 'phosphor-svelte/lib/Info';
  import X from 'phosphor-svelte/lib/X';
  import { pantry, methods, prepTime, type Dish, type Customer } from '../service';
  import type { Phase } from '../presentation';
  export let dish: Dish;
  export let customer: Customer;
  export let phase: Phase;
  export let disabled = false;
  export let onToggle: (id: string) => void;
  export let onInspect: (id: string) => void;
  export let onNext: () => void;
  export let onBack: () => void;
  $: next =
    phase === 'pantry' ? 'To the stove' : phase === 'cook' ? 'Plate it' : `Serve ${customer.name}`;
  function drop(e: DragEvent) {
    const data = e.dataTransfer?.getData('text/plain');
    if (data?.startsWith('cheffys-table:')) {
      const id = data.slice('cheffys-table:'.length);
      if (!dish.ingredients.includes(id)) onToggle(id);
    }
  }
</script>

<aside
  class="pass"
  aria-label="Your dish and next action"
  on:dragover|preventDefault
  on:drop|preventDefault={drop}
>
  <div class="pass-heading">
    <span class="eyebrow">On your pass</span><span>{dish.ingredients.length}/6 ingredients</span>
  </div>
  <div class="food-display"><DishVisual {dish} cooking={phase === 'cook'} /></div>
  <div class="dish-description">
    <strong class="mobile-title"
      >{phase === 'pantry'
        ? `${dish.ingredients.length}/6 on your board`
        : phase === 'cook'
          ? `${methods.find((m) => m.id === dish.cook)?.name} · ${dish.time} kitchen min`
          : `${dish.style === 'toast' ? 'On toast' : dish.style === 'bowl' ? 'Bowl' : 'Composed'} · ${dish.garnish === 'none' ? 'As it is' : dish.garnish}`}</strong
    >
    <strong
      >{phase === 'pantry'
        ? 'A plate of possibility'
        : `${methods.find((m) => m.id === dish.cook)?.name} · ${dish.style === 'toast' ? 'On toast' : dish.style === 'bowl' ? 'Bowl' : 'Composed'}`}</strong
    ><span>{prepTime(dish)} kitchen min · for {customer.name}</span>
  </div>
  <div class="board" role="group" aria-label="Selected ingredients">
    {#each dish.ingredients as id (id)}<button
        on:click={() => onToggle(id)}
        aria-label={`Remove ${pantry.find((f) => f.id === id)?.name} from your board`}
        title={`Remove ${pantry.find((f) => f.id === id)?.name}`}
        ><FoodArt {id} /><i><X size={9} /></i></button
      >{/each}
    {#if !dish.ingredients.length}<span class="empty-board">Your good idea goes here.</span>{/if}
    {#if dish.ingredients.length}<button
        class="inspect"
        on:click={() => onInspect(dish.ingredients.at(-1) || 'tomato')}
        aria-label="Inspect selected ingredient"
        title="Ingredient notes"><Info size={20} /></button
      >{/if}
  </div>
  <div class="pass-action">
    <button class="table-primary" {disabled} on:click={onNext}
      >{dish.ingredients.length < 3 ? `Pick ${3 - dish.ingredients.length} more` : next}<ArrowRight
        size={19}
      /></button
    >{#if phase !== 'pantry'}<button class="back table-text" on:click={onBack}>Back</button>{/if}
  </div>
  <p class="pass-tip">
    {dish.ingredients.length < 3
      ? 'Start with a centerpiece. Add a little contrast.'
      : dish.ingredients.length === 6
        ? 'A full board. Make every ingredient earn its place.'
        : 'Simple can be spectacular. Complexity is a risk.'}
  </p>
</aside>

<style>
  .pass {
    position: sticky;
    top: 142px;
    padding: 6px 0 0 15px;
    text-align: center;
    min-width: 0;
  }
  .pass-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
  }
  .pass-heading > span:last-child {
    font-size: 12px;
    color: var(--table-muted);
  }
  .food-display {
    margin: 24px -5px 7px;
  }
  .dish-description .mobile-title {
    display: none;
  }
  .dish-description strong {
    font-size: 19px;
    font-weight: 750;
    letter-spacing: -0.4px;
    display: block;
  }
  .dish-description > span {
    color: var(--table-muted);
    display: block;
    font-size: 12px;
    margin-top: 6px;
  }
  .board {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 5px;
    min-height: 55px;
    margin: 19px 0;
  }
  .board button {
    --food-size: 43px;
    padding: 0;
    position: relative;
    border: 0;
    border-radius: 12px;
    background: #faf7ed;
    color: #27362c;
    min-width: 44px;
    height: 44px;
  }
  .board button i {
    position: absolute;
    right: 0;
    top: -1px;
    border-radius: 50%;
    background: var(--table-ink);
    color: var(--table-raised);
    padding: 2px;
  }
  .board .inspect {
    display: grid;
    place-items: center;
    background: transparent;
    color: var(--table-muted);
  }
  .empty-board {
    color: var(--table-muted);
    font-size: 13px;
  }
  .pass-action {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .table-primary {
    width: 100%;
  }
  .back {
    font-size: 13px;
  }
  .pass-tip {
    font-size: 13px;
    color: var(--table-muted);
    margin: 16px 12px;
  }
  @media (max-width: 1100px) and (min-width: 700px) {
    .pass {
      top: 140px;
      padding-left: 0;
    }
  }
  @media (max-width: 699px) {
    .pass {
      position: fixed;
      bottom: 0;
      top: auto;
      left: 0;
      right: 0;
      z-index: 35;
      border-top: 1px solid var(--table-line);
      background: var(--table-raised);
      box-shadow: 0 -10px 30px var(--table-shadow);
      padding: 8px 16px calc(12px + env(safe-area-inset-bottom, 0px));
      display: grid;
      grid-template-columns: 78px minmax(0, 1fr);
      grid-template-rows: 24px 49px 46px;
      column-gap: 12px;
      row-gap: 7px;
    }
    .pass-heading {
      display: none;
    }
    .food-display {
      margin: 0;
      width: 80px;
      align-self: center;
      grid-row: 1/3;
    }
    .food-display :global(.empty span) {
      display: none;
    }
    .dish-description {
      text-align: left;
      align-self: center;
      overflow: hidden;
    }
    .dish-description > strong:not(.mobile-title) {
      display: none;
    }
    .dish-description .mobile-title {
      display: block;
    }
    .dish-description strong {
      font-size: 13px;
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
    }
    .dish-description > span {
      display: none;
    }
    .board {
      margin: 0;
      min-height: 0;
      flex-wrap: nowrap;
      justify-content: start;
      overflow-x: auto;
      padding: 3px 1px;
      scrollbar-width: none;
      gap: 4px;
    }
    .board button {
      flex: 0 0 44px;
      --food-size: 40px;
    }
    .board .inspect {
      display: none;
    }
    .pass-action {
      grid-column: 1/-1;
      flex-direction: row-reverse;
      gap: 12px;
    }
    .pass-action .table-primary {
      flex: 1;
      padding: 10px 14px;
      font-size: 15px;
    }
    .pass-action .back {
      min-width: 44px;
      padding: 8px 6px;
    }
    .pass-tip {
      display: none;
    }
  }
</style>
