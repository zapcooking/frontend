<script lang="ts">
  import Fire from 'phosphor-svelte/lib/Fire';
  import CookingPot from 'phosphor-svelte/lib/CookingPot';
  import Wind from 'phosphor-svelte/lib/Wind';
  import Leaf from 'phosphor-svelte/lib/Leaf';
  import Timer from 'phosphor-svelte/lib/Timer';
  import { methods, prepTime, type Dish, type Customer } from '../service';
  export let dish: Dish;
  export let customer: Customer;
  export let onHelp: () => void;
  export let onChange: (change: Partial<Dish>) => void;
  const icons = { saute: CookingPot, roast: Fire, steam: Wind, assemble: Leaf };
  const hints = {
    saute: 'Quick heat. Stay curious.',
    roast: 'Give browning a little room.',
    steam: 'Keep it gentle.',
    assemble: 'Fresh layers. A little contrast.'
  };
</script>

<h2 class="stage-title" tabindex="-1">Bring it to life.</h2>
<p class="stage-description">A little heat changes everything. Or keep it fresh.</p>
<div class="methods" role="group" aria-label="Cooking method">
  {#each methods as m}<button
      class:selected={dish.cook === m.id}
      aria-pressed={dish.cook === m.id}
      on:click={() => onChange({ cook: m.id })}
    >
      <span class="method-icon" data-method={m.id}
        ><svelte:component this={icons[m.id]} size={37} weight="duotone" /></span
      ><strong>{m.name}</strong><small
        >{m.id === 'saute'
          ? 'Fast, direct heat'
          : m.id === 'roast'
            ? 'Slow browning'
            : m.id === 'steam'
              ? 'Gentle & tender'
              : 'Fresh & layered'}</small
      >
    </button>{/each}
</div>
<div class="timer" data-method={dish.cook}>
  <div class="timer-top">
    <span><Timer size={20} />Your kitchen timer</span><span>{hints[dish.cook]}</span>
  </div>
  <div class="dial">
    <div class="ticks" aria-hidden="true"></div>
    <output for="cook-time">{dish.time}<small>kitchen min</small></output>
  </div>
  <label for="cook-time" class="screen-reader">Cooking time in kitchen minutes</label><input
    id="cook-time"
    type="range"
    min="2"
    max="20"
    step="1"
    value={dish.time}
    on:input={(e) => onChange({ time: Number(e.currentTarget.value) })}
  />
  <div class="range-ends"><span>Quick</span><span>Take your time</span></div>
  <div class="patience">
    <span
      >Prep + cook + finish<strong class:over={prepTime(dish) > customer.patience}
        >{prepTime(dish)} min</strong
      ></span
    ><span>{customer.name} can wait<strong>{customer.patience} min</strong></span>
  </div>
</div>
<p class="simulation">
  Kitchen minutes are game time. <button class="table-text" on:click={onHelp}>About timing</button>
</p>

<style>
  .methods {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    margin: 24px 0;
  }
  .methods button {
    border: 2px solid transparent;
    background: var(--table-raised);
    border-radius: 17px;
    padding: 16px 4px 13px;
    display: flex;
    flex-direction: column;
    align-items: center;
    color: var(--table-ink);
    gap: 7px;
  }
  .methods button.selected {
    border-color: var(--table-orange);
    background: var(--table-warm);
  }
  .method-icon {
    height: 51px;
    display: grid;
    place-items: center;
    color: var(--table-warning);
  }
  .methods strong {
    font-size: 14px;
  }
  .methods small {
    font-size: 11px;
    color: var(--table-muted);
    text-align: center;
  }
  .timer {
    padding: 22px 26px;
    border-radius: 26px;
    background: var(--table-pantry);
  }
  .timer-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 15px;
    font-size: 12px;
    color: var(--table-muted);
  }
  .timer-top > span:first-child {
    color: var(--table-ink);
    font-weight: 650;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .timer-top > span:last-child {
    max-width: 135px;
    text-align: right;
  }
  .dial {
    width: 158px;
    height: 158px;
    margin: 22px auto;
    border-radius: 50%;
    position: relative;
    display: grid;
    place-items: center;
    background: var(--table-raised);
    box-shadow:
      0 7px 0 -2px var(--table-line),
      0 12px 19px var(--table-shadow);
  }
  .ticks {
    position: absolute;
    inset: 7px;
    border-radius: 50%;
    border: 2px dashed var(--table-line);
  }
  .dial output {
    font-size: 56px;
    font-weight: 750;
    line-height: 1;
    text-align: center;
    letter-spacing: -2px;
    font-variant-numeric: tabular-nums;
  }
  .dial small {
    display: block;
    font-size: 12px;
    letter-spacing: 0;
    color: var(--table-muted);
    margin-top: 6px;
    font-weight: 500;
  }
  input {
    width: 100%;
    min-height: 44px;
    accent-color: var(--table-orange);
    cursor: ew-resize;
  }
  .range-ends {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: var(--table-muted);
  }
  .patience {
    display: flex;
    justify-content: space-between;
    border-top: 1px solid var(--table-line);
    margin-top: 20px;
    padding-top: 17px;
    gap: 20px;
    font-size: 12px;
    color: var(--table-muted);
  }
  .patience > span:last-child {
    text-align: right;
  }
  .patience strong {
    display: block;
    font-size: 22px;
    color: var(--table-ink);
    margin-top: 2px;
  }
  .patience strong.over {
    color: var(--table-warning);
  }
  .simulation {
    margin-top: 10px;
    font-size: 12px;
    color: var(--table-muted);
  }
  .simulation .table-text {
    font-size: 12px;
    text-decoration: underline;
    padding-inline: 4px;
  }
  @media (max-width: 699px) {
    .methods {
      gap: 7px;
      margin: 18px 0;
    }
    .methods button {
      padding: 10px 4px;
    }
    .methods small {
      font-size: 11px;
    }
    .method-icon {
      height: 40px;
    }
    .timer {
      padding: 17px 20px;
    }
    .dial {
      width: 128px;
      height: 128px;
      margin: 15px auto;
    }
    .dial output {
      font-size: 44px;
    }
    .timer-top > span:last-child {
      display: none;
    }
  }
</style>
