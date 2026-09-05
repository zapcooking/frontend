<script lang="ts">
  import FoodArt from './FoodArt.svelte';
  import { pantry, type Dish } from './service';
  export let dish: Dish;
</script>

<div
  class={`dish-visual serving-${dish.style}`}
  aria-label={`Dish preview: ${dish.ingredients.map((id) => pantry.find((f) => f.id === id)?.name).join(', ') || 'empty plate'}`}
>
  <div class="plate-surface">
    <div class="plated-foods">
      {#each dish.ingredients as id}<FoodArt {id} />{/each}{#if dish.garnish !== 'none'}<span
          class="plated-garnish"><FoodArt id={dish.garnish} /></span
        >{/if}
    </div>
    {#if !dish.ingredients.length}<span>＋</span>{/if}
  </div>
  <span
    >{dish.style === 'bowl' ? 'THE BOWL' : dish.style === 'toast' ? 'THE TOAST' : 'THE PLATE'}</span
  >
</div>
