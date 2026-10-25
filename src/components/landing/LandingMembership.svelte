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
    padding: 36px 0;
    border-top: 1px solid var(--color-input-border);
  }
  .membership-intro {
    max-width: 60ch;
    margin-bottom: 28px;
  }
  h2,
  h3 {
    font-family: var(--font-editorial, Georgia, serif);
    font-weight: 500;
    letter-spacing: -0.025em;
  }
  h2 {
    margin: 0 0 12px;
    font-size: var(--explore-section, 32px);
    line-height: 1.12;
  }
  h3 {
    margin: 0 0 12px;
    font-size: var(--explore-title, 24px);
    line-height: 1.2;
  }
  p {
    color: var(--color-text-secondary);
    font-size: var(--explore-body, 16px);
    line-height: 1.5;
  }
  .membership-options {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
    gap: 32px;
  }
  .membership-option {
    min-width: 0;
    padding-top: 20px;
    border-top: 1px solid var(--color-input-border);
  }
  .membership-option[hidden],
  .cheffy-invitation[hidden] {
    display: none;
  }
  .membership-option p {
    max-width: 60ch;
    margin: 0;
  }
  .membership-button {
    display: inline-flex;
    align-items: center;
    gap: 16px;
    min-height: 44px;
    margin-top: 12px;
    color: var(--color-primary);
    text-decoration: underline;
    text-underline-offset: 4px;
    font-weight: 600;
    font-size: var(--explore-body, 16px);
  }
  .membership-option .billing-note {
    margin-top: 8px;
    color: var(--color-caption);
    font-size: var(--explore-meta, 13px);
    line-height: 1.4;
  }
  .account-links {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    margin-top: 12px;
  }
  .account-links a,
  .cheffy-invitation a {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    color: var(--color-primary);
    font-weight: 600;
  }
  .cheffy-invitation {
    margin: 20px 0 0;
    font-size: var(--explore-meta, 13px);
    line-height: 1.4;
  }
  .cheffy-invitation a {
    margin-left: 4px;
  }
  a:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 4px;
  }
  @media (max-width: 600px) {
    .membership-section {
      padding: 28px 0;
    }
    .membership-options {
      gap: 24px;
    }
  }
</style>
