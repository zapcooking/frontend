<script lang="ts">
  import type { Review } from '../service';
  import DishVisual from '../DishVisual.svelte';
  import GuestPortrait from './GuestPortrait.svelte';
  import Stars from './Stars.svelte';
  import CountUp from './CountUp.svelte';
  import CheffyCoach from './CheffyCoach.svelte';
  import ArrowRight from 'phosphor-svelte/lib/ArrowRight';
  import Check from 'phosphor-svelte/lib/Check';
  export let review: Review;
  export let finalGuest = false;
  export let reduced = false;
  export let onNext: () => void;
  $: good = review.notes.filter((n) => n.kind === 'good').slice(0, 3);
  $: improve = review.notes.find((n) => n.kind === 'improve');
</script>

<section class="reaction" class:excellent={review.stars >= 4}>
  <div class="reaction-food">
    <span class="eyebrow">From your kitchen</span><DishVisual dish={review.dish} />
    <h3>{review.name}</h3>
    <span class="made-for">Made for {review.customer.name}</span>
  </div>
  <div class="reaction-story">
    <div class="guest-reaction">
      <GuestPortrait
        id={review.customer.id}
        mood={review.stars >= 4 ? 'happy' : 'thoughtful'}
        size={84}
      />
      <div>
        <span class="eyebrow">{review.customer.name} says</span>
        <h2 class="stage-title" tabindex="-1">
          {review.stars === 5
            ? 'That plate disappeared fast.'
            : review.stars === 4
              ? 'You’ve got good instincts.'
              : 'A good idea. Another lesson.'}
        </h2>
      </div>
    </div>
    <blockquote>{review.quote}</blockquote>
    <Stars value={review.stars} large />
    <div class="dish-score">
      +<CountUp value={review.score} {reduced} /><small>points on the pass</small>
    </div>
    {#if good.length}<div class="nailed">
        <h3>You nailed</h3>
        <div>
          {#each good as note}<span><Check size={14} />{note.title}</span>{/each}
        </div>
      </div>{/if}
    {#if improve}<div class="next-time">
        <h3>Next time</h3>
        <p>{improve.text}</p>
      </div>{/if}
    <CheffyCoach
      text={review.stars === 5
        ? review.complexity > 120
          ? 'You took the risk. It worked. That’s cooking.'
          : 'Nothing extra. Nothing missing. That’s cooking.'
        : improve
          ? 'Take that thought into the next plate. You’re already learning.'
          : review.discovery}
      happy={review.stars >= 4}
    />
    <div class="table-next-action">
      <button class="table-primary next-guest" on:click={onNext}
        >{finalGuest ? 'Close the kitchen' : 'Next guest'}<ArrowRight size={19} /></button
      >
    </div>
    <details>
      <summary>What your guest tasted</summary>
      <div class="score-detail">
        {#each review.components as c}<div>
            <span>{c.name}</span><span>{c.score} / {c.max}</span>
          </div>{/each}
        <div><span>Dish quality</span><span>{review.quality} / 100</span></div>
      </div>
      {#each review.notes as note}<p><b>{note.title}.</b> {note.text}</p>{/each}
      <p>
        {review.quality >= 75
          ? 'Your successful dish earned its complexity bonus.'
          : 'Complexity earns a bonus when the dish scores at least 75/100 in quality.'}
      </p>
    </details>
  </div>
</section>

<style>
  .reaction {
    display: grid;
    grid-template-columns: 0.9fr 1.1fr;
    gap: 80px;
    max-width: 1000px;
    margin: 38px auto;
    align-items: start;
  }
  .reaction-food {
    text-align: center;
    position: sticky;
    top: 150px;
    padding-top: 28px;
  }
  .reaction-food :global(.dish) {
    margin: 15px 0 20px;
  }
  .reaction-food h3 {
    font-size: 24px;
    font-weight: 750;
    letter-spacing: -0.6px;
  }
  .made-for {
    font-size: 13px;
    color: var(--table-muted);
    display: block;
    margin-top: 7px;
  }
  .guest-reaction {
    display: flex;
    gap: 16px;
    align-items: center;
  }
  .guest-reaction :global(svg) {
    flex-shrink: 0;
  }
  .guest-reaction h2 {
    font-size: 31px;
    margin-top: 8px;
  }
  .reaction-story blockquote {
    font-size: 18px;
    color: var(--table-muted);
    margin: 22px 0 18px;
  }
  .dish-score {
    font-size: 52px;
    font-weight: 800;
    letter-spacing: -2px;
    line-height: 1.1;
    margin: 13px 0 24px;
    font-variant-numeric: tabular-nums;
  }
  .dish-score small {
    display: block;
    font-size: 12px;
    color: var(--table-muted);
    letter-spacing: 0;
    font-weight: 500;
    margin-top: 7px;
  }
  .nailed h3,
  .next-time h3 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 1.1px;
    margin-bottom: 8px;
  }
  .nailed > div {
    display: flex;
    gap: 6px 12px;
    flex-wrap: wrap;
  }
  .nailed span {
    font-size: 13px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--table-success);
  }
  .next-time {
    margin-top: 20px;
  }
  .next-time p {
    font-size: 14px;
    color: var(--table-muted);
    line-height: 1.5;
  }
  .next-guest {
    margin-top: 26px;
    width: 100%;
  }
  .score-detail {
    display: grid;
    gap: 6px;
    font-size: 14px;
    margin-bottom: 16px;
  }
  .score-detail > div {
    display: flex;
    justify-content: space-between;
    padding-bottom: 5px;
    border-bottom: 1px solid var(--table-line);
  }
  .excellent .reaction-food {
    background: radial-gradient(ellipse at center, var(--table-warm), transparent 70%);
  }
  @media (max-width: 900px) {
    .reaction {
      gap: 35px;
    }
    .guest-reaction h2 {
      font-size: 26px;
    }
  }
  @media (max-width: 699px) {
    .reaction {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 150px;
      gap: 16px;
      padding-bottom: 85px;
      margin: 5px auto 20px;
    }
    .reaction-story {
      display: contents;
    }
    .guest-reaction {
      grid-column: 1/-1;
      grid-row: 1;
      gap: 12px;
    }
    .guest-reaction h2 {
      font-size: 26px;
    }
    .guest-reaction :global(svg) {
      width: 65px;
      height: 65px;
    }
    .reaction-story blockquote {
      grid-column: 1/-1;
      grid-row: 2;
      margin: 0;
      font-size: 16px;
    }
    .reaction-story > :global(.stars) {
      grid-column: 1;
      grid-row: 3;
      align-self: end;
    }
    .reaction-story > :global(.stars svg) {
      width: 24px;
      height: 24px;
    }
    .reaction-food {
      position: static;
      grid-column: 2;
      grid-row: 3/5;
      padding: 0;
      margin: 0;
      width: 150px;
      align-self: center;
    }
    .reaction-food > .eyebrow,
    .made-for {
      display: none;
    }
    .reaction-food h3 {
      font-size: 13px;
      line-height: 1.3;
      margin: 8px 0 0;
    }
    .reaction-food :global(.dish) {
      margin: 0;
    }
    .dish-score {
      grid-column: 1;
      grid-row: 4;
      font-size: 42px;
      margin: 0;
      align-self: start;
    }
    .nailed {
      grid-column: 1/-1;
      grid-row: 5;
    }
    .next-time {
      grid-column: 1/-1;
      grid-row: 6;
      margin: 0;
    }
    .reaction-story > :global(.coach) {
      grid-column: 1/-1;
      grid-row: 7;
      margin: 0;
    }
    .next-guest {
      margin: 0;
    }
    .reaction-story details {
      grid-column: 1/-1;
      grid-row: 8;
      width: 100%;
      margin: 0;
    }
  }
  @media (max-width: 699px) and (max-height: 740px) {
    .reaction {
      gap: 10px;
    }
    .reaction-food {
      width: 140px;
      justify-self: end;
    }
  }
</style>
