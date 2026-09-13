<script lang="ts">
  import ArrowLeft from 'phosphor-svelte/lib/ArrowLeft';
  import BookOpen from 'phosphor-svelte/lib/BookOpen';
  import DotsThree from 'phosphor-svelte/lib/DotsThree';
  import Flame from 'phosphor-svelte/lib/Flame';
  import Check from 'phosphor-svelte/lib/Check';
  import Stars from './Stars.svelte';
  import type { Service } from '../service';
  export let service: Service;
  export let active = false;
  export let offline = false;
  export let saving = false;
  export let saved = false;
  export let onBook: () => void;
  export let onSettings: () => void;
  export let onLeave: (event: MouseEvent) => void;
  $: currentIndex =
    service.status === 'review' ? service.reviews.length - 1 : service.reviews.length;
  $: total = service.reviews.reduce((sum, r) => sum + r.score, 0);
</script>

<div class="hud-wrap">
  <header class="hud">
    <a class="back table-text" href="/explore" on:click={onLeave} aria-label="Back to Zap"
      ><ArrowLeft size={18} /><span>Zap</span></a
    >
    <a
      href="/cheffys-table"
      on:click|preventDefault={onSettings}
      class="wordmark"
      aria-label="Cheffy’s Table kitchen menu"
      >Cheffy’s <span>Table</span><small class:offline
        >{offline ? 'Offline · saves on device' : 'by Zap Cooking'}</small
      ></a
    >
    <div class="hud-actions">
      {#if active}<span class="score" aria-label={`${total} service points`}
          ><Flame size={19} weight="fill" /><b>{total.toLocaleString()}</b></span
        >{/if}
      <button
        class="table-icon book"
        on:click={onBook}
        aria-label="Service Book"
        title={saving ? 'Saving your service' : saved ? 'Your service is saved' : 'Service Book'}
        ><BookOpen size={23} />{#if saving}<i class="pending"></i>{:else if saved}<i
            ><Check size={9} weight="bold" /></i
          >{/if}</button
      >
      <button
        class="table-icon"
        on:click={onSettings}
        aria-label="Pause and kitchen settings"
        title="Kitchen settings"><DotsThree size={27} weight="bold" /></button
      >
    </div>
  </header>
  {#if active}<ol class="tickets" aria-label="Service tickets">
      {#each service.roster as guest, i}<li
          class:current={i === currentIndex}
          class:done={i < service.reviews.length}
          aria-current={i === currentIndex ? 'step' : undefined}
        >
          <span>{guest.name}</span>{#if service.reviews[i]}<Stars
              value={service.reviews[i].stars}
            />{:else}<small
              >{i === currentIndex
                ? 'At your table'
                : i === currentIndex + 1
                  ? 'Up next'
                  : 'Later'}</small
            >{/if}
        </li>{/each}
    </ol>{/if}
</div>

<style>
  .hud-wrap {
    position: sticky;
    top: 0;
    z-index: 25;
    background: var(--table-surface);
  }
  .hud {
    height: calc(64px + env(safe-area-inset-top, 0px));
    padding: env(safe-area-inset-top, 0px) 32px 0;
    display: flex;
    align-items: center;
    gap: 22px;
    border-bottom: 1px solid var(--table-line);
  }
  .back {
    font-size: 14px;
    padding-left: 0;
  }
  .wordmark {
    color: var(--table-ink);
    font-size: 20px;
    font-weight: 800;
    letter-spacing: -0.7px;
    line-height: 1.05;
    text-decoration: none;
  }
  .wordmark > span {
    color: var(--table-orange);
  }
  .wordmark small {
    display: block;
    color: var(--table-muted);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.7px;
    padding-top: 3px;
  }
  .wordmark small.offline {
    display: block;
    color: var(--table-warning);
    letter-spacing: 0;
    font-size: 11px;
  }
  .hud-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
  }
  .score {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    margin-right: 16px;
    font-variant-numeric: tabular-nums;
  }
  .score :global(svg) {
    color: var(--table-orange);
  }
  .score b {
    font-size: 22px;
  }
  .book {
    position: relative;
  }
  .book i {
    position: absolute;
    right: 3px;
    top: 5px;
    display: grid;
    place-items: center;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: var(--table-success);
    color: var(--table-raised);
  }
  .book i.pending {
    background: var(--table-warning);
    width: 7px;
    height: 7px;
  }
  .tickets {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    justify-content: center;
    gap: 26px;
    border-bottom: 1px solid var(--table-line);
    height: 52px;
  }
  .tickets li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 9px 22px;
    color: var(--table-muted);
    position: relative;
  }
  .tickets li.current::after {
    content: '';
    position: absolute;
    bottom: -1px;
    height: 3px;
    background: var(--table-orange);
    left: 0;
    right: 0;
  }
  .tickets span {
    font-weight: 700;
    font-size: 14px;
  }
  .tickets small {
    font-size: 12px;
  }
  .tickets .current {
    color: var(--table-ink);
  }
  .tickets .done {
    color: var(--table-success);
  }
  @media (max-width: 699px) {
    .hud {
      height: var(--table-hud);
      padding-inline: 14px;
      gap: 8px;
    }
    .back {
      width: 44px;
      min-width: 44px;
      padding: 0;
    }
    .back span {
      display: none;
    }
    .wordmark {
      font-size: 17px;
      white-space: nowrap;
    }
    .wordmark small {
      display: none;
    }
    .hud-actions {
      gap: 0;
    }
    .score {
      margin: 0 6px 0 0;
      gap: 3px;
    }
    .score b {
      font-size: 17px;
    }
    .score :global(svg) {
      width: 15px;
    }
    .hud-actions .table-icon {
      flex-basis: 44px;
      width: 44px;
    }
    .tickets {
      height: 45px;
      gap: 0;
    }
    .tickets li {
      width: 33.333%;
      padding: 5px 8px;
      flex-direction: column;
      justify-content: center;
      gap: 0;
    }
    .tickets span {
      font-size: 12px;
    }
    .tickets small {
      font-size: 11px;
    }
    .tickets :global(.stars svg) {
      width: 11px;
      height: 11px;
    }
  }
</style>
