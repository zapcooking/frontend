<script lang="ts">
  import { userHref, type LongformCard } from '$lib/landing/content';

  export let recipes: LongformCard[] = [];

  // Reuse the authors of recipes already on this page; no profile or image requests.
  $: cooks = [
    ...new Map(
      recipes
        .map(({ author }) => author)
        .filter(({ pubkey, name }) => /^[a-f0-9]{64}$/i.test(pubkey) && name?.trim())
        .map((author) => [author.pubkey, author])
    ).values()
  ].slice(0, 3);
</script>

<section class="promises" aria-labelledby="promises-heading">
  <h2 id="promises-heading">
    <span aria-hidden="true">
      The recipe internet, minus <span class="contrast-clause"
        ><s>a subscription just to read</s>.</span
      >
    </span>
    <span class="sr-only">The recipe internet, without a subscription just to read.</span>
  </h2>
  <ul class="promise-list" role="list">
    <li>
      <svg
        aria-hidden="true"
        focusable="false"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M12 6c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Z" />
        <path d="M12 6v15" />
      </svg>
      <div>
        <h3>Recipes without a subscription.</h3>
        <p>Read recipes here without signing up or paying for membership.</p>
      </div>
    </li>
    <li>
      <svg
        aria-hidden="true"
        focusable="false"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <rect x="8" y="8" width="13" height="13" rx="1" />
        <path d="M16 5V3H3v13h2M12 12h5m-5 4h5" />
      </svg>
      <div>
        <h3>Your recipes stay yours.</h3>
        <p>Copy or print your recipes and keep them outside Zap Cooking.</p>
      </div>
    </li>
    <li>
      <svg
        aria-hidden="true"
        focusable="false"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="m12 21-8.5-8.5a5.3 5.3 0 0 1 7.5-7.5l1 1 1-1a5.3 5.3 0 0 1 7.5 7.5L12 21Z" />
      </svg>
      <div>
        <h3>Tip the cook directly.</h3>
        <p>Send a thank-you to the cook’s chosen wallet.</p>
      </div>
    </li>
  </ul>
  {#if cooks.length}
    <div class="cook-proof">
      <p id="cook-proof-heading">The people behind the food:</p>
      <ul aria-labelledby="cook-proof-heading" role="list">
        {#each cooks as cook (cook.pubkey)}
          <li><a href={userHref(cook.pubkey)}>{cook.name}</a></li>
        {/each}
      </ul>
    </div>
  {/if}
</section>

<style>
  .promises {
    padding: 28px 0 32px;
    border-top: 1px solid var(--color-input-border);
  }
  h2,
  h3 {
    font-family: var(--font-editorial, Georgia, serif);
    font-weight: 500;
    letter-spacing: -0.025em;
    text-wrap: pretty;
  }
  h2 {
    max-width: 36ch;
    margin: 0 0 28px;
    font-size: var(--explore-section, 32px);
    line-height: 1.2;
  }
  s {
    text-decoration-color: var(--color-primary);
    text-decoration-thickness: 2px;
  }
  .contrast-clause {
    display: inline-block;
    max-width: 100%;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  ul {
    padding: 0;
    margin: 0;
    list-style: none;
  }
  .promise-list {
    display: grid;
    gap: 20px;
  }
  .promise-list > li {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr);
    gap: 16px;
  }
  .promise-list svg {
    margin-top: 2px;
  }
  h3 {
    margin: 0 0 8px;
    font-size: var(--explore-title, 24px);
    line-height: 1.15;
  }
  .promise-list p {
    margin: 0;
    max-width: 40ch;
    color: var(--color-text-secondary);
    font-size: var(--explore-body, 16px);
    line-height: 1.5;
  }
  .cook-proof {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 16px;
    margin-top: 24px;
    font-size: var(--explore-meta, 13px);
    line-height: 1.5;
  }
  .cook-proof p {
    margin: 0;
    color: var(--color-text-secondary);
  }
  .cook-proof ul {
    display: flex;
    flex-wrap: wrap;
    gap: 0 20px;
    min-width: 0;
  }
  .cook-proof li {
    min-width: 0;
    max-width: 100%;
  }
  .cook-proof a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 3px;
    overflow-wrap: anywhere;
  }
  .cook-proof a:focus-visible {
    outline: 3px solid var(--color-primary);
    outline-offset: 4px;
  }
  @media (min-width: 768px) {
    .promise-list {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 24px;
    }
    .promise-list > li {
      display: block;
    }
    .promise-list svg {
      margin: 0 0 12px;
    }
  }
</style>
