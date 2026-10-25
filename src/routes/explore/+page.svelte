<script lang="ts">
  import Arrow from '../../components/landing/Arrow.svelte';
  import { CHEFFY_TRIAL_LIMIT } from '$lib/cheffyTrial';
  import type { PageData } from './$types';
  import { avatarUrl } from '$lib/imageOptimizer';
  import { responsiveImg } from '$lib/landing/responsiveImg';
  import { userHref } from '$lib/landing/content';
  import {
    ANDROID_APP_URL,
    landingJsonLd,
    landingMeta,
    NOSCRIPT_DARK_STYLE
  } from '$lib/landing/meta';
  import LandingHeader from '../../components/landing/LandingHeader.svelte';
  import LandingSideNav from '../../components/landing/LandingSideNav.svelte';
  import LandingImage from '../../components/landing/LandingImage.svelte';
  import LongformTile from '../../components/landing/LongformTile.svelte';
  import LandingImportHero from '../../components/landing/LandingImportHero.svelte';
  import LandingMembership from '../../components/landing/LandingMembership.svelte';
  import LandingRecipePacks from '../../components/landing/LandingRecipePacks.svelte';
  import { magazineText, magazineName } from '$lib/landing/display';

  export let data: PageData;
  $: d = data.landing;
  $: paid = data.paid;
  $: meta = landingMeta(d);
  $: hero = d.cover
    ? responsiveImg(
        d.cover.image,
        [480, 768, 1200],
        '(min-width: 1280px) 45vw, (min-width: 1024px) 50vw, (min-width: 768px) 60vw, 100vw'
      )
    : null;
  const avatar = (url: string | undefined) => (url ? avatarUrl(url, 80) || url : undefined);
  const discoveries = [
    {
      name: 'Fresh',
      href: '/feed?tab=fresh',
      body: 'A little of what everyone is cooking.',
      number: '01'
    },
    {
      name: 'Cheffy',
      href: '/cheffy',
      body: 'Your kitchen assistant for ideas and cooking questions.',
      number: '02'
    },
    {
      name: 'The Android app',
      href: ANDROID_APP_URL,
      body: 'Take your kitchen with you.',
      number: '03'
    }
  ];
</script>

<svelte:head>
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
      <div class="masthead">
        <p class="intro">
          Discover recipes, recipe packs, reads, and cooks. Save your favorites and share what you
          make.
        </p>
        <form action="/search" method="GET" class="search" role="search">
          <label for="recipe-search" class="sr-only">Search recipes</label>
          <input type="hidden" name="type" value="recipes" />
          <input
            id="recipe-search"
            type="search"
            name="q"
            placeholder="What would you like to cook?"
            required
          />
          <button type="submit" aria-label="Search recipes">Search <Arrow /></button>
        </form>
      </div>

      {#if d.cover || d.picks.length}
        <section class="cover-section" aria-label="The cover selection">
          <div class="section-top">
            <p class="eyebrow">Featured recipes</p>
            <a class="text-link" href={data.nextEditionHref}>More inspiration <Arrow /></a>
          </div>
          <div class="cover-spread">
            {#if d.cover}
              <article class="lead">
                <a href={d.cover.href} class="lead-image"
                  ><LandingImage
                    url={d.cover.image}
                    alt={magazineText(d.cover.title) || 'Recipe from the kitchen'}
                    ratio="16 / 10"
                    widths={[480, 768, 1200]}
                    sizes="(min-width: 1280px) 45vw, (min-width: 1024px) 50vw, (min-width: 768px) 60vw, 100vw"
                    rounded="rounded-xl"
                    hero
                  /></a
                >
                <div class="lead-caption">
                  <p class="eyebrow">Featured recipe</p>
                  <h2>
                    <a href={d.cover.href}>{magazineText(d.cover.title) || 'From the kitchen'}</a>
                  </h2>
                  <a class="byline" href={userHref(d.cover.author.pubkey)}
                    >{#if d.cover.author.picture}<img
                        src={avatar(d.cover.author.picture)}
                        alt=""
                        width="28"
                        height="28"
                      />{/if}By {magazineName(d.cover.author.name)}</a
                  >
                </div>
              </article>
            {/if}
            {#if d.picks.length}<div class="supporting">
                {#each d.picks as pick (pick.coordinate)}<LongformTile
                    card={pick}
                    ratio="16 / 9"
                    sizes="(min-width: 768px) 28vw, 46vw"
                    widths={[320, 480, 640]}
                  />{/each}
              </div>{/if}
          </div>
        </section>
      {/if}

      <LandingImportHero />

      {#if d.newRecipes.length}
        <section class="section" aria-labelledby="dinner-heading">
          <div class="section-top">
            <div>
              <p class="eyebrow">From their kitchen to yours</p>
              <h2 id="dinner-heading">Recipes to try</h2>
            </div>
            <a class="text-link" href="/recipes">All recipes <Arrow /></a>
          </div>
          <ul class="recipe-grid" role="list">
            {#each d.newRecipes.slice(0, 4) as recipe (recipe.coordinate)}<li>
                <LongformTile card={recipe} />
              </li>{/each}
          </ul>
        </section>
      {/if}

      <LandingRecipePacks packs={d.packs ?? []} />

      {#if d.collections.length}
        <section id="collections" class="section" aria-labelledby="collections-heading">
          <div class="section-top">
            <div>
              <p class="eyebrow">Follow your appetite</p>
              <h2 id="collections-heading">Recipe collections</h2>
            </div>
          </div>
          <ul class="collection-grid" role="list">
            {#each d.collections as collection (collection.slug)}<li>
                <a href={collection.href} class="collection"
                  ><LandingImage
                    url={collection.image}
                    alt=""
                    ratio="4 / 3"
                    rounded="rounded-xl"
                    sizes="(min-width: 768px) 25vw, 46vw"
                  />
                  <h3>{collection.name} <Arrow /></h3>
                  <p>{collection.description}</p></a
                >
              </li>{/each}
          </ul>
        </section>
      {/if}

      {#if d.spotlights.length}
        <section class="section" aria-labelledby="cooks-heading">
          <div class="section-top">
            <div>
              <p class="eyebrow">Meet the people behind the plate</p>
              <h2 id="cooks-heading">Cooks to follow</h2>
            </div>
          </div>
          <ul class="cook-grid" role="list">
            {#each d.spotlights as cook (cook.pubkey)}<li class="cook">
                <a href={cook.href} class="cook-person"
                  >{#if cook.picture}<img
                      src={avatar(cook.picture)}
                      alt=""
                      width="56"
                      height="56"
                      loading="lazy"
                    />{/if}
                  <h3>{magazineName(cook.name)}</h3></a
                >{#if magazineText(cook.about)}<p class="cook-about">
                    {magazineText(cook.about)}
                  </p>{/if}<a href={cook.recipe.href} class="cook-recipe"
                  ><LandingImage
                    url={cook.recipe.image}
                    alt={magazineText(cook.recipe.title)}
                    ratio="4 / 3"
                    rounded="rounded-xl"
                  /><span
                    >{magazineText(cook.recipe.title) || 'Explore their recipe'} <Arrow /></span
                  ></a
                >
              </li>{/each}
          </ul>
        </section>
      {/if}
      {#if d.reads[0]}
        {@const story = d.reads[0]}
        <section class="story section" aria-labelledby="story-heading">
          <a href={story.href}
            ><LandingImage
              url={story.image}
              alt={magazineText(story.title)}
              ratio="4 / 3"
              widths={[480, 768, 1024]}
              rounded="rounded-xl"
            /></a
          >
          <div>
            <p class="eyebrow">From Reads</p>
            <h2 id="story-heading">
              <a href={story.href}>{magazineText(story.title) || 'Food for thought'}</a>
            </h2>
            {#if magazineText(story.summary)}<p>{magazineText(story.summary)}</p>{/if}
            <p class="byline">By {magazineName(story.author.name)}</p>
            <a class="text-link" href={story.href}>Read the story <Arrow /></a>
          </div>
        </section>
      {/if}

      {#if d.fresh.length}
        <section class="section" aria-labelledby="community-heading">
          <div class="section-top">
            <div>
              <p class="eyebrow">Pull up a chair</p>
              <h2 id="community-heading">From the community kitchen</h2>
            </div>
            <a class="text-link" href="/feed?tab=fresh">See what’s cooking <Arrow /></a>
          </div>
          <ul class="community-grid" role="list">
            {#each d.fresh.slice(0, 4) as note (note.id)}<li>
                <a href={note.href}
                  ><LandingImage
                    url={note.image}
                    alt={magazineText(note.text) || 'From the community kitchen'}
                    ratio="1 / 1"
                    rounded="rounded-xl"
                    widths={[240, 360, 480]}
                  />{#if magazineText(note.text)}<p class="note-text">
                      {magazineText(note.text)}
                    </p>{/if}
                  <p class="byline">{magazineName(note.author.name)}</p></a
                >
              </li>{/each}
          </ul>
        </section>
      {/if}

      {#if paid.boosts.length || paid.sponsors.length}
        <section class="section paid-section" aria-labelledby="partners-heading">
          <div class="section-top">
            <h2 id="partners-heading">Featured partners</h2>
            <span class="eyebrow">Paid placements</span>
          </div>
          <ul class="paid-grid" role="list">
            {#each paid.boosts as boost (boost.id)}<li>
                <a href={boost.href} rel="sponsored"
                  >{#if boost.image}<LandingImage
                      url={boost.image}
                      alt={magazineText(boost.title)}
                      ratio="16 / 9"
                    />{/if}<span class="paid-label">Boosted · Paid placement</span>
                  <h3>{magazineText(boost.title) || 'Featured recipe'}</h3></a
                >
              </li>{/each}{#each paid.sponsors as sponsor (sponsor.id)}<li>
                <a href={sponsor.linkUrl} rel="sponsored noopener" target="_blank"
                  >{#if sponsor.imageUrl}<LandingImage
                      url={sponsor.imageUrl}
                      alt=""
                      ratio="16 / 9"
                    />{/if}<span class="paid-label">Sponsored</span>
                  <h3>{magazineText(sponsor.title) || 'Our partner'}</h3>
                  <p>{magazineText(sponsor.description)}</p></a
                >
              </li>{/each}
          </ul>
          <a class="text-link" href="/sponsors">About our sponsors <Arrow /></a>
        </section>
      {/if}

      <section class="section discoveries" aria-labelledby="discover-heading">
        <p class="eyebrow" id="discover-heading">More to explore</p>
        <ul role="list">
          {#each discoveries as item}<li>
              <a href={item.href}
                ><span class="discovery-number">{item.number}</span>
                <h3>{item.name} <Arrow /></h3>
                <p>{item.body}</p>
                {#if item.href === '/cheffy'}
                  <span class="trial-invitation" data-landing-upgrade hidden
                    >Try {CHEFFY_TRIAL_LIMIT} free messages per account, then continue with Cook+.</span
                  >
                {/if}</a
              >
            </li>{/each}
        </ul>
      </section>
      <LandingMembership />
    </main>
    <footer class="magazine footer">
      <a href="/explore" aria-label="Zap Cooking home" class="footer-brand">
        <img src="/zapcooking-text-light.svg" class="logo-l" alt="" width="160" height="22" />
        <img src="/zapcooking-text-dark.svg" class="logo-d" alt="" width="160" height="22" />
      </a>
      <p>Food is culture. Food is community.</p>
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
    min-width: 0;
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
  .magazine {
    max-width: 1200px;
    margin: auto;
    padding: 0 32px;
  }
  .landing :global(h1),
  .landing :global(h2),
  .landing :global(h3),
  .landing :global(.font-display) {
    font-family: inherit;
    letter-spacing: -0.025em;
    font-weight: 700;
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
  .landing :global(.text-secondary-landing) {
    color: var(--color-text-secondary);
  }
  .landing :global(.text-caption-landing) {
    color: var(--color-caption);
  }
  .landing :global(ul) {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .masthead {
    padding: 28px 0;
    text-align: left;
  }
  .eyebrow {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    font-weight: 700;
    color: var(--color-primary);
    margin: 0 0 12px;
  }
  .intro {
    font-size: 15px;
    line-height: 1.65;
    color: var(--color-text-secondary);
    margin: 0;
  }
  .search {
    display: flex;
    max-width: 470px;
    margin: 20px 0 0;
    border: 1px solid var(--color-input-border);
    border-radius: 12px;
    background: var(--color-bg-primary);
  }
  .search input {
    min-width: 0;
    flex: 1;
    padding: 12px 15px;
    background: transparent;
    border: 0;
    font-size: 14px;
    color: inherit;
  }
  .search button {
    min-height: 48px;
    padding: 0 17px;
    border: 0;
    border-left: 1px solid var(--color-input-border);
    color: var(--color-primary);
    font-weight: 600;
  }
  .search button :global(svg) {
    margin-left: 8px;
  }
  .section-top {
    display: flex;
    justify-content: space-between;
    align-items: end;
    gap: 20px;
    margin-bottom: 22px;
  }
  .section-top .eyebrow {
    margin-bottom: 8px;
  }
  .cover-section > .section-top {
    border-top: 1px solid var(--color-input-border);
    padding-top: 15px;
    margin-bottom: 15px;
    align-items: center;
  }
  .cover-section > .section-top .eyebrow {
    margin: 0;
  }
  .text-link {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    gap: 12px;
    font-size: 13px;
    font-weight: 600;
  }
  .cover-spread {
    display: grid;
    grid-template-columns: 1.85fr 1fr;
    gap: 28px;
  }
  .lead-image :global(img) {
    max-height: 370px;
  }
  .lead-image {
    border-radius: 12px;
    display: block;
    overflow: hidden;
  }
  .lead-caption {
    padding: 18px 0 8px;
  }
  .lead-caption .eyebrow {
    margin-bottom: 8px;
  }
  h2 {
    font-size: clamp(24px, 2.6vw, 30px);
    line-height: 1.13;
    margin: 0;
  }
  .lead h2 {
    font-size: clamp(24px, 2.8vw, 32px);
    margin-bottom: 8px;
  }
  .byline {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    font-size: 12px;
    color: var(--color-text-secondary);
  }
  .byline img {
    border-radius: 50%;
  }
  .supporting {
    display: grid;
    gap: 25px;
  }
  .supporting :global(.tile-title) {
    font-size: 23px;
  }
  .section {
    padding: 44px 0;
    border-top: 1px solid var(--color-input-border);
  }
  .recipe-grid,
  .collection-grid,
  .community-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 24px;
  }
  .collection {
    display: block;
  }
  .collection h3 {
    font-size: 22px;
    line-height: 1.2;
    margin: 16px 0 8px;
  }
  .collection h3 :global(svg) {
    margin-left: 6px;
  }
  .collection p,
  .discoveries p {
    font-size: 13px;
    line-height: 1.6;
    color: var(--color-text-secondary);
  }
  .cook-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 28px;
  }
  .cook {
    border-radius: 12px;
    padding: 20px;
    background: var(--color-bg-secondary);
  }
  .cook-person {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 56px;
  }
  .cook-person img {
    border-radius: 50%;
  }
  .cook h3 {
    font-size: 25px;
  }
  .cook-about {
    font-size: 14px;
    line-height: 1.7;
    color: var(--color-text-secondary);
    margin: 16px 0;
  }
  .cook-recipe {
    display: block;
    margin-top: 18px;
  }
  .cook-recipe > span {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    padding-top: 12px;
    min-height: 44px;
    font-size: 14px;
  }
  .story {
    display: grid;
    grid-template-columns: 1fr 1fr;
    align-items: center;
    gap: 44px;
  }
  .story h2 {
    margin-bottom: 18px;
  }
  .story p:not(.eyebrow):not(.byline) {
    color: var(--color-text-secondary);
    font-size: 15px;
    line-height: 1.8;
  }
  .note-text {
    margin-top: 13px;
    font-size: 14px;
    line-height: 1.6;
    display: -webkit-box;
    line-clamp: 3;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .paid-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 24px;
  }
  .paid-label {
    display: block;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 12px 0;
  }
  .paid-grid h3 {
    font-size: 24px;
  }
  .paid-grid p {
    font-size: 14px;
  }
  .discoveries ul {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 26px;
  }
  .discoveries li a {
    display: block;
    padding: 14px 0;
  }
  .trial-invitation:not([hidden]) {
    display: block;
  }
  .trial-invitation {
    margin-top: 10px;
    color: var(--color-primary);
    font-size: 13px;
    font-weight: 600;
  }
  .discovery-number {
    font-size: 11px;
    color: var(--color-primary);
  }
  .discoveries h3 {
    font-size: 23px;
    margin: 12px 0 8px;
  }
  .discoveries h3 span {
    font-family: system-ui;
    font-size: 16px;
  }
  .footer {
    border-top: 1px solid var(--color-input-border);
    padding-top: 32px;
    padding-bottom: 32px;
    margin-top: 48px;
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
    font-size: 12px;
    color: var(--color-text-secondary);
    max-width: 240px;
  }
  .footer nav {
    display: flex;
    gap: 20px;
    margin-left: auto;
    font-size: 12px;
  }
  .footer nav a {
    min-width: 44px;
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
  @media (max-width: 767px) {
    .magazine {
      padding-left: 20px;
      padding-right: 20px;
    }
    .masthead {
      padding: 26px 0 23px;
    }
    .intro {
      font-size: 13px;
    }
    .search {
      margin-top: 18px;
    }
    .search input {
      font-size: 13px;
      padding-left: 12px;
    }
    .cover-spread {
      grid-template-columns: 1fr;
      gap: 18px;
    }
    .lead-image :global(img) {
      max-height: 180px;
    }
    .lead-caption {
      padding-top: 12px;
    }
    .lead h2 {
      font-size: 29px;
    }
    .lead-caption .eyebrow {
      display: none;
    }
    .supporting {
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .supporting :global(.tile-title) {
      font-size: 18px;
    }
    .section {
      padding: 30px 0;
    }
    .section-top {
      gap: 10px;
      align-items: start;
    }
    .section-top h2 {
      font-size: 28px;
    }
    .section-top .text-link {
      text-align: right;
      flex-shrink: 0;
      max-width: 105px;
      font-size: 12px;
    }
    .recipe-grid,
    .collection-grid,
    .community-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 24px 16px;
    }
    .collection h3 {
      font-size: 21px;
    }
    .cook-grid {
      grid-template-columns: 1fr;
      gap: 16px;
    }
    .story {
      grid-template-columns: 1fr;
      gap: 23px;
    }
    .discoveries ul {
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .footer {
      flex-wrap: wrap;
      gap: 12px 24px;
    }
    .footer nav {
      margin-left: 0;
      width: 100%;
    }
  }
  @media (max-width: 767px) and (max-height: 720px) {
    .masthead {
      padding: 14px 0;
    }
    .intro {
      font-size: 12px;
    }
    .search {
      margin-top: 12px;
    }
    .lead-image :global(img) {
      max-height: 145px;
    }
    .lead h2 {
      font-size: 25px;
    }
  }
</style>
