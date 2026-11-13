<script lang="ts">
  import Arrow from '../../components/landing/Arrow.svelte';

  const stores = [
    {
      id: 'app-store',
      platform: 'iOS',
      name: 'App Store',
      description: 'Zap Cooking for iPhone and iPad, from Apple’s App Store.',
      cta: 'Download on the App Store',
      href: 'https://apps.apple.com/us/app/zap-cooking/id6757363819'
    },
    {
      id: 'google-play',
      platform: 'Android',
      name: 'Google Play',
      description: 'Zap Cooking for Android phones and tablets, from Google Play.',
      cta: 'Get it on Google Play',
      href: 'https://play.google.com/store/apps/details?id=cooking.zap.app&hl=en_US'
    },
    {
      id: 'zapstore',
      platform: 'Android',
      name: 'Zapstore',
      description: 'The Nostr-native app store, for the open, permissionless route.',
      cta: 'Get it on Zapstore',
      href: 'https://zapstore.dev/apps/cooking.zap.app'
    }
  ];
</script>

<svelte:head>
  <title>Download Zap Cooking - zap.cooking</title>
  <meta
    name="description"
    content="Get the Zap Cooking app for iOS and Android — on the App Store, Google Play, or Zapstore, the Nostr-native app store."
  />
  <link rel="canonical" href="https://zap.cooking/downloads" />
</svelte:head>

<main class="downloads" aria-labelledby="downloads-heading">
  <header class="masthead">
    <p class="tagline">Food. Friends. Freedom.</p>
    <h1 id="downloads-heading">Download Zap Cooking</h1>
    <p class="lede">
      Take your recipes, your reads, and your kitchen with you. Pick your store below and start
      cooking.
    </p>
  </header>

  <ul class="stores" role="list">
    {#each stores as store (store.id)}
      <li>
        <a
          class="store-card"
          href={store.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${store.cta} — opens the ${store.name} website`}
        >
          <span class="store-platform">{store.platform}</span>
          <span class="store-name">{store.name}</span>
          <span class="store-description">{store.description}</span>
          <span class="store-cta">
            {store.cta}
            <Arrow />
          </span>
        </a>
      </li>
    {/each}
  </ul>
</main>

<style>
  .downloads {
    --dl-display: 44px;
    --dl-title: 24px;
    --dl-body: 16px;
    --dl-meta: 13px;
    max-width: 960px;
    margin: 0 auto;
    padding: 24px 0 40px;
    color: var(--color-text-primary);
    font-family: 'Albert Sans', ui-sans-serif, system-ui, sans-serif;
  }
  h1 {
    font-family: var(--font-editorial, Georgia, serif);
    font-size: var(--dl-display);
    font-weight: 500;
    line-height: 1.04;
    letter-spacing: -0.035em;
    text-wrap: balance;
    margin: 0 0 16px;
  }
  .tagline {
    margin: 0 0 12px;
    color: var(--color-caption);
    font-size: var(--dl-meta);
    line-height: 1.5;
  }
  .lede {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--dl-body);
    line-height: 1.5;
    max-width: 56ch;
  }
  .stores {
    margin: 32px 0 0;
    padding: 0;
    list-style: none;
    display: grid;
    grid-template-columns: 1fr;
    gap: 20px;
  }
  .store-card {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 24px;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    border-radius: var(--radius, 16px);
    text-decoration: none;
    transition:
      border-color 0.2s ease,
      background 0.2s ease;
  }
  .store-card:hover {
    border-color: var(--color-primary);
    background: var(--color-hover-bg);
    text-decoration: none;
  }
  .store-card:focus-visible {
    outline: 3px solid var(--color-primary);
    outline-offset: 4px;
  }
  .store-platform {
    color: var(--color-caption);
    font-size: var(--dl-meta);
    line-height: 1.4;
  }
  .store-name {
    margin-top: 6px;
    font-family: var(--font-editorial, Georgia, serif);
    font-size: var(--dl-title);
    font-weight: 500;
    line-height: 1.12;
    letter-spacing: -0.02em;
  }
  .store-description {
    margin-top: 8px;
    color: var(--color-text-secondary);
    font-size: var(--dl-body);
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .store-cta {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    margin-top: auto;
    padding-top: 16px;
    color: var(--color-primary);
    font-size: var(--dl-meta);
    font-weight: 600;
  }
  .store-cta :global(svg) {
    flex-shrink: 0;
  }
  @media (min-width: 768px) {
    .downloads {
      padding: 36px 0 48px;
    }
    .stores {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 24px;
    }
  }
  @media (max-width: 767px) {
    .downloads {
      --dl-display: 36px;
    }
  }
</style>
