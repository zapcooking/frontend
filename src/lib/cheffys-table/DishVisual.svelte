<script lang="ts">
  import FoodArt from './FoodArt.svelte';
  import PlatedFood from './components/PlatedFood.svelte';
  import { pantry, styles, type Dish } from './service';
  export let dish: Dish;
  export let cooking = false;
  export let sending = false;
  export let decorative = false;
  // Deterministic composition is visual only; it never changes the chosen ingredients.
  const positions = {
    bowl: [
      [38, 34, -14],
      [61, 35, 18],
      [36, 56, -20],
      [61, 57, 12],
      [47, 70, 5],
      [51, 48, -8]
    ],
    toast: [
      [43, 34, -10],
      [59, 40, 14],
      [38, 53, -17],
      [57, 59, 12],
      [45, 67, -8],
      [58, 28, 15]
    ],
    plate: [
      [33, 34, -16],
      [65, 36, 16],
      [34, 63, -12],
      [65, 62, 20],
      [50, 47, 0],
      [50, 74, -9]
    ]
  };
  $: foods = dish.ingredients.filter(
    (id) => id !== 'oil' && !(dish.style === 'toast' && id === 'bread')
  );
  $: description = dish.ingredients
    .map((id) => pantry.find((food) => food.id === id)?.name)
    .filter(Boolean)
    .join(', ');
  $: vesselName = styles.find((style) => style.id === dish.style)?.name || 'Dish';
  $: garnishName = pantry.find((food) => food.id === dish.garnish)?.name;
</script>

<div
  class="dish"
  class:cooking
  class:sending
  data-vessel={dish.style}
  role={decorative ? undefined : 'img'}
  aria-hidden={decorative ? 'true' : undefined}
  aria-label={decorative
    ? undefined
    : `${vesselName}${description ? ` with ${description}` : ' (empty)'}${garnishName ? `, finished with ${garnishName}` : ''}`}
>
  <div class="vessel">
    <div class="inner-ring"></div>
    {#if dish.ingredients.includes('oil')}<div class="oil-finish" aria-hidden="true"></div>{/if}
    {#if dish.style === 'toast' && dish.ingredients.includes('bread')}<div class="toast-base">
        <FoodArt id="bread" />
      </div>{/if}
    {#each foods as id, i (id)}
      <div
        class="ingredient"
        style={`--x:${positions[dish.style][i][0]}%;--y:${positions[dish.style][i][1]}%;--angle:${positions[dish.style][i][2]}deg;--layer:${i + 1}`}
      >
        <PlatedFood {id} />
      </div>
    {/each}
    {#if dish.garnish !== 'none'}{#key dish.garnish}<div class="garnish">
          <PlatedFood id={dish.garnish} garnish />
        </div>{/key}{/if}
    {#if !dish.ingredients.length && !decorative}<div class="empty">
        <span>Something good<br />starts here.</span>
      </div>{/if}
  </div>
  {#if cooking && dish.cook !== 'assemble'}<div class="steam" aria-hidden="true">
      <i></i><i></i><i></i>
    </div>{/if}
</div>

<style>
  .dish {
    width: 100%;
    aspect-ratio: 1.1;
    position: relative;
    transition: transform 0.4s;
  }
  .vessel {
    position: absolute;
    inset: 7% 2%;
    border-radius: 50%;
    background: var(--table-plate);
    border: 2px solid var(--table-plate-edge);
    box-shadow:
      inset 0 -8px 8px #79725416,
      0 12px 0 -6px var(--table-plate-edge),
      0 22px 28px -9px #30281045;
    transition:
      border-radius 0.4s,
      inset 0.4s;
  }
  .inner-ring {
    position: absolute;
    inset: 11%;
    border: 1px solid #99907c42;
    border-radius: inherit;
    box-shadow: inset 0 3px 9px #6a634318;
  }
  [data-vessel='bowl'] .vessel {
    inset: 8% 3%;
    border-width: 7px;
    box-shadow:
      inset 0 0 28px #655b3733,
      0 15px 0 -7px var(--table-plate-edge),
      0 22px 28px -9px #30281045;
  }
  [data-vessel='toast'] .vessel {
    inset: 10% 8%;
    border-radius: 34% 34% 24% 24%;
    transform: rotate(-6deg);
  }
  .ingredient {
    position: absolute;
    width: 35%;
    left: var(--x);
    top: var(--y);
    z-index: var(--layer);
    --food-size: 100%;
    transform: translate(-50%, -50%) rotate(var(--angle));
    mix-blend-mode: multiply;
    animation: land 0.38s cubic-bezier(0.17, 0.67, 0.32, 1.2) both;
  }
  .oil-finish {
    position: absolute;
    inset: 24%;
    border: 3px solid #d7b63877;
    border-radius: 41% 57% 49% 55%;
    transform: rotate(12deg);
    box-shadow: 0 0 8px #e9c43a44;
  }
  .toast-base {
    position: absolute;
    width: 85%;
    left: 8%;
    top: 8%;
    --food-size: 100%;
    mix-blend-mode: multiply;
  }
  [data-vessel='toast'] .ingredient {
    width: 32%;
  }
  .garnish {
    position: absolute;
    width: 30%;
    left: 42%;
    top: 43%;
    z-index: 8;
    --food-size: 100%;
    mix-blend-mode: multiply;
    transform: rotate(22deg);
    animation: finish 0.5s ease-out both;
  }
  .empty {
    position: absolute;
    inset: 20%;
    display: grid;
    place-items: center;
    text-align: center;
    color: #898373;
    font-size: clamp(12px, 1.4vw, 17px);
    line-height: 1.4;
  }
  .steam {
    position: absolute;
    display: flex;
    gap: 12%;
    width: 30%;
    height: 22%;
    top: 0;
    left: 35%;
    pointer-events: none;
  }
  .steam i {
    width: 10%;
    border-radius: 50%;
    background: var(--table-muted);
    filter: blur(2px);
    opacity: 0;
    animation: steam 1.5s ease-out 2;
  }
  .steam i:nth-child(2) {
    animation-delay: 0.25s;
  }
  .steam i:nth-child(3) {
    animation-delay: 0.5s;
  }
  .sending {
    animation: send 0.85s ease-in both;
  }
  @keyframes land {
    from {
      opacity: 0;
      transform: translate(-50%, -110%) rotate(calc(var(--angle) - 16deg)) scale(1.25);
    }
    to {
      opacity: 1;
      transform: translate(-50%, -50%) rotate(var(--angle)) scale(1);
    }
  }
  @keyframes finish {
    from {
      opacity: 0;
      transform: translateY(-45px) rotate(-20deg) scale(1.3);
    }
    to {
      opacity: 1;
      transform: translateY(0) rotate(22deg);
    }
  }
  @keyframes send {
    35% {
      transform: scale(0.98) translateY(8px);
    }
    to {
      opacity: 0;
      transform: translateY(-65px) scale(0.8);
    }
  }
  @keyframes steam {
    20% {
      opacity: 0.18;
    }
    to {
      transform: translateY(-22px) scaleX(1.8);
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dish,
    .vessel {
      transition: none;
    }
    .ingredient,
    .garnish,
    .sending,
    .steam i {
      animation: none;
    }
  }
</style>
