<script lang="ts">
  import DishVisual from '../DishVisual.svelte';
  import FoodArt from '../FoodArt.svelte';
  import { styles, emptyDish, type Dish, type Garnish } from '../service';
  import Check from 'phosphor-svelte/lib/Check';
  export let dish: Dish;
  export let onChange: (change: Partial<Dish>) => void;
  const garnishes: { id: Garnish; name: string }[] = [
    { id: 'none', name: 'As it is' },
    { id: 'lemon', name: 'Lemon' },
    { id: 'parmesan', name: 'Parmesan' },
    { id: 'basil', name: 'Basil' },
    { id: 'chili', name: 'Chili' }
  ];
</script>

<h2 class="stage-title" tabindex="-1">Make it yours.</h2>
<p class="stage-description">The last little decisions make the dish.</p>
<div class="vessels" role="group" aria-label="Serving style">
  {#each styles as style}<button
      class:selected={dish.style === style.id}
      aria-pressed={dish.style === style.id}
      on:click={() => onChange({ style: style.id })}
      ><DishVisual
        dish={{
          ...emptyDish(),
          style: style.id,
          ingredients: style.id === 'toast' ? ['bread'] : []
        }}
        decorative
      /><strong>{style.id === 'plate' ? 'Composed' : style.name}</strong></button
    >{/each}
</div>
<div class="section-label">
  <h3>A finishing touch</h3>
  <span>Optional. Be intentional.</span>
</div>
<div class="garnishes" role="group" aria-label="Garnish">
  {#each garnishes as garnish}<button
      aria-pressed={dish.garnish === garnish.id}
      class:selected={dish.garnish === garnish.id}
      on:click={() => onChange({ garnish: garnish.id })}
    >
      {#if garnish.id === 'none'}<span class="no-garnish"><Check size={24} /></span>{:else}<FoodArt
          id={garnish.id}
        />{/if}<span>{garnish.name}</span>
    </button>{/each}
</div>
<h3 class="finish-title">When does it go on?</h3>
<div class="finishing" role="group" aria-label="Finishing time">
  <button aria-pressed={dish.finish === 'last'} on:click={() => onChange({ finish: 'last' })}
    ><span class="finish-dot"></span>
    <div><strong>Finish fresh</strong><small>Add toppings just before serving.</small></div></button
  ><button aria-pressed={dish.finish === 'early'} on:click={() => onChange({ finish: 'early' })}
    ><span class="finish-dot"></span>
    <div>
      <strong>Cook it in</strong><small>Let toppings mingle with everything.</small>
    </div></button
  >
</div>
{#if dish.style === 'toast' && !dish.ingredients.includes('bread')}<p class="gentle-note">
    A little thought from Cheffy: toast starts with sourdough.
  </p>{/if}

<style>
  .vessels {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    margin: 22px 0 28px;
  }
  .vessels button {
    padding: 8px 10px 15px;
    border: 2px solid transparent;
    border-radius: 20px;
    background: var(--table-raised);
    color: var(--table-ink);
  }
  .vessels button.selected {
    border-color: var(--table-orange);
    background: var(--table-warm);
  }
  .vessels strong {
    font-size: 14px;
  }
  .vessels :global(.dish) {
    margin-bottom: 8px;
  }
  h3 {
    font-size: 16px;
    font-weight: 700;
  }
  .section-label {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    align-items: center;
  }
  .section-label > span {
    font-size: 12px;
    color: var(--table-muted);
  }
  .garnishes {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px;
    margin: 15px 0 24px;
  }
  .garnishes button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    border: 2px solid transparent;
    border-radius: 15px;
    background: #faf7ed;
    color: #313a30;
    padding: 4px 2px 10px;
    --food-size: 100%;
  }
  .garnishes button.selected {
    border-color: #547459;
    background: #eaf0da;
  }
  .garnishes button > span {
    font-size: 12px;
  }
  .garnishes :global(.food-art) {
    mix-blend-mode: multiply;
  }
  .no-garnish {
    width: 100%;
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    color: #747f68;
  }
  .finish-title {
    margin-bottom: 12px;
  }
  .finishing {
    display: flex;
    gap: 10px;
  }
  .finishing button {
    flex: 1;
    display: flex;
    text-align: left;
    align-items: center;
    gap: 10px;
    padding: 15px 12px;
    border: 1px solid var(--table-line);
    background: transparent;
    color: var(--table-ink);
    border-radius: 13px;
  }
  .finishing button[aria-pressed='true'] {
    background: var(--table-raised);
    border-color: var(--table-success);
  }
  .finish-dot {
    width: 16px;
    height: 16px;
    border: 1px solid var(--table-muted);
    border-radius: 50%;
    flex-shrink: 0;
  }
  .finishing button[aria-pressed='true'] .finish-dot {
    border: 5px solid var(--table-success);
  }
  .finishing strong {
    font-size: 14px;
  }
  .finishing small {
    display: block;
    font-size: 12px;
    color: var(--table-muted);
    margin-top: 3px;
  }
  .gentle-note {
    color: var(--table-warning);
    font-size: 13px;
    margin-top: 18px;
  }
  @media (max-width: 699px) {
    .vessels {
      gap: 8px;
      margin: 16px 0 22px;
    }
    .vessels button {
      padding: 6px 6px 12px;
    }
    .garnishes {
      gap: 6px;
    }
    .section-label > span {
      font-size: 11px;
    }
    .finishing {
      flex-direction: column;
    }
    .finishing button {
      padding: 12px;
    }
  }
</style>
