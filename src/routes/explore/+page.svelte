<script lang="ts">
  import type { PageData } from './$types';
  import { avatarUrl } from '$lib/imageOptimizer';
  import { responsiveImg } from '$lib/landing/responsiveImg';
  import { userHref } from '$lib/landing/content';
  import { DEFAULT_HEADLINE, EDITORIAL_SUPPORTING_LINE } from '$lib/landing/editorialConfig';
  import { landingJsonLd, landingMeta, NOSCRIPT_DARK_STYLE } from '$lib/landing/meta';
  import Arrow from '../../components/landing/Arrow.svelte';
  import LandingHeader from '../../components/landing/LandingHeader.svelte';
  import LandingSideNav from '../../components/landing/LandingSideNav.svelte';
  import LandingImage from '../../components/landing/LandingImage.svelte';
  import LongformTile from '../../components/landing/LongformTile.svelte';
  import LandingImportHero from '../../components/landing/LandingImportHero.svelte';
  import LandingPromises from '../../components/landing/LandingPromises.svelte';
  import LandingThemePicker from '../../components/landing/LandingThemePicker.svelte';
  import LandingMembership from '../../components/landing/LandingMembership.svelte';
  import LandingRecipePacks from '../../components/landing/LandingRecipePacks.svelte';
  import exploreThemeScript from '$lib/landing/exploreTheme.client.js?url';
  import '$lib/landing/exploreThemes.css';

  export let data: PageData;
  $: d = data.landing;
  $: paid = data.paid;
  $: meta = landingMeta(d);
  $: hero = d.cover
    ? responsiveImg(
        d.cover.image,
        [480, 768, 1200],
        '(min-width: 1280px) 48vw, (min-width: 1024px) 50vw, (min-width: 768px) 60vw, 100vw'
      )
    : null;
  const avatar = (url: string | undefined) => (url ? avatarUrl(url, 80) || url : undefined);
</script>

<svelte:head>
  <!-- Restore this device's style before the body paints; no app hydration or cache variation. -->
  <script src={exploreThemeScript}></script>
  <title>{meta.title}</title>
  <meta name="description" content={meta.description} />
  <link rel="canonical" href={meta.canonical} />
  <meta property="og:title" content={meta.title} />
  <meta property="og:description" content={meta.description} />
  <meta property="og:type" content="website" />
  <meta property="og:url" content={meta.canonical} />
  <meta property="og:image" content={meta.image} />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={meta.title} />
  <meta name="twitter:description" content={meta.description} />
  <meta name="twitter:image" content={meta.image} />
  {#if hero}
    <link
      rel="preload"
      as="image"
      href={hero.src}
      imagesrcset={hero.srcset}
      imagesizes={hero.sizes}
      fetchpriority="high"
    />
  {/if}
  {@html `<script type="application/ld+json">${landingJsonLd(d)}</script>`}
  {@html NOSCRIPT_DARK_STYLE}
</svelte:head>

<div class="landing">
  <LandingSideNav />
  <div class="landing-body">
    <LandingHeader />
    <main id="main" class="magazine">
      <section class="masthead" aria-labelledby="community-headline">
        <div class="masthead-toolbar">
          <p class="tagline">Food. Friends. Freedom.</p>
          <LandingThemePicker />
        </div>
        <h1 id="community-headline">{d.headline || DEFAULT_HEADLINE}</h1>
        <p class="intro">
          {EDITORIAL_SUPPORTING_LINE}
        </p>
      </section>

      {#if d.cover || d.picks.length}
        <section class="cover-section" aria-label="Featured recipes and food stories">
          <div class="cover-top">
            <a class="text-link" href={data.nextEditionHref}>More inspiration <Arrow /></a>
          </div>
          <div class="cover-spread" class:lead-only={!d.picks.length}>
            {#if d.cover}
              <article class="lead">
                <a href={d.cover.href} class="lead-image" aria-label={d.cover.title}>
                  <LandingImage
                    url={d.cover.image}
                    alt=""
                    ratio="16 / 10"
                    widths={[480, 768, 1200]}
                    sizes="(min-width: 1280px) 48vw, (min-width: 1024px) 50vw, (min-width: 768px) 60vw, 100vw"
                    hero
                  />
                </a>
                <div class="lead-caption">
                  <h2><a href={d.cover.href}>{d.cover.title}</a></h2>
                  <a class="byline" href={userHref(d.cover.author.pubkey)}>
                    {#if d.cover.author.picture}<img
                        src={avatar(d.cover.author.picture)}
                        alt=""
                        width="24"
                        height="24"
                      />{/if}
                    By {d.cover.author.name || 'A community cook'}
                  </a>
                </div>
              </article>
            {/if}
            {#if d.picks.length}
              <div class="supporting">
                {#each d.picks as pick (pick.coordinate)}
                  <LongformTile
                    card={pick}
                    ratio="16 / 8"
                    sizes="(min-width: 1280px) 24vw, (min-width: 768px) 28vw, 46vw"
                    widths={[320, 480, 640]}
                  />
                {/each}
              </div>
            {/if}
          </div>
        </section>
      {/if}

      {#if d.newRecipes.length}
        <section class="section" aria-labelledby="recipes-heading">
          <div class="section-top">
            <div>
              <h2 id="recipes-heading">Recipes to try</h2>
            </div>
            <a class="text-link" href="/recipes">All recipes <Arrow /></a>
          </div>
          <ul class="recipe-grid" role="list">
            {#each d.newRecipes as recipe (recipe.coordinate)}<li>
                <LongformTile card={recipe} />
              </li>{/each}
          </ul>
        </section>
      {/if}

      <LandingImportHero />
      <LandingPromises />

      {#if d.reads.length}
        <section class="section food-stories" aria-labelledby="stories-heading">
          <div class="section-top">
            <div>
              <h2 id="stories-heading">Food stories</h2>
            </div>
            <a class="text-link" href="/reads">All food stories <Arrow /></a>
          </div>
          <ul class="story-grid" class:single={d.reads.length === 1} role="list">
            {#each d.reads as story (story.coordinate)}<li>
                <LongformTile card={story} ratio="16 / 10" showSummary />
              </li>{/each}
          </ul>
        </section>
      {/if}

      {#if (d.freshTopics?.length ?? 0) || d.fresh.length}
        <section class="section fresh-section" aria-labelledby="fresh-heading">
          <div class="section-top">
            <div>
              <h2 id="fresh-heading">Fresh from the kitchen</h2>
            </div>
            <a class="text-link" href="/feed?tab=fresh">Explore the Fresh feed <Arrow /></a>
          </div>
          {#if d.freshTopics?.length}
            <div class="fresh-part">
              <div class="subsection-top">
                <h3>Find your flavor</h3>
                <p>Follow your appetite into the community.</p>
              </div>
              <ul class="topic-grid" role="list">
                {#each d.freshTopics as topic (topic.slug)}
                  <li>
                    <a class="topic-link" href={topic.href}>
                      <LandingImage
                        url={topic.image}
                        alt=""
                        ratio="4 / 3"
                        widths={[240, 360, 480]}
                        sizes="(min-width: 1024px) 20vw, (min-width: 768px) 30vw, 46vw"
                      />
                      <h4>{topic.name} <Arrow /></h4>
                    </a>
                    <a
                      class="topic-credit"
                      href={topic.post.href}
                      aria-label={`Photo by ${topic.post.author.name || 'a community cook'}: open the original post`}
                      >Photo by {topic.post.author.name || 'a community cook'}</a
                    >
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
          {#if d.fresh.length}
            <div class="fresh-part just-served">
              <div class="subsection-top">
                <h3>Just served</h3>
                <p>Recent moments from everyday kitchens.</p>
              </div>
              <ul class="community-list" role="list">
                {#each d.fresh as note (note.id)}
                  <li>
                    <a
                      class="note-image"
                      href={note.href}
                      aria-label={note.text ||
                        `Kitchen photo by ${note.author.name || 'a community cook'}`}
                    >
                      <LandingImage
                        url={note.image}
                        alt=""
                        ratio="1 / 1"
                        widths={[240, 360, 480]}
                        sizes="(min-width: 1024px) 20vw, (min-width: 768px) 30vw, 46vw"
                      />
                    </a>
                    <div class="note-copy">
                      {#if note.text}<a class="note-link" href={note.href}
                          ><p class="note-text">{note.text}</p></a
                        >{/if}
                      <a class="byline" href={userHref(note.author.pubkey)}
                        >{note.author.name || 'A community cook'}</a
                      >
                    </div>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </section>
      {/if}

      <LandingRecipePacks packs={d.packs ?? []} />

      {#if paid.boosts.length || paid.sponsors.length}
        <section class="section paid-section" aria-labelledby="partners-heading">
          <div class="section-top">
            <h2 id="partners-heading">From our partners</h2>
            <span class="paid-disclosure">Paid placements</span>
          </div>
          <ul class="paid-grid" role="list">
            {#each paid.boosts as boost (boost.id)}<li>
                <a href={boost.href} rel="sponsored">
                  {#if boost.image}<LandingImage url={boost.image} alt="" ratio="16 / 9" />{/if}
                  <span class="paid-label">Boosted · Paid placement</span>
                  <h3>{boost.title || 'Featured recipe'}</h3>
                </a>
              </li>{/each}
            {#each paid.sponsors as sponsor (sponsor.id)}<li>
                <a href={sponsor.linkUrl} rel="sponsored noopener" target="_blank">
                  {#if sponsor.imageUrl}<LandingImage
                      url={sponsor.imageUrl}
                      alt=""
                      ratio="16 / 9"
                    />{/if}
                  <span class="paid-label">Sponsored</span>
                  <h3>{sponsor.title || 'Our partner'}</h3>
                  <p>{sponsor.description || ''}</p>
                </a>
              </li>{/each}
          </ul>
          <a class="text-link" href="/sponsors">About our sponsors <Arrow /></a>
        </section>
      {/if}

      <LandingMembership />
    </main>
    <footer class="magazine footer">
      <a href="/explore" aria-label="Zap Cooking home" class="footer-brand">
        <img src="/zapcooking-text-light.svg" class="logo-l" alt="" width="160" height="22" />
        <img src="/zapcooking-text-dark.svg" class="logo-d" alt="" width="160" height="22" />
      </a>
      <p>Food. Friends. Freedom.</p>
      <nav aria-label="Footer">
        <a href="/about">About</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a
          href="/sponsors">Sponsors</a
        >
      </nav>
    </footer>
  </div>
</div>

<style>
  .landing {
    background: var(--color-bg-primary);
    color: var(--color-text-primary);
    font-family: 'Albert Sans', ui-sans-serif, system-ui, sans-serif;
  }
  .landing-body {
    --explore-display: 48px;
    --explore-section: 32px;
    --explore-title: 24px;
    --explore-body: 16px;
    --explore-meta: 13px;
    min-width: 0;
    min-height: 100vh;
  }
  .magazine {
    max-width: 1280px;
    margin: auto;
    padding: 0 40px;
  }
  :where(.landing) :global(a) {
    color: inherit;
    text-decoration: none;
  }
  .landing :global(a:hover) {
    text-decoration: underline;
    text-underline-offset: 4px;
  }
  .landing :global(a:focus-visible),
  .landing :global(button:focus-visible),
  .landing :global(input:focus-visible) {
    outline: 3px solid var(--color-primary);
    outline-offset: 4px;
  }
  .landing :global(ul) {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .magazine :global(.landing-img) {
    border-radius: 0;
  }
  .masthead {
    padding: 36px 0 28px;
  }
  .masthead-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px 24px;
    margin-bottom: 20px;
  }
  h1,
  h2,
  h3,
  h4 {
    font-family: var(--font-editorial, Georgia, serif);
    font-weight: 500;
    letter-spacing: -0.035em;
    text-wrap: pretty;
  }
  h1 {
    font-size: var(--explore-display);
    line-height: 1.04;
    margin: 0 0 18px;
    text-wrap: balance;
    text-align: left;
  }
  .intro {
    color: var(--color-text-secondary);
    font-size: var(--explore-body);
    line-height: 1.5;
    margin: 0;
    max-width: 66ch;
  }
  .tagline {
    margin: 0;
    color: var(--color-text-secondary);
    font-size: var(--explore-meta);
    line-height: 1.5;
  }
  .cover-top {
    display: flex;
    justify-content: flex-end;
    border-top: 1px solid var(--color-text-primary);
    padding: 4px 0 12px;
  }
  .text-link {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    font-size: var(--explore-meta);
    font-weight: 600;
  }
  .cover-spread {
    display: grid;
    grid-template-columns: minmax(0, 1.9fr) minmax(0, 1fr);
    gap: 32px;
  }
  .cover-spread.lead-only {
    grid-template-columns: 1fr;
  }
  .lead-only .lead {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
    gap: 32px;
    align-items: center;
  }
  .lead-image {
    display: block;
  }
  .lead-image :global(img) {
    max-height: 360px;
  }
  .lead-caption {
    padding-top: 20px;
  }
  .lead h2 {
    font-size: var(--explore-section);
    line-height: 1.08;
    margin: 0;
    max-width: 28ch;
    overflow-wrap: anywhere;
  }
  .lead h2 a {
    display: inline-block;
    min-height: 44px;
  }
  .byline {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    font-size: var(--explore-meta);
    line-height: 1.4;
    color: var(--color-caption);
  }
  .byline img {
    display: none;
  }
  .supporting {
    display: grid;
    gap: 24px;
    align-content: start;
    padding-left: 28px;
    border-left: 1px solid var(--color-input-border);
  }
  .supporting :global(.tile + .tile) {
    padding-top: 24px;
    border-top: 1px solid var(--color-input-border);
  }
  .supporting :global(.landing-img) {
    max-height: 160px;
  }
  .section {
    padding: 40px 0;
    border-top: 1px solid var(--color-text-primary);
  }
  .section-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 28px;
  }
  .section-top h2 {
    font-size: var(--explore-section);
    line-height: 1.08;
    margin: 0;
  }
  .recipe-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.12fr) minmax(0, 1fr);
    gap: 0 40px;
  }
  .recipe-grid li:first-child {
    grid-row: span 3;
  }
  .recipe-grid li:first-child :global(.tile-title) {
    font-size: var(--explore-section);
  }
  .recipe-grid li:not(:first-child) {
    padding: 20px 0;
    border-top: 1px solid var(--color-input-border);
  }
  .recipe-grid li:nth-child(2) {
    padding-top: 0;
    border-top: 0;
  }
  .recipe-grid li:not(:first-child) :global(.tile) {
    display: grid;
    grid-template-columns: 112px minmax(0, 1fr);
    gap: 18px;
  }
  .recipe-grid li:not(:first-child) :global(.tile-copy) {
    padding-top: 0;
  }
  .recipe-grid li:only-child {
    grid-column: 1 / -1;
  }
  .recipe-grid li:only-child :global(.tile) {
    display: grid;
    grid-template-columns: 1.2fr 1fr;
    gap: 28px;
  }
  .story-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    gap: 0 40px;
  }
  .story-grid li:first-child {
    grid-row: span 2;
  }
  .story-grid li:first-child :global(.tile-title) {
    font-size: var(--explore-section);
  }
  .story-grid li:not(:first-child) {
    padding: 24px 0;
    border-top: 1px solid var(--color-input-border);
  }
  .story-grid li:nth-child(2) {
    padding-top: 0;
    border-top: 0;
  }
  .story-grid li:not(:first-child) :global(.tile) {
    display: grid;
    grid-template-columns: 100px minmax(0, 1fr);
    gap: 18px;
  }
  .story-grid li:not(:first-child) :global(.tile-copy) {
    padding-top: 0;
  }
  .story-grid.single {
    grid-template-columns: 1fr;
  }
  .story-grid.single :global(.tile) {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    gap: 32px;
  }
  .subsection-top {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 8px 20px;
    margin-bottom: 24px;
  }
  .subsection-top h3 {
    font-size: var(--explore-title);
    margin: 0;
  }
  .subsection-top p {
    font-size: var(--explore-meta);
    color: var(--color-text-secondary);
    margin: 0;
  }
  .fresh-part + .fresh-part {
    margin-top: 32px;
    padding-top: 28px;
    border-top: 1px solid var(--color-input-border);
  }
  .topic-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 24px;
  }
  .topic-link {
    display: block;
  }
  .topic-link h4 {
    font-size: var(--explore-title);
    line-height: 1.12;
    margin: 14px 0 0;
  }
  .topic-link h4 :global(svg) {
    margin-left: 4px;
    width: 13px;
  }
  .topic-credit {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: var(--color-caption);
    font-size: var(--explore-meta);
    line-height: 1.4;
  }
  .community-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 32px;
  }
  .community-list li {
    display: grid;
    grid-template-columns: 104px minmax(0, 1fr);
    gap: 20px;
    padding: 20px 0;
    border-top: 1px solid var(--color-input-border);
  }
  .note-image {
    display: block;
    align-self: start;
  }
  .note-copy {
    min-width: 0;
  }
  .note-link {
    display: block;
    min-height: 44px;
  }
  .note-text {
    font-size: var(--explore-body);
    line-height: 1.5;
    margin: 0;
    display: -webkit-box;
    line-clamp: 3;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .paid-disclosure {
    font-size: var(--explore-meta);
    color: var(--color-caption);
  }
  .paid-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 28px;
  }
  .paid-label {
    display: block;
    font-size: var(--explore-meta);
    color: var(--color-caption);
    margin: 14px 0 8px;
  }
  .paid-grid h3 {
    font-size: var(--explore-title);
    margin: 0;
  }
  .paid-grid p {
    font-size: var(--explore-body);
    line-height: 1.5;
    color: var(--color-text-secondary);
  }
  .footer {
    border-top: 1px solid var(--color-input-border);
    padding-top: 24px;
    padding-bottom: 24px;
    display: flex;
    align-items: center;
    gap: 24px;
  }
  .footer-brand {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    flex-shrink: 0;
  }
  .footer-brand img {
    width: 160px;
    height: auto;
  }
  .logo-d {
    display: none;
  }
  :global(html.dark) .logo-l {
    display: none;
  }
  :global(html.dark) .logo-d {
    display: block;
  }
  .footer p {
    font-size: var(--explore-meta);
    color: var(--color-caption);
  }
  .footer nav {
    display: flex;
    gap: 20px;
    margin-left: auto;
    font-size: var(--explore-meta);
  }
  .footer nav a {
    display: inline-flex;
    align-items: center;
    min-width: 44px;
    min-height: 44px;
  }
  @media (min-width: 1024px) {
    .landing-body {
      margin-left: calc(14rem + 5px);
    }
  }
  @media (min-width: 1280px) {
    .landing-body {
      margin-left: calc(20rem + 5px);
    }
  }
  @media (max-width: 1100px) {
    .magazine {
      padding-left: 28px;
      padding-right: 28px;
    }
    .recipe-grid,
    .story-grid {
      column-gap: 28px;
    }
    .recipe-grid li:not(:first-child) :global(.tile),
    .story-grid li:not(:first-child) :global(.tile) {
      grid-template-columns: 88px minmax(0, 1fr);
      gap: 14px;
    }
    .supporting {
      padding-left: 20px;
    }
  }
  @media (max-width: 767px) {
    .landing-body {
      --explore-display: 36px;
      --explore-section: 28px;
      --explore-title: 22px;
    }
    .magazine {
      padding-left: 20px;
      padding-right: 20px;
    }
    .masthead {
      padding: 28px 0 24px;
    }
    h1 {
      line-height: 1.06;
      margin-bottom: 14px;
    }
    .cover-top {
      padding-bottom: 10px;
    }
    .cover-spread,
    .lead-only .lead {
      grid-template-columns: 1fr;
      gap: 28px;
    }
    .lead-image :global(img) {
      max-height: 240px;
    }
    .lead-caption {
      padding-top: 16px;
    }
    .supporting {
      grid-template-columns: 1fr;
      padding-left: 0;
      border-left: 0;
      gap: 0;
    }
    .supporting :global(.tile) {
      display: grid;
      grid-template-columns: 104px minmax(0, 1fr);
      gap: 18px;
      padding: 20px 0;
      border-top: 1px solid var(--color-input-border);
    }
    .supporting :global(.tile + .tile) {
      padding-top: 20px;
    }
    .supporting :global(.tile-copy) {
      padding-top: 0;
    }
    .supporting :global(.landing-img) {
      aspect-ratio: 4 / 3 !important;
    }
    .section {
      padding: 32px 0;
    }
    .section-top {
      margin-bottom: 24px;
      gap: 16px;
      align-items: center;
      flex-wrap: wrap;
    }
    .section-top .text-link {
      margin-left: auto;
    }
    .recipe-grid,
    .story-grid {
      grid-template-columns: 1fr;
      gap: 0;
    }
    .recipe-grid li:first-child,
    .story-grid li:first-child {
      grid-row: auto;
      margin-bottom: 24px;
    }
    .recipe-grid li:nth-child(2),
    .story-grid li:nth-child(2) {
      padding-top: 20px;
      border-top: 1px solid var(--color-input-border);
    }
    .recipe-grid li:not(:first-child) :global(.tile),
    .story-grid li:not(:first-child) :global(.tile) {
      grid-template-columns: 104px minmax(0, 1fr);
      gap: 18px;
    }
    .recipe-grid li:only-child :global(.tile),
    .story-grid.single :global(.tile) {
      display: block;
    }
    .story-grid li:not(:first-child) :global(.tile-summary) {
      font-size: var(--explore-meta);
      line-clamp: 3;
      -webkit-line-clamp: 3;
    }
    .topic-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 24px 20px;
    }
    .community-list {
      grid-template-columns: 1fr;
    }
    .subsection-top {
      gap: 8px;
      margin-bottom: 20px;
    }
    .subsection-top p {
      flex-basis: 100%;
    }
    .footer {
      flex-wrap: wrap;
      gap: 8px 24px;
    }
    .footer nav {
      margin-left: 0;
      width: 100%;
    }
  }
</style>
