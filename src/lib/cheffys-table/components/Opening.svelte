<script lang="ts">
  import DishVisual from '../DishVisual.svelte';
  import CheffyCoach from './CheffyCoach.svelte';
  import ArrowRight from 'phosphor-svelte/lib/ArrowRight';
  import Sun from 'phosphor-svelte/lib/Sun';
  import type { Dish } from '../service';
  export let onStart: (mode: 'service' | 'daily') => void;
  export let ready = false;
  export let dailyBest = 0;
  export let date: string;
  const hero: Dish = {
    ingredients: ['rice', 'tomato', 'chickpeas', 'broccoli', 'oil'],
    cook: 'roast',
    time: 14,
    style: 'bowl',
    garnish: 'basil',
    finish: 'last'
  };
</script>

<section class="opening">
  <div class="invitation">
    <div class="eyebrow">A little kitchen. A lot of possibility.</div>
    <h1 class="stage-title" tabindex="-1">Good food.<br />Your <em>call.</em></h1>
    <p class="intro">Three guests. One pantry.<br />No perfect recipe.</p>
    <p class="sub">
      Build a dish, trust your instincts, and see what<br class="desktop-break" /> comes back from the
      table.
    </p>
    <button class="table-primary start" disabled={!ready} on:click={() => onStart('service')}
      >{ready ? 'Open the kitchen' : 'Setting the table…'}<ArrowRight size={21} /></button
    >
    <div class="daily">
      <span class="daily-icon"><Sun size={28} weight="duotone" /></span>
      <div>
        <strong>Today’s Table</strong>
        <p>
          {date} · Same guests for everyone{dailyBest
            ? ` · Best ${dailyBest.toLocaleString()}`
            : ''}
        </p>
      </div>
      <button
        class="table-icon"
        disabled={!ready}
        on:click={() => onStart('daily')}
        aria-label="Play Today’s Table"
        title="Play the Daily Service"><ArrowRight size={22} /></button
      >
    </div>
  </div>
  <div class="hero-food">
    <span class="table-note">A little instinct.<br />A thoughtful finish.</span>
    <div class="napkin"></div>
    <DishVisual dish={hero} decorative /><span class="table-stamp"
      >made with<br /><b>good taste</b></span
    ><CheffyCoach text="Three guests. Three plates. Trust your instincts." />
  </div>
</section>

<style>
  .opening {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 60px;
    align-items: center;
    max-width: 1120px;
    margin: auto;
    padding: clamp(40px, 8vh, 90px) 40px 60px;
    min-height: calc(100dvh - 64px);
  }
  h1.stage-title {
    font-size: clamp(52px, 6.8vw, 90px);
    font-weight: 850;
    letter-spacing: -4px;
    line-height: 0.97;
    margin: 23px 0;
  }
  h1 em {
    color: var(--table-orange);
    font-style: normal;
  }
  .intro {
    font-size: 25px;
    line-height: 1.35;
    letter-spacing: -0.4px;
  }
  .sub {
    font-size: 15px;
    line-height: 1.65;
    color: var(--table-muted);
    margin: 19px 0 27px;
  }
  .start {
    min-height: 55px;
    padding-inline: 26px;
  }
  .daily {
    display: flex;
    gap: 12px;
    align-items: center;
    border-top: 1px solid var(--table-line);
    margin-top: 36px;
    padding-top: 22px;
  }
  .daily-icon {
    color: var(--table-orange);
  }
  .daily strong {
    font-size: 16px;
  }
  .daily p {
    color: var(--table-muted);
    font-size: 12px;
    margin-top: 4px;
  }
  .daily > .table-icon {
    margin-left: auto;
  }
  .hero-food {
    position: relative;
    padding-top: 30px;
  }
  .hero-food :global(.dish) {
    max-width: 470px;
    margin: auto;
    transform: rotate(-8deg);
  }
  .hero-food :global(.coach) {
    margin-top: 40px;
    max-width: 320px;
  }
  .napkin {
    position: absolute;
    width: 71%;
    height: 65%;
    right: 4%;
    top: 12%;
    background:
      repeating-linear-gradient(0deg, transparent 0 18px, #82927630 18px 20px),
      repeating-linear-gradient(90deg, var(--table-pantry) 0 18px, #82927630 18px 20px);
    border-radius: 3px;
    transform: rotate(14deg);
    box-shadow: 0 7px 20px var(--table-shadow);
  }
  .table-note {
    position: absolute;
    top: 0;
    left: 10px;
    font-size: 16px;
    line-height: 1.4;
    font-style: italic;
    transform: rotate(-7deg);
    color: var(--table-muted);
    z-index: 1;
  }
  .table-stamp {
    position: absolute;
    right: -2px;
    bottom: 85px;
    z-index: 2;
    background: var(--table-success);
    color: var(--table-surface);
    text-align: center;
    border-radius: 50%;
    width: 86px;
    height: 86px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    font-size: 12px;
    transform: rotate(12deg);
  }
  .table-stamp b {
    font-size: 15px;
  }
  @media (max-width: 900px) {
    .opening {
      padding: 45px 30px;
      gap: 24px;
    }
    h1.stage-title {
      font-size: 65px;
    }
  }
  @media (max-width: 699px) {
    .opening {
      display: flex;
      flex-direction: column;
      padding: 28px 26px 32px;
      gap: 18px;
      min-height: auto;
    }
    .invitation {
      width: 100%;
    }
    .invitation > .eyebrow {
      font-size: 11px;
      letter-spacing: 1.2px;
    }
    h1.stage-title {
      font-size: 58px;
      letter-spacing: -2.8px;
      margin: 19px 0 16px;
    }
    .intro {
      font-size: 21px;
    }
    .sub {
      margin: 13px 0 22px;
      font-size: 14px;
    }
    .desktop-break {
      display: none;
    }
    .start {
      width: 100%;
    }
    .daily {
      margin-top: 26px;
      padding-top: 17px;
    }
    .hero-food {
      width: 78%;
      max-width: 320px;
      padding-top: 0;
      margin-top: 12px;
    }
    .hero-food :global(.coach) {
      display: none;
    }
    .table-note {
      display: none;
    }
    .table-stamp {
      bottom: 0;
      width: 65px;
      height: 65px;
      font-size: 10px;
    }
    .table-stamp b {
      font-size: 12px;
    }
    .napkin {
      height: 80%;
      top: 10%;
    }
  }
  @media (max-width: 699px) and (max-height: 720px) {
    .opening {
      padding-top: 22px;
      gap: 8px;
    }
    h1.stage-title {
      font-size: 48px;
      margin: 13px 0;
    }
    .intro {
      font-size: 19px;
    }
    .sub {
      font-size: 13px;
      margin: 10px 0 17px;
    }
    .hero-food {
      max-width: 155px;
      margin: 7px 0 0 auto;
    }
    .table-stamp {
      display: none;
    }
    .daily {
      margin-top: 22px;
    }
  }
</style>
