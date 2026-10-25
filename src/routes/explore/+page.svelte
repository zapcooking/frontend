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
  import LandingMembership from '../../components/landing/LandingMembership.svelte';
  import LandingRecipePacks from '../../components/landing/LandingRecipePacks.svelte';

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
        <p class="brand-signature">Food. Friends. Freedom.</p>
        <h1 id="community-headline">{d.headline || DEFAULT_HEADLINE}</h1>
        <p class="intro">
          {d.supportingLine || EDITORIAL_SUPPORTING_LINE}
        </p>
      </section>

      {#if d.cover || d.picks.length}
        <section class="cover-section" aria-label="Featured recipes and food stories">
          <div class="cover-top">
            <p class="eyebrow">At the table today</p>
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
                  <p class="eyebrow">Featured recipe</p>
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
                    label={pick.type === 'article' ? 'Food story' : 'Cook something new'}
                    sizes="(min-width: 1280px) 24vw, (min-width: 768px) 28vw, 46vw"
                    widths={[320, 480, 640]}
                  />
                {/each}
              </div>
            {/if}
          </div>
        </section>
      {/if}

      <LandingImportHero />

      {#if d.newRecipes.length}
        <section class="section" aria-labelledby="recipes-heading">
          <div class="section-top">
            <div>
              <p class="eyebrow">From their kitchen to yours</p>
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

      {#if d.reads.length}
        <section class="section food-stories" aria-labelledby="stories-heading">
          <div class="section-top">
            <div>
              <p class="eyebrow">A little food for thought</p>
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
              <p class="eyebrow">Made, found, and shared</p>
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
              <ul class="community-grid" role="list">
                {#each d.fresh as note (note.id)}
                  <li>
                    <a
                      class="note-link"
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
                      {#if note.text}<p class="note-text">{note.text}</p>{/if}
                    </a>
                    <a class="byline" href={userHref(note.author.pubkey)}
                      >{note.author.name || 'A community cook'}</a
                    >
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
            <span class="eyebrow">Paid placements</span>
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
    background: var(--color-explore-cream);
    color: var(--color-text-primary);
    font-family: 'Albert Sans', ui-sans-serif, system-ui, sans-serif;
  }
  .landing-body {
    min-width: 0;
    min-height: 100vh;
  }
  .magazine {
    max-width: 1240px;
    margin: auto;
    padding: 0 32px;
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
  .landing :global(.text-secondary-landing) {
    color: var(--color-text-secondary);
  }
  .landing :global(.text-caption-landing) {
    color: var(--color-caption);
  }
  .masthead {
    padding: 28px 0 20px;
  }
  .brand-signature,
  .eyebrow {
    color: var(--color-primary);
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    margin: 0 0 10px;
  }
  h1,
  h2,
  h3,
  h4 {
    font-family: var(--font-editorial, Georgia, serif);
    font-weight: 500;
    letter-spacing: -0.035em;
  }
  h1 {
    font-size: clamp(32px, 3.4vw, 48px);
    line-height: 1.12;
    min-height: 1.12em;
    margin: 0 0 12px;
    text-wrap: balance;
  }
  .intro {
    color: var(--color-text-secondary);
    font-size: 15px;
    line-height: 1.6;
    margin: 0;
  }
  .cover-top,
  .section-top {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 20px;
  }
  .cover-top {
    align-items: center;
    border-top: 1px solid var(--color-input-border);
    margin-bottom: 14px;
  }
  .cover-top .eyebrow {
    margin: 0;
  }
  .text-link {
    display: inline-flex;
    align-items: center;
    justify-content: end;
    gap: 10px;
    min-height: 44px;
    font-size: 13px;
    font-weight: 600;
    flex-shrink: 0;
  }
  .cover-spread {
    display: grid;
    grid-template-columns: minmax(0, 1.9fr) minmax(0, 1fr);
    gap: 28px;
  }
  .cover-spread.lead-only {
    grid-template-columns: 1fr;
  }
  .lead-only .lead {
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 28px;
    align-items: center;
  }
  .lead-image {
    display: block;
  }
  .lead-image :global(img) {
    max-height: 350px;
  }
  .lead-caption {
    padding-top: 15px;
  }
  .lead-caption .eyebrow {
    margin-bottom: 7px;
  }
  .lead h2 {
    font-size: clamp(26px, 2.5vw, 36px);
    line-height: 1.1;
    margin: 0;
    overflow-wrap: anywhere;
  }
  .lead h2 a {
    display: inline-block;
    min-height: 44px;
  }
  .byline {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 44px;
    font-size: 12px;
    color: var(--color-caption);
  }
  .byline img {
    border-radius: 50%;
  }
  .supporting {
    display: grid;
    gap: 12px;
    align-content: start;
  }
  .supporting :global(.tile-title) {
    font-size: 23px;
  }
  .supporting :global(.landing-img) {
    max-height: 164px;
  }
  .section {
    padding: 36px 0;
    border-top: 1px solid var(--color-input-border);
  }
  .section-top h2 {
    font-size: clamp(29px, 2.6vw, 36px);
    line-height: 1.1;
    margin: 0;
  }
  .section-top .eyebrow {
    margin-bottom: 8px;
  }
  .recipe-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 24px;
  }
  .story-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 28px;
  }
  .story-grid :global(.tile-title) {
    font-size: 26px;
  }
  .story-grid.single :global(.tile) {
    display: grid;
    grid-template-columns: 1.2fr 1fr;
    gap: 0 28px;
  }
  .story-grid.single :global(.tile-content) {
    grid-row: span 2;
  }
  .story-grid.single :global(.tile-byline) {
    align-self: start;
  }
  .subsection-top {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 8px 20px;
    margin-bottom: 18px;
  }
  .subsection-top h3 {
    font-size: 25px;
    margin: 0;
  }
  .subsection-top p {
    font-size: 13px;
    color: var(--color-text-secondary);
    margin: 0;
  }
  .fresh-part + .fresh-part {
    margin-top: 32px;
    padding-top: 26px;
    border-top: 1px solid var(--color-input-border);
  }
  .topic-grid,
  .community-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(145px, 1fr));
    gap: 20px;
  }
  .topic-link,
  .note-link {
    display: block;
  }
  .topic-link h4 {
    font-size: 20px;
    line-height: 1.2;
    margin: 12px 0 0;
  }
  .topic-link h4 :global(svg) {
    margin-left: 5px;
  }
  .topic-credit {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: var(--color-caption);
    font-size: 11px;
    line-height: 1.4;
  }
  .note-text {
    font-size: 13px;
    line-height: 1.6;
    color: var(--color-text-secondary);
    margin: 10px 0 0;
    display: -webkit-box;
    line-clamp: 3;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .paid-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 24px;
  }
  .paid-label {
    display: block;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-caption);
    margin: 12px 0 8px;
  }
  .paid-grid h3 {
    font-size: 23px;
    margin: 0;
  }
  .paid-grid p {
    font-size: 13px;
    color: var(--color-text-secondary);
  }
  .footer {
    border-top: 1px solid var(--color-input-border);
    padding-top: 26px;
    padding-bottom: 26px;
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
    color: var(--color-caption);
  }
  .footer nav {
    display: flex;
    gap: 20px;
    margin-left: auto;
    font-size: 12px;
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
  @media (max-width: 767px) {
    .magazine {
      padding-left: 18px;
      padding-right: 18px;
    }
    .masthead {
      padding: 21px 0 14px;
    }
    h1 {
      font-size: 32px;
      min-height: 2.24em;
      margin-bottom: 9px;
    }
    .brand-signature {
      font-size: 9px;
      margin-bottom: 9px;
    }
    .intro {
      font-size: 13px;
      line-height: 1.5;
    }
    .cover-spread,
    .lead-only .lead {
      grid-template-columns: 1fr;
      gap: 18px;
    }
    .lead-image :global(img) {
      max-height: 190px;
    }
    .lead-caption {
      padding-top: 11px;
    }
    .lead h2 {
      font-size: 27px;
    }
    .lead-caption .eyebrow {
      display: none;
    }
    .supporting {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }
    .supporting :global(.tile-title) {
      font-size: 19px;
    }
    .supporting :global(.tile-byline) {
      font-size: 11px;
    }
    .supporting :global(.tile-byline img) {
      display: none;
    }
    .section {
      padding: 28px 0;
    }
    .section-top {
      gap: 12px;
      align-items: start;
    }
    .section-top h2 {
      font-size: 29px;
    }
    .section-top .text-link {
      max-width: 114px;
      text-align: right;
      font-size: 12px;
    }
    .recipe-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 22px 16px;
    }
    .story-grid {
      grid-template-columns: 1fr;
      gap: 24px;
    }
    .story-grid :global(.tile-title) {
      font-size: 25px;
    }
    .story-grid.single :global(.tile) {
      display: block;
    }
    .topic-grid,
    .community-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }
    .subsection-top h3 {
      font-size: 24px;
    }
    .fresh-part + .fresh-part {
      margin-top: 22px;
      padding-top: 22px;
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
  @media (max-width: 767px) and (max-height: 720px) {
    .masthead {
      padding: 14px 0 10px;
    }
    h1 {
      font-size: 30px;
    }
    .intro {
      font-size: 12px;
    }
    .lead-image :global(img) {
      max-height: 155px;
    }
    .lead h2 {
      font-size: 25px;
    }
  }
</style>
