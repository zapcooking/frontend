<script lang="ts">
  import Arrow from './Arrow.svelte';
  import { COOK_PLUS_TOOLS } from '$lib/cookPlusCopy';
  import { MEMBERSHIP_PATH } from '$lib/cookPlusPricing';
  import { CHEFFY_TRIAL_LIMIT } from '$lib/cheffyTrial';
  import membershipScript from '$lib/landing/membership.client.js?url';
</script>

<svelte:head>
  <script type="module" src={membershipScript}></script>
  {@html '<noscript><style>@layer base{html [data-landing-guest][hidden],html [data-landing-upgrade][hidden]{display:block!important}html a[data-landing-guest][hidden]{display:inline-flex!important}}</style></noscript>'}
</svelte:head>

<section id="membership" aria-labelledby="membership-heading" class="membership-section">
  <div class="membership-intro">
    <p class="eyebrow">A place at the table</p>
    <h2 id="membership-heading">Make more of your kitchen.</h2>
    <p>Keep the recipes you love. Share what you make. Find your people.</p>
  </div>
  <div class="membership-options">
    <article class="membership-option" data-landing-guest hidden>
      <h3>Join the table.</h3>
      <p>Save favorites, share your cooking, and follow the people who inspire you.</p>
      <a class="membership-button" href="/login?join=1">Join free <Arrow /></a>
    </article>
    <article class="membership-option plus" data-landing-upgrade hidden>
      <h3>A little help with Cook+.</h3>
      <p>Make room for {COOK_PLUS_TOOLS.map((tool) => tool.name).join(', ')} in your kitchen.</p>
      <a class="membership-button" href={MEMBERSHIP_PATH}>See Cook+ <Arrow /></a>
      <p class="billing-note">See membership for plans, prices, and billing details.</p>
    </article>
    <article class="membership-option account" data-landing-account hidden>
      <h3>Your next kitchen adventure.</h3>
      <p>Pick up a recipe, share a favorite, or ask your kitchen assistant.</p>
      <div class="account-links">
        <a href="/my-kitchen">My Kitchen <Arrow /></a>
        <a href="/cheffy">Open Cheffy <Arrow /></a>
      </div>
    </article>
  </div>
  <p class="cheffy-invitation" data-landing-upgrade hidden>
    Try {CHEFFY_TRIAL_LIMIT} free messages per account with Cheffy, then continue with Cook+.
    <a href="/cheffy">Try Cheffy <Arrow /></a>
  </p>
</section>

<style>
  .membership-section {
    border-top: 1px solid var(--color-input-border);
    padding: 2.5rem 0;
  }
  .membership-intro {
    max-width: 38rem;
    margin-bottom: 1.25rem;
  }
  .eyebrow {
    color: var(--color-primary);
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.14em;
  }
  h2,
  h3 {
    font-family: var(--font-editorial, Georgia, serif);
    letter-spacing: -0.025em;
  }
  h2 {
    font-size: clamp(1.8rem, 3vw, 2.4rem);
    line-height: 1.12;
    margin: 0.5rem 0 0.65rem;
  }
  h3 {
    font-size: 1.55rem;
    line-height: 1.2;
    margin: 0 0 0.65rem;
  }
  p {
    color: var(--color-text-secondary);
    line-height: 1.6;
    font-size: 0.9rem;
  }
  .membership-options {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
    gap: 1rem;
  }
  .membership-option {
    padding: 1.4rem;
    border: 1px solid var(--color-input-border);
    border-radius: 14px;
  }
  .membership-option[hidden],
  .cheffy-invitation[hidden] {
    display: none;
  }
  .membership-option p {
    margin: 0;
  }
  .plus {
    background: var(--color-explore-peach, var(--color-bg-secondary));
  }
  .membership-button {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    min-height: 44px;
    margin-top: 1rem;
    padding: 0.65rem 1.1rem;
    color: #fff;
    background: var(--color-primary);
    text-decoration: none;
    border-radius: 9999px;
    font-weight: 600;
    font-size: 0.85rem;
  }
  .membership-option .billing-note {
    margin-top: 0.6rem;
    font-size: 0.7rem;
    color: var(--color-caption);
  }
  .account-links {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    margin-top: 0.6rem;
  }
  .account-links a,
  .cheffy-invitation a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: var(--color-primary);
    gap: 0.5rem;
    font-weight: 600;
  }
  .cheffy-invitation {
    margin: 0.75rem 0 0;
    font-size: 0.8rem;
  }
  .cheffy-invitation a {
    margin-left: 0.35rem;
  }
  a:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 4px;
  }
  @media (max-width: 600px) {
    .membership-section {
      padding: 2rem 0;
    }
    .membership-option {
      padding: 1.2rem;
    }
  }
</style>
