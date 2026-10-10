<script lang="ts">
  /**
   * /explore (magazine landing), built at /explore/next until the cutover.
   * Server-rendered with `csr = false`: no client JS, the root layout renders
   * only this page (see $lib/landing/route), and every section is in the
   * HTML so the page is complete with JavaScript off.
   */
  import type { PageData } from './$types';
  import { CURATED_TAG_SECTIONS } from '$lib/consts';
  import { COOK_PLUS_TOOLS } from '$lib/cookPlusCopy';
  import { avatarUrl } from '$lib/imageOptimizer';
  import { responsiveImg } from '$lib/landing/responsiveImg';
  import { shortName, tagHref, topicCountLabel } from '$lib/landing/display';
  import { userHref } from '$lib/landing/content';
  import { landingJsonLd, landingMeta, NOSCRIPT_DARK_STYLE } from '$lib/landing/meta';
  import LandingHeader from '../../../components/landing/LandingHeader.svelte';
  import LandingImage from '../../../components/landing/LandingImage.svelte';
  import LongformTile from '../../../components/landing/LongformTile.svelte';
  import Footer from '../../../components/Footer.svelte';

  export let data: PageData;

  $: d = data.landing;
  $: paid = data.paid;
  $: meta = landingMeta(d);
  $: hero = d.cover ? responsiveImg(d.cover.image, [480, 768, 1200], '(min-width: 1024px) 66vw, 100vw') : null;

  const avatar = (url: string | undefined, px: number) => (url ? avatarUrl(url, px) || url : undefined);

  const FREE_TOOLS = [
    { name: 'Recipes', href: '/recipes', body: 'Thousands of recipes from cooks everywhere, free to cook and share.' },
    { name: 'The feed', href: '/feed', body: 'What cooks are making right now, straight from the kitchen.' },
    { name: 'Recipe Packs', href: '/packs', body: 'Collections of recipes put together by the community.' },
    { name: 'Share a recipe', href: '/create', body: 'Publish your own. You keep it, everyone can cook it.' },
    { name: 'Import a recipe', href: '/souschef', body: 'Paste a link and get a clean recipe you can save.' }
  ];
</script>

<svelte:head>
  <title>{meta.title}</title>
  <meta name="description" content={meta.description} />
  <meta name="robots" content="noindex" />
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
  <LandingHeader />

  <main id="main" class="mx-auto max-w-6xl px-4 pb-16">
    <!-- Masthead -->
    <div class="masthead">
      <p class="kicker">Updated daily</p>
      <h1 class="font-display">Recipes, cooks and food stories, open to everyone.</h1>
      <p class="dek">
        Zap Cooking is a kitchen on Nostr: cook from thousands of recipes, follow the people who make them,
        and send them a zap when a dish turns out great.
      </p>
      <p class="cta-row">
        <a href="/login" class="btn-primary">Join free</a>
        <a href="/recipes" class="btn-quiet">Browse recipes <span aria-hidden="true">→</span></a>
      </p>
    </div>

    <!-- 1. Cover story + picks -->
    <section aria-labelledby="cover-h" class="cover-grid">
      {#if d.cover}
        <article class="cover">
          <a href={d.cover.href} class="cover-link">
            <LandingImage
              url={d.cover.image}
              alt={d.cover.title}
              ratio="4 / 3"
              widths={[480, 768, 1200]}
              sizes="(min-width: 1024px) 66vw, 100vw"
              hero
            />
            <p class="kicker mt-4">Cover story</p>
            <h2 id="cover-h" class="font-display cover-title">{d.cover.title}</h2>
          </a>
          {#if d.cover.summary}<p class="dek">{d.cover.summary}</p>{/if}
          <p class="byline">
            by <a href={userHref(d.cover.author.pubkey)}>{d.cover.author.name || shortName(d.cover.author.pubkey)}</a>
          </p>
        </article>
      {:else}
        <!-- Never an empty cover: an editorial one when no photo is available. -->
        <article class="cover cover-static">
          <p class="kicker">Cover story</p>
          <h2 id="cover-h" class="font-display cover-title">Food is open source.</h2>
          <p class="dek">Every recipe here belongs to the cook who wrote it, and anyone can cook it.</p>
          <p><a href="/recipes" class="btn-primary">Start cooking</a></p>
        </article>
      {/if}
      {#if d.picks.length}
        <aside aria-label="Editor's picks" class="picks">
          <p class="kicker">Editor's picks</p>
          {#each d.picks as pick (pick.coordinate)}
            <LongformTile card={pick} sizes="(min-width: 1024px) 30vw, 100vw" widths={[320, 480, 640]} />
          {/each}
        </aside>
      {/if}
    </section>

    <!-- 1b. Boosted recipes (paid) -->
    {#if paid.boosts.length}
      <section aria-labelledby="boosted-h" class="band">
        <div class="band-head">
          <h2 id="boosted-h" class="font-display">Boosted recipes</h2>
          <p class="paid-label">Paid placement</p>
        </div>
        <ul class="grid-4" role="list">
          {#each paid.boosts as b (b.id)}
            <li>
              <a href={b.href} class="tile-plain">
                {#if b.image}
                  <LandingImage url={b.image} alt={b.title} ratio="4 / 3" sizes="(min-width: 1024px) 25vw, 50vw" widths={[320, 480, 640]} />
                {/if}
                <span class="badge-paid">Boosted</span>
                <h3 class="font-display text-lg leading-snug">{b.title}</h3>
              </a>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <!-- 2. Fresh from the kitchen -->
    {#if d.fresh.length}
      <section aria-labelledby="fresh-h" class="band">
        <div class="band-head">
          <h2 id="fresh-h" class="font-display">Fresh from the kitchen</h2>
          <a href="/feed" class="more">See the Fresh feed <span aria-hidden="true">→</span></a>
        </div>
        <ul class="row" role="list" aria-label="Recent posts">
          {#each d.fresh as note (note.id)}
            <li class="row-item">
              <a href={note.href} class="tile-plain">
                <LandingImage url={note.image} alt={note.text || `A photo by ${note.author.name || 'a cook'}`} ratio="1 / 1" sizes="(min-width: 1024px) 16vw, 45vw" widths={[240, 360, 480]} />
                {#if note.text}<p class="note-text">{note.text}</p>{/if}
                <p class="byline">{note.author.name || shortName(note.author.pubkey)}</p>
              </a>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <!-- 2b. New recipes -->
    {#if d.newRecipes.length}
      <section aria-labelledby="new-h" class="band">
        <div class="band-head">
          <h2 id="new-h" class="font-display">New recipes</h2>
          <a href="/recent" class="more">All new recipes <span aria-hidden="true">→</span></a>
        </div>
        <ul class="grid-4" role="list">
          {#each d.newRecipes as r (r.coordinate)}
            <li><LongformTile card={r} /></li>
          {/each}
        </ul>
      </section>
    {/if}

    <!-- 3. Topics -->
    {#if d.topics.length}
      <section aria-labelledby="topics-h" class="band">
        <div class="band-head">
          <h2 id="topics-h" class="font-display">Topics</h2>
          <a href="/feed" class="more">Open the feed <span aria-hidden="true">→</span></a>
        </div>
        <ul class="grid-4" role="list">
          {#each d.topics as t (t.slug)}
            <li>
              <a href={t.href} class="topic">
                <LandingImage url={t.image} alt="" ratio="3 / 2" sizes="(min-width: 1024px) 25vw, 50vw" widths={[320, 480]} />
                <span class="topic-text">
                  <span class="topic-name font-display">{t.name}</span>
                  {#if t.count !== null}<span class="topic-count">{topicCountLabel(t.count)}</span>{/if}
                </span>
              </a>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <!-- 4. Cooks to follow -->
    {#if d.cooks.length}
      <section aria-labelledby="cooks-h" class="band">
        <div class="band-head">
          <h2 id="cooks-h" class="font-display">Cooks to follow</h2>
        </div>
        <ul class="row" role="list" aria-label="Cooks">
          {#each d.cooks as c (c.pubkey)}
            <li class="cook">
              <a href={c.href} class="cook-link">
                {#if c.picture}
                  <img src={avatar(c.picture, 160)} alt="" width="80" height="80" loading="lazy" decoding="async" class="cook-avatar" />
                {:else}
                  <span class="cook-avatar cook-initial" aria-hidden="true">{c.name.slice(0, 1).toUpperCase()}</span>
                {/if}
                <span class="cook-name">{c.name}</span>
              </a>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <!-- 5. Food reads -->
    {#if d.reads.length}
      <section aria-labelledby="reads-h" class="band">
        <div class="band-head">
          <h2 id="reads-h" class="font-display">Food reads</h2>
          <a href="/reads" class="more">More reads <span aria-hidden="true">→</span></a>
        </div>
        <ul class="grid-2" role="list">
          {#each d.reads as r (r.coordinate)}
            <li><LongformTile card={r} ratio="16 / 9" sizes="(min-width: 768px) 50vw, 100vw" widths={[480, 768, 1024]} showSummary /></li>
          {/each}
        </ul>
      </section>
    {/if}

    <!-- 6. Browse by tag -->
    <section aria-labelledby="tags-h" class="band">
      <div class="band-head"><h2 id="tags-h" class="font-display">Browse by tag</h2></div>
      {#each CURATED_TAG_SECTIONS as group (group.title)}
        <h3 class="tag-group">{group.title}</h3>
        <ul class="chips" role="list">
          {#each group.tags as tag (tag)}
            <li><a href={tagHref(tag)} class="chip">{tag}</a></li>
          {/each}
        </ul>
      {/each}
    </section>

    <!-- 7. What you can do here -->
    <section aria-labelledby="tools-h" class="band">
      <div class="band-head"><h2 id="tools-h" class="font-display">What you can do here</h2></div>
      <ul class="grid-tools" role="list">
        {#each FREE_TOOLS as tool (tool.href)}
          <li>
            <a href={tool.href} class="tool">
              <h3 class="font-display text-lg">{tool.name}</h3>
              <p>{tool.body}</p>
            </a>
          </li>
        {/each}
      </ul>
    </section>

    <!-- 8. Membership -->
    <section aria-labelledby="member-h" class="band membership">
      <h2 id="member-h" class="font-display">Membership</h2>
      <p class="dek">Members get the kitchen tools, private groups, and the archive of everything they've posted.</p>
      <ul class="member-tools" role="list">
        {#each COOK_PLUS_TOOLS as tool (tool.key)}
          <li><strong>{tool.name}.</strong> {tool.short}</li>
        {/each}
      </ul>
      <p><a href="/membership" class="btn-primary">About membership</a></p>
    </section>

    <!-- 9. Partners (paid) -->
    {#if paid.sponsors.length}
      <section aria-labelledby="partners-h" class="band">
        <div class="band-head">
          <h2 id="partners-h" class="font-display">Supported by our partners</h2>
          <a href="/sponsors" class="more">About sponsors <span aria-hidden="true">→</span></a>
        </div>
        <ul class="grid-2" role="list">
          {#each paid.sponsors as s (s.id)}
            <li>
              <a href={s.linkUrl} class="sponsor" rel="sponsored noopener" target="_blank">
                <span class="badge-paid">Sponsored</span>
                {#if s.imageUrl}
                  <img src={s.imageUrl} alt="" loading="lazy" decoding="async" class="sponsor-img" />
                {/if}
                <span class="sponsor-title font-display">{s.title}</span>
                {#if s.description}<span class="sponsor-desc">{s.description}</span>{/if}
              </a>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </main>

  <div class="mx-auto max-w-6xl px-4"><Footer /></div>
</div>

<style>
  .landing {
    /* White on accent-bg and accent-text on the page pass 4.5:1 in both themes. */
    --landing-accent-text: #b83900;
    --landing-accent-bg: #b83900;
    --landing-muted: var(--color-text-secondary);
    min-height: 100vh;
    /* System text: no web-font download competing with the hero image. */
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    background-color: var(--color-bg-primary);
    color: var(--color-text-primary);
  }
  :global(html.dark) .landing {
    --landing-accent-text: #ff8a5c;
    --landing-accent-bg: #b83900;
  }
  .landing :global(.font-display) {
    font-family: 'Iowan Old Style', 'Palatino Linotype', Charter, 'Bitstream Charter', Georgia, serif;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .landing :global(.text-secondary-landing) {
    color: var(--landing-muted);
  }
  .landing :global(.text-caption-landing) {
    color: var(--color-caption);
  }
  .landing a {
    color: inherit;
  }
  .landing :global(a:focus-visible) {
    outline: 2px solid var(--landing-accent-text);
    outline-offset: 3px;
    border-radius: 6px;
  }

  .kicker {
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--landing-accent-text);
  }
  .masthead {
    padding: 2.5rem 0 2rem;
    border-bottom: 1px solid var(--color-input-border);
    margin-bottom: 2rem;
    max-width: 48rem;
  }
  .masthead h1 {
    font-size: clamp(2rem, 5vw, 3.25rem);
    line-height: 1.1;
    margin: 0.5rem 0 1rem;
  }
  .dek {
    font-size: 1.05rem;
    line-height: 1.6;
    color: var(--landing-muted);
    margin: 0.5rem 0;
  }
  .cta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-top: 1.25rem;
  }
  .btn-primary {
    display: inline-block;
    padding: 0.65rem 1.2rem;
    border-radius: 999px;
    background: var(--landing-accent-bg);
    color: #fff !important;
    font-weight: 600;
    text-decoration: none;
  }
  .btn-quiet {
    display: inline-block;
    padding: 0.65rem 0.5rem;
    font-weight: 600;
    text-decoration: none;
  }
  .btn-quiet:hover,
  .more:hover,
  .byline a:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .cover-grid {
    display: grid;
    gap: 2rem;
  }
  @media (min-width: 1024px) {
    .cover-grid {
      grid-template-columns: 2fr 1fr;
    }
  }
  .cover-link {
    display: block;
    text-decoration: none;
  }
  .cover-title {
    font-size: clamp(1.6rem, 3.5vw, 2.5rem);
    line-height: 1.15;
    margin: 0.35rem 0 0.25rem;
  }
  .cover-link:hover .cover-title {
    text-decoration: underline;
    text-underline-offset: 4px;
  }
  .cover-static {
    padding: 3rem 2rem;
    border-radius: 1rem;
    background: var(--color-bg-secondary);
  }
  .byline {
    font-size: 0.875rem;
    color: var(--color-caption);
    margin-top: 0.35rem;
  }
  .picks {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  @media (min-width: 1024px) {
    .picks {
      border-left: 1px solid var(--color-input-border);
      padding-left: 2rem;
    }
  }

  .band {
    margin-top: 3.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--color-input-border);
  }
  .band-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1.25rem;
  }
  .band-head h2,
  .membership h2 {
    font-size: clamp(1.4rem, 2.6vw, 1.9rem);
    line-height: 1.2;
  }
  .more {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--landing-accent-text);
    text-decoration: none;
    white-space: nowrap;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .grid-4 {
    display: grid;
    gap: 1.5rem 1rem;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  @media (min-width: 1024px) {
    .grid-4 {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
  .grid-2 {
    display: grid;
    gap: 2rem;
  }
  @media (min-width: 768px) {
    .grid-2 {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  .row {
    display: flex;
    gap: 1rem;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    padding-bottom: 0.5rem;
  }
  .row-item {
    flex: 0 0 min(45%, 12rem);
    scroll-snap-align: start;
  }
  @media (min-width: 1024px) {
    .row-item {
      flex: 1 1 0;
    }
  }
  .tile-plain {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    text-decoration: none;
  }
  .note-text {
    font-size: 0.9rem;
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .topic {
    position: relative;
    display: block;
    border-radius: 0.75rem;
    overflow: hidden;
    text-decoration: none;
  }
  .topic-text {
    position: absolute;
    inset: auto 0 0 0;
    padding: 2.5rem 0.9rem 0.8rem;
    display: flex;
    flex-direction: column;
    background: linear-gradient(to top, rgb(0 0 0 / 0.78), rgb(0 0 0 / 0));
    color: #fff;
  }
  .topic-name {
    font-size: 1.2rem;
  }
  .topic-count {
    font-size: 0.8rem;
    opacity: 0.95;
  }
  .topic:hover .topic-name {
    text-decoration: underline;
  }

  .cook {
    flex: 0 0 6.5rem;
    scroll-snap-align: start;
  }
  .cook-link {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    text-decoration: none;
    text-align: center;
  }
  .cook-avatar {
    width: 5rem;
    height: 5rem;
    border-radius: 999px;
    object-fit: cover;
    background: var(--color-card-sunken);
  }
  .cook-initial {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.75rem;
    font-weight: 700;
  }
  .cook-name {
    font-size: 0.85rem;
    font-weight: 600;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  .tag-group {
    font-size: 0.95rem;
    font-weight: 600;
    margin: 1rem 0 0.6rem;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .chip {
    display: inline-block;
    padding: 0.35rem 0.8rem;
    border-radius: 999px;
    border: 1px solid var(--color-input-border);
    font-size: 0.875rem;
    text-decoration: none;
  }
  .chip:hover {
    border-color: var(--landing-accent-text);
  }

  .grid-tools {
    display: grid;
    gap: 1rem;
  }
  @media (min-width: 768px) {
    .grid-tools {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  .tool {
    display: block;
    height: 100%;
    padding: 1.1rem 1.2rem;
    border-radius: 0.9rem;
    background: var(--color-bg-secondary);
    text-decoration: none;
  }
  .tool p {
    margin-top: 0.35rem;
    font-size: 0.9rem;
    line-height: 1.5;
    color: var(--landing-muted);
  }
  .tool:hover h3 {
    text-decoration: underline;
  }

  .membership {
    padding: 1.75rem 1.5rem;
    border-radius: 1rem;
    border-top: none;
    background: var(--color-bg-secondary);
  }
  .member-tools {
    margin: 1rem 0 1.25rem;
    display: grid;
    gap: 0.5rem;
    line-height: 1.5;
  }

  .paid-label {
    font-size: 0.8rem;
    color: var(--color-caption);
  }
  .badge-paid {
    align-self: flex-start;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    border: 1px solid var(--color-caption);
    color: var(--color-text-primary);
  }
  .sponsor {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 1rem;
    border-radius: 0.9rem;
    border: 1px solid var(--color-input-border);
    text-decoration: none;
  }
  .sponsor-img {
    width: 100%;
    aspect-ratio: 3 / 1;
    object-fit: cover;
    border-radius: 0.5rem;
  }
  .sponsor-title {
    font-size: 1.1rem;
  }
  .sponsor-desc {
    font-size: 0.9rem;
    color: var(--landing-muted);
  }
</style>
