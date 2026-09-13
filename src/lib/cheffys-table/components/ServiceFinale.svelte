<script lang="ts">
  import type { Service } from '../service';
  import DishVisual from '../DishVisual.svelte';
  import GuestPortrait from './GuestPortrait.svelte';
  import Stars from './Stars.svelte';
  import CountUp from './CountUp.svelte';
  import CheffyCoach from './CheffyCoach.svelte';
  import ArrowRight from 'phosphor-svelte/lib/ArrowRight';
  import ShareNetwork from 'phosphor-svelte/lib/ShareNetwork';
  export let service: Service;
  export let reduced = false;
  export let bestBefore = 0;
  export let dailyBefore = 0;
  export let saved = true;
  export let finding = false;
  export let recipeStatus = '';
  export let found: { title: string; url: string; image?: string; creator?: string }[] = [];
  export let shareFallback = '';
  export let onReplay: () => void;
  export let onDaily: () => void;
  export let onDiscover: () => void;
  export let onCheffy: () => void;
  export let onShare: () => void;
  export let onBook: () => void;
  export let onDownload: () => void;
  $: score = service.reviews.reduce((sum, r) => sum + r.score, 0);
  $: favorite = [...service.reviews].sort((a, b) => b.score - a.score)[0];
</script>

<section class="finale">
  <div class="service-receipt">
    <span class="eyebrow"
      >{service.mode === 'daily'
        ? `Today’s Table · ${service.date} UTC`
        : 'Three guests fed. One good service.'}</span
    >
    <h1 class="stage-title" tabindex="-1">Kitchen closed.</h1>
    <div class="final-score"><CountUp value={score} {reduced} /></div>
    <p class="achievement">
      {score > bestBefore && bestBefore > 0
        ? 'Your new personal best.'
        : bestBefore === 0
          ? 'First service in the book.'
          : 'Good food. Better instincts.'}
    </p>
    {#if service.mode === 'daily' && dailyBefore > 0}<p class="daily-score">
        Previous daily best: {dailyBefore.toLocaleString()}{score > dailyBefore
          ? ` · +${score - dailyBefore} today`
          : ''}
      </p>{/if}
    <div class="fed-guests">
      {#each service.reviews as r}<div>
          <GuestPortrait
            id={r.customer.id}
            mood={r.stars >= 4 ? 'happy' : 'thoughtful'}
            size={48}
          /><span>{r.customer.name}</span><Stars value={r.stars} />
        </div>{/each}
    </div>
    <button class="table-primary replay" on:click={onReplay}
      >Cook another service<ArrowRight size={19} /></button
    >{#if service.mode !== 'daily'}<button class="table-text" on:click={onDaily}
        >Try Today’s Table</button
      >{/if}
    <div class="share-actions">
      <button class="table-text" on:click={onShare}><ShareNetwork size={18} />Share result</button
      ><button class="table-text" on:click={onBook}>Service Book</button>
    </div>
    <span class="saved"
      >{saved ? 'Your service is saved.' : 'Keep this page open while saving is unavailable.'}</span
    >
    {#if shareFallback}<label class="share-copy"
        >Copy your result<textarea readonly rows="9" value={shareFallback}></textarea></label
      >{/if}
  </div>
  <div class="dish-of-service">
    <span class="eyebrow">Dish of the service</span><DishVisual dish={favorite.dish} />
    <h2>{favorite.name}</h2>
    <Stars value={favorite.stars} /><CheffyCoach
      text="Simple food. Good decisions. Take something from this kitchen into yours."
      happy
    />
    <div class="dinner-bridge">
      <h3>Now make it dinner.</h3>
      <p>Your pantry picks could become something real.</p>
      <div class="dinner-actions">
        <button class="table-secondary" disabled={finding} on:click={onDiscover}
          >{finding ? 'Finding your next dish…' : 'Find recipes'}<ArrowRight size={17} /></button
        ><button class="table-text" on:click={onCheffy}>Make dinner with Cheffy</button>
      </div>
      <button class="download table-text" on:click={onDownload}>Save my ingredient list</button>
      {#if recipeStatus}<p class="recipe-status" role="status">{recipeStatus}</p>{/if}
      <div class="found-recipes">
        {#each found as recipe}<a href={recipe.url}
            >{#if recipe.image}<img src={recipe.image} alt="" loading="lazy" />{/if}
            <div>
              <strong>{recipe.title}</strong><small
                >{recipe.creator ? `By ${recipe.creator}` : 'From the Zap kitchen'} · View recipe</small
              >
            </div>
            <ArrowRight size={18} /></a
          >{/each}
      </div>
    </div>
  </div>
</section>

<style>
  .finale {
    display: grid;
    grid-template-columns: 1fr 1fr;
    max-width: 1050px;
    margin: 30px auto;
    gap: 90px;
  }
  .service-receipt {
    text-align: center;
    padding: 30px 20px;
  }
  .service-receipt h1 {
    font-size: 44px;
    margin: 13px 0 0;
    letter-spacing: -1.8px;
  }
  .final-score {
    font-size: 90px;
    font-weight: 850;
    letter-spacing: -5px;
    line-height: 1.15;
    margin: 14px 0;
    font-variant-numeric: tabular-nums;
  }
  .achievement {
    color: var(--table-success);
    font-size: 16px;
    font-weight: 650;
  }
  .daily-score {
    font-size: 13px;
    color: var(--table-muted);
    margin-top: 8px;
  }
  .fed-guests {
    display: flex;
    justify-content: center;
    gap: 27px;
    margin: 30px 0;
  }
  .fed-guests > div {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 7px;
  }
  .fed-guests > div > span {
    font-size: 13px;
    font-weight: 650;
  }
  .replay {
    width: 100%;
    margin-top: 10px;
  }
  .share-actions {
    display: flex;
    justify-content: center;
    gap: 14px;
    margin-top: 12px;
    font-size: 13px;
  }
  .saved {
    display: block;
    font-size: 12px;
    color: var(--table-muted);
    margin-top: 10px;
  }
  .dish-of-service {
    text-align: center;
  }
  .dish-of-service :global(.dish) {
    max-width: 360px;
    margin: auto;
  }
  .dish-of-service h2 {
    font-size: 26px;
    font-weight: 750;
    letter-spacing: -0.6px;
    margin: 12px 0 10px;
  }
  .dish-of-service :global(.coach) {
    max-width: 360px;
  }
  .dinner-bridge {
    margin-top: 26px;
    padding-top: 24px;
    border-top: 1px solid var(--table-line);
    text-align: left;
  }
  .dinner-bridge h3 {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.5px;
  }
  .dinner-bridge p {
    font-size: 13px;
    color: var(--table-muted);
    margin-top: 6px;
  }
  .dinner-actions {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-top: 16px;
    flex-wrap: wrap;
  }
  .dinner-actions button {
    font-size: 13px;
  }
  .download {
    font-size: 12px;
    color: var(--table-muted);
  }
  .recipe-status {
    line-height: 1.5;
  }
  .found-recipes {
    display: grid;
    gap: 10px;
    margin-top: 12px;
  }
  .found-recipes a {
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--table-raised);
    padding: 10px;
    border-radius: 13px;
    color: var(--table-ink);
    text-decoration: none;
  }
  .found-recipes img {
    width: 62px;
    height: 62px;
    object-fit: cover;
    border-radius: 8px;
  }
  .found-recipes strong {
    font-size: 14px;
  }
  .found-recipes small {
    display: block;
    color: var(--table-muted);
    font-size: 12px;
    margin-top: 4px;
  }
  .share-copy {
    display: block;
    text-align: left;
    font-size: 13px;
    margin-top: 20px;
  }
  textarea {
    display: block;
    width: 100%;
    margin-top: 8px;
    color: var(--table-ink);
    background: var(--table-raised);
    border: 1px solid var(--table-line);
    border-radius: 12px;
    padding: 12px;
    font-size: 13px;
  }
  @media (max-width: 1000px) {
    .finale {
      gap: 34px;
    }
    .final-score {
      font-size: 76px;
    }
    .service-receipt h1 {
      font-size: 36px;
    }
  }
  @media (max-width: 699px) {
    .finale {
      display: flex;
      flex-direction: column;
      gap: 30px;
      margin: 5px 0 20px;
    }
    .service-receipt {
      padding: 8px 5px 0;
    }
    .service-receipt h1 {
      font-size: 36px;
    }
    .final-score {
      font-size: 76px;
      margin: 9px 0;
    }
    .fed-guests {
      margin: 20px 0;
    }
    .dish-of-service {
      border-top: 1px solid var(--table-line);
      padding-top: 25px;
    }
    .dish-of-service :global(.dish) {
      max-width: 265px;
    }
    .dish-of-service h2 {
      font-size: 23px;
    }
    .share-actions {
      margin-top: 6px;
    }
    .replay {
      margin-top: 4px;
    }
  }
</style>
