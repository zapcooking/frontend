<script lang="ts">
  import Arrow from './Arrow.svelte';
  import { COOK_PLUS_TOOLS } from '$lib/cookPlusCopy';
  import { MEMBERSHIP_PATH } from '$lib/cookPlusPricing';
  import membershipScript from '$lib/landing/membership.client.js?url';
</script>

<svelte:head>
  <script type="module" src={membershipScript}></script>
  {@html '<noscript><style>@layer base{html [data-landing-guest][hidden],html [data-landing-upgrade][hidden]{display:block!important}html a[data-landing-guest][hidden]{display:inline-flex!important}}</style></noscript>'}
</svelte:head>

<section id="membership" aria-labelledby="membership-heading" class="membership-section">
  <div class="membership-intro">
    <p class="eyebrow">A place at the table</p>
    <h2 id="membership-heading" class="font-display">Make more of your kitchen.</h2>
    <p>Keep the recipes you love. Share what you make. Find your people.</p>
  </div>
  <div class="membership-options">
    <article class="membership-option" data-landing-guest hidden>
      <p class="eyebrow">For every cook</p>
      <h3 class="font-display">Join free.</h3>
      <p>
        Save your favorites, import recipes from links, share food, and follow the cooks who inspire
        you.
      </p>
      <a class="membership-button" href="/login?join=1">Join free <Arrow /></a>
    </article>
    <article class="membership-option plus" data-landing-upgrade hidden>
      <p class="eyebrow">A little help in the kitchen</p>
      <h3 class="font-display">Cook+</h3>
      <ul>
        {#each COOK_PLUS_TOOLS as tool (tool.key)}
          <li><strong>{tool.name}</strong><span>{tool.short}</span></li>
        {/each}
      </ul>
      <a class="membership-button" href={MEMBERSHIP_PATH}>See Cook+ <Arrow /></a>
      <p class="billing-note">See membership for plans, prices, and billing details.</p>
    </article>
    <article class="membership-option account" data-landing-account hidden>
      <p class="eyebrow">Make yourself at home</p>
      <h3 class="font-display">Your next kitchen adventure.</h3>
      <p>Pick up a recipe, find a fresh idea, or open your kitchen assistant.</p>
      <div class="account-links">
        <a href="/recipes">Browse recipes <Arrow /></a>
        <a href="/cheffy">Open Cheffy <Arrow /></a>
      </div>
    </article>
  </div>
</section>

<style>
  .membership-section {
    border-top: 1px solid var(--color-input-border);
    padding: 3.5rem 0;
  }
  .membership-intro {
    max-width: 38rem;
    margin-bottom: 1.8rem;
  }
  .eyebrow {
    color: var(--landing-accent-text, #b83900);
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.14em;
  }
  h2 {
    font-size: clamp(1.8rem, 3vw, 2.8rem);
    line-height: 1.12;
    margin: 0.5rem 0 0.8rem;
  }
  h3 {
    font-size: 2rem;
    line-height: 1.15;
    margin: 0.4rem 0 0.9rem;
  }
  p {
    color: var(--color-text-secondary);
    line-height: 1.6;
  }
  .membership-options {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
    gap: 1.2rem;
  }
  .membership-option {
    padding: 1.8rem;
    border: 1px solid var(--color-input-border);
    border-radius: 12px;
  }
  .membership-option[hidden] {
    display: none;
  }
  .plus {
    background: var(--color-bg-secondary);
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0 0 1.5rem;
  }
  li {
    margin: 0 0 0.85rem;
    display: grid;
    gap: 0.2rem;
  }
  li span {
    color: var(--color-text-secondary);
    font-size: 0.9rem;
    line-height: 1.5;
  }
  .membership-button {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 2rem;
    min-height: 44px;
    margin-top: 1.1rem;
    padding: 0.65rem 1.1rem;
    color: #fff;
    background: var(--landing-accent-bg, #b83900);
    text-decoration: none;
    border-radius: 9999px;
    font-weight: 600;
  }
  .billing-note {
    margin-top: 0.7rem;
    font-size: 0.75rem;
  }
  .account-links {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    margin-top: 1rem;
  }
  .account-links a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: var(--landing-accent-text, #b83900);
    gap: 0.75rem;
  }
  a:focus-visible {
    outline: 2px solid var(--landing-accent-text, #b83900);
    outline-offset: 4px;
  }
  @media (max-width: 600px) {
    .membership-section {
      padding: 2.5rem 0;
    }
    .membership-option {
      padding: 1.3rem;
    }
  }
</style>
