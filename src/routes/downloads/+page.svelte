<!--
  Store badges are Apple's official "Download on the App Store" badge
  (tools.applemediaservices.com) and Google Play's official "Get it on
  Google Play" badge (play.google.com/intl/en_us/badges), used unmodified
  and linking to the listings, per the App Store Marketing Guidelines and
  Google Play Brand Guidelines. Phone screenshots are Zap Cooking's own
  app captures.
-->
<script lang="ts">
  import Arrow from '../../components/landing/Arrow.svelte';

  const stores = [
    {
      id: 'app-store',
      platform: 'iOS',
      name: 'App Store',
      description: 'Zap Cooking for iPhone and iPad, from Apple’s App Store.',
      badge: '/downloads/apple-app-store.svg',
      badgeAlt: 'Download on the App Store',
      badgeHeight: 44,
      cta: 'Download on the App Store',
      href: 'https://apps.apple.com/us/app/zap-cooking/id6757363819'
    },
    {
      id: 'google-play',
      platform: 'Android',
      name: 'Google Play',
      description: 'Zap Cooking for Android phones and tablets, from Google Play.',
      badge: '/downloads/google-play-badge.png',
      badgeAlt: 'Get it on Google Play',
      badgeHeight: 56,
      cta: 'Get it on Google Play',
      href: 'https://play.google.com/store/apps/details?id=cooking.zap.app&hl=en_US'
    },
    {
      id: 'zapstore',
      platform: 'Android',
      name: 'Zapstore',
      description: 'The Nostr-native app store, for the open, permissionless route.',
      badge: undefined,
      badgeAlt: '',
      badgeHeight: 0,
      cta: 'Get it on Zapstore',
      href: 'https://zapstore.dev/apps/cooking.zap.app'
    }
  ];

  const shots = [
    { src: '/downloads/shot-android-recipe-trends.png', alt: 'Recipe trends with a visible trend pill' },
    { src: '/downloads/shot-ios-media.png', alt: 'Composing a note with an attached GIF' },
    { src: '/downloads/shot-android-food-tags.png', alt: 'Picking food tags for a recipe' },
    { src: '/downloads/shot-ios-composer.png', alt: 'The composer’s more sheet' }
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
    <img class="app-icon" src="/downloads/app-icon.png" alt="" width="72" height="72" />
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
            {#if store.badge}
              <img
                class="store-badge"
                src={store.badge}
                alt={store.badgeAlt}
                height={store.badgeHeight}
                loading="lazy"
              />
            {:else}
              {store.cta}
              <Arrow />
            {/if}
          </span>
        </a>
      </li>
    {/each}
  </ul>

  <section class="shots-section" aria-labelledby="shots-heading">
    <h2 id="shots-heading">See it in action</h2>
    <ul class="shots" role="list">
      {#each shots as shot (shot.src)}
        <li>
          <img class="shot" src={shot.src} alt={shot.alt} loading="lazy" />
        </li>
      {/each}
    </ul>
  </section>
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
  .masthead {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }
  .app-icon {
    width: 72px;
    height: 72px;
    margin-bottom: 16px;
    border-radius: 22%;
    box-shadow: 0 6px 18px -8px rgba(0, 0, 0, 0.4);
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
  :global(.store-badge) {
    width: auto;
    border-radius: 6px;
  }
  .shots-section {
    margin-top: 40px;
  }
  h2 {
    font-family: var(--font-editorial, Georgia, serif);
    font-size: var(--dl-title);
    font-weight: 500;
    letter-spacing: -0.02em;
    margin: 0 0 16px;
  }
  .shots {
    margin: 0;
    padding: 4px 4px 16px;
    list-style: none;
    display: flex;
    gap: 16px;
    overflow-x: auto;
    scroll-snap-type: x proximity;
  }
  .shot {
    height: 340px;
    width: auto;
    border-radius: 24px;
    border: 1px solid var(--color-input-border);
    box-shadow: 0 10px 24px -16px rgba(0, 0, 0, 0.45);
    scroll-snap-align: start;
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
    .shot {
      height: 280px;
    }
  }
</style>
