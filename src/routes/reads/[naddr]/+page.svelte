<script lang="ts">
  import { browser } from '$app/environment';
  import { page } from '$app/stores';
  import { ndk } from '$lib/nostr';
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import { onMount } from 'svelte';
  import Recipe from '../../../components/Recipe/Recipe.svelte';
  import PanLoader from '../../../components/PanLoader.svelte';
  import ShareModal from '../../../components/ShareModal.svelte';
  import RightRail from '../../../components/RightRail.svelte';
  import RailCard from '../../../components/RailCard.svelte';
  import ZapMarkMono from '../../../components/ZapMarkMono.svelte';
  import { RECIPE_TAGS, isHiddenRecipeEvent } from '$lib/consts';
  import { validateMarkdownTemplate } from '$lib/parser';
  import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeft';
  import ShareFatIcon from 'phosphor-svelte/lib/ShareFat';
  import { stripTrackingParams } from '$lib/utils/stripTrackingParams';
  import { fetchAuthorContent } from '$lib/authorContent';
  import { fetchEventWithRelayHints } from '$lib/eventFetch';

  let event: NDKEvent | null = null;
  let naddr: string = '';
  let loading = true;
  let error: string | null = null;
  let shareModalOpen = false;
  // Single-flight token for loadData (see guard inside).
  let lastRequestedSlug = '';

  // "More from this author / this chef" rails — one fetch, both types.
  let moreArticles: { naddr: string; title: string; image: string; href: string }[] = [];
  let moreRecipes: { naddr: string; title: string; image: string; href: string }[] = [];
  let moreFetchedFor = '';

  $: if (event && event.id !== moreFetchedFor) {
    moreFetchedFor = event.id;
    loadMoreFromAuthor(event);
  }

  async function loadMoreFromAuthor(current: NDKEvent) {
    moreArticles = [];
    moreRecipes = [];
    if (!$ndk || !current.pubkey) return;
    const split = await fetchAuthorContent($ndk, current.pubkey, current.id);
    moreArticles = split.articles;
    moreRecipes = split.recipes;
  }

  // Production origin (matching og:url): the shortener only accepts
  // zap.cooking URLs, and social platforms reject localhost anyway.
  $: articleShareUrl = `https://zap.cooking/reads/${$page.params.naddr}`;

  onMount(() => stripTrackingParams($page.url));

  $: {
    if (browser && $page.params.naddr) {
      loadData();
    }
  }

  async function loadData() {
    const slug = $page.params.naddr;
    if (!slug) return;

    // Single-flight: the reactive block re-runs on every `$page` store
    // emission (URL cleanups, layout state), and each run used to start
    // a fresh fetch whose null result could clobber an already-loaded
    // article with "Article not found".
    if (slug === lastRequestedSlug && (loading || event)) return;
    lastRequestedSlug = slug;

    loading = true;
    error = null;

    try {
      if (slug.startsWith('naddr1')) {
        const a = nip19.decode(slug);
        if (a.type !== 'naddr') {
          throw new Error('Invalid naddr format');
        }
        const b = a.data;

        // Articles are always kind 30023
        naddr = nip19.naddrEncode({
          identifier: b.identifier,
          pubkey: b.pubkey,
          kind: 30023
        });

        // Add timeout protection for article loading. The explicit relay
        // set (pool + the naddr's bech32 relay hints) routes around the
        // cold-start race where NDK's outbox tracker returns an empty
        // relay set for an unknown author and the REQ is never sent.
        const e = await fetchEventWithRelayHints(
          $ndk,
          {
            '#d': [b.identifier],
            authors: [b.pubkey],
            kinds: [30023]
          },
          { hintRelayUrls: b.relays, timeoutMs: 10_000 }
        );
        // The user may have navigated away while we fetched.
        if ($page.params.naddr !== slug) return;
        if (e) {
          // Reject recipe-shaped events; anything else is treated as an article
          const hasRecipeTag = e.tags.some(
            (t: string[]) => t[0] === 't' && RECIPE_TAGS.includes(t[1]?.toLowerCase() || '')
          );
          const isRecipeShaped = typeof validateMarkdownTemplate(e.content) !== 'string';
          if (hasRecipeTag || isRecipeShaped) {
            throw new Error('This is a recipe, not an article');
          }
          event = e;
          loading = false;
          // Premium share URL: zap.cooking/<handle>/<slug> when the author
          // has a handle that verifies back to their pubkey. Background —
          // the share modal falls back to a minted /s/ code until (or
          // unless) this resolves.
          void resolveVanityShareUrl(e);
        } else {
          loading = false;
          error = 'Article not found';
        }
      } else {
        throw new Error('Invalid article URL format');
      }
    } catch (err) {
      // Don't clobber a loaded article with a stale failure (e.g. the
      // fetch raced a navigation or a second loadData call).
      if ($page.params.naddr !== slug || event) {
        loading = false;
        return;
      }
      loading = false;
      error = err instanceof Error ? err.message : 'Failed to load article';
      event = null;
    }
  }

  /**
   * Resolve the author's @zap.cooking handle (premium NIP-05) from the
   * site's verified directory and, when the author is in it, expose
   * zap.cooking/<handle>/<d-tag> as the preferred share URL. The
   * directory is the source of truth — an author's own profile nip05 may
   * point elsewhere (e.g. a personal domain) while they still hold a
   * zap.cooking handle, so the profile is not consulted at all.
   */
  let vanityShareUrl = '';

  async function resolveVanityShareUrl(e: NDKEvent) {
    vanityShareUrl = '';
    if (!browser) return;
    const dTag = e.tags.find((t) => t[0] === 'd')?.[1];
    if (!dTag) return;

    try {
      const res = await fetch('/.well-known/nostr.json');
      if (!res.ok) return;
      const names = (await res.json())?.names;
      if (!names || typeof names !== 'object') return;
      for (const [handle, pubkey] of Object.entries(names)) {
        if (pubkey === e.pubkey && /^[a-z0-9-_.]{1,30}$/.test(handle)) {
          vanityShareUrl = `https://zap.cooking/${handle}/${dTag}`;
          return;
        }
      }
    } catch {
      // Keep the minted-short-link default.
    }
  }

  // OG/meta derived entirely from the client-fetched NDK event, with static
  // defaults until it loads. No server load — see <svelte:head>.
  $: pageHeading = event    ? event.tags.find((e) => e[0] == 'title')?.[1] || event.tags.find((e) => e[0] == 'd')?.[1] || '...'
    : 'Article';

  $: metaTitleBase = event
    ? event.tags.find((tag) => tag[0] === 'title')?.[1] || event.content.slice(0, 60) + '...'
    : 'Article';

  $: fullPageTitle = `${pageHeading} - zap.cooking`;
  $: fullMetaTitle = `${metaTitleBase} - zap.cooking`;

  $: og_title = event 
    ? fullMetaTitle 
    : 'Article - zap.cooking';
  
  // Better description extraction from event content
  $: og_description = event
    ? (() => {
        // Try summary tag first
        const summary = event.tags?.find((tag) => tag[0] === 'summary')?.[1];
        if (summary) return summary;
        
        // Clean and extract from content
        if (event.content) {
          let text = event.content
            .replace(/^#+\s+/gm, '') // Remove markdown headers
            .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // Convert links to text
            .replace(/!\[([^\]]*)\]\([^\)]+\)/g, '') // Remove images
            .replace(/\*\*([^\*]+)\*\*/g, '$1') // Remove bold
            .replace(/\*([^\*]+)\*/g, '$1') // Remove italic
            .replace(/`([^`]+)`/g, '$1') // Remove code
            .replace(/\n+/g, ' ') // Replace newlines with spaces
            .trim();
          
          if (text.length > 155) {
            const truncated = text.slice(0, 155);
            const lastSpace = truncated.lastIndexOf(' ');
            const lastSentence = Math.max(truncated.lastIndexOf('.'), truncated.lastIndexOf('!'), truncated.lastIndexOf('?'));
            if (lastSentence > 80) return text.slice(0, lastSentence + 1);
            return (lastSpace > 80 ? truncated.slice(0, lastSpace) : truncated) + '...';
          }
          return text || 'An article shared on zap.cooking';
        }
        return 'An article shared on zap.cooking';
      })()
    : 'An article shared on zap.cooking';
  
  $: og_image = event
    ? (event.tags?.find((tag) => tag[0] === 'image')?.[1] || 'https://zap.cooking/social-share.png')
    : 'https://zap.cooking/social-share.png';

  // Cap description at ~155 chars for Facebook/social preview
  $: og_desc = (() => {
    const d = og_description;
    if (!d || d.length <= 155) return d;
    const t = d.slice(0, 155);
    const ls = Math.max(t.lastIndexOf('.'), t.lastIndexOf('!'), t.lastIndexOf('?'));
    if (ls > 80) return d.slice(0, ls + 1);
    const sp = t.lastIndexOf(' ');
    return (sp > 80 ? t.slice(0, sp) : t) + '...';
  })();
</script>

<svelte:head>
  <title>{fullPageTitle || 'Article - zap.cooking'}</title>
  <meta name="description" content={og_desc} />

  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="article" />
  <meta property="og:url" content={`https://zap.cooking/reads/${$page.params.naddr}`} />
  <meta property="og:title" content={og_title} />
  <meta property="og:description" content={og_desc} />
  <meta property="og:image" content={og_image} />
  <meta property="og:image:secure_url" content={og_image} />
  <meta property="og:site_name" content="zap.cooking" />
  
  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content={`https://zap.cooking/reads/${$page.params.naddr}`} />
  <meta name="twitter:title" content={og_title} />
  <meta name="twitter:description" content={og_desc} />
  <meta name="twitter:image" content={og_image} />
</svelte:head>

<!-- Back to Reads / Share bar -->
<div class="mb-4 flex items-center justify-between gap-2">
  <a
    href="/reads"
    class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors hover:bg-accent-gray"
    style="color: var(--color-text-secondary);"
  >
    <ArrowLeftIcon size={16} weight="bold" />
    <span>Back to Reads</span>
  </a>
  <button
    type="button"
    aria-label="Share article"
    class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors hover:bg-accent-gray"
    style="color: var(--color-text-secondary);"
    on:click={() => (shareModalOpen = true)}
  >
    <ShareFatIcon size={16} weight="bold" />
    <span>Share</span>
  </button>
</div>

{#if loading}
  <div class="flex justify-center items-center page-loader">
    <PanLoader />
  </div>
{:else if error}
  <div class="flex flex-col justify-center items-center page-loader gap-4">
    <h1 class="text-2xl font-bold text-red-600">Article Loading Error</h1>
    <p class="text-caption">{error}</p>
    <button
      class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
      on:click={() => loadData()}
    >
      Try Again
    </button>
  </div>
{:else if event && (event.tags.some(t => t[0] === 'deleted') || !event.content || event.content.trim() === '')}
  <div class="flex flex-col justify-center items-center page-loader gap-4">
    <h1 class="text-2xl font-bold" style="color: var(--color-text-primary);">Article Deleted</h1>
    <p class="text-caption">This article has been deleted by its author.</p>
    <a href="/reads" class="px-4 py-2 bg-primary text-white rounded-full hover:opacity-80">
      Browse Articles
    </a>
  </div>
{:else if event}
  <div class="reads-page-layout">
    <div class="reads-main flex-1 min-w-0">
      <Recipe {event} />
    </div>
    {#if moreArticles.length > 0 || moreRecipes.length > 0}
      <RightRail>
        {#if moreArticles.length > 0}
          <RailCard title="More from this author">
            {#each moreArticles as a (a.naddr)}
              <a class="reads-rail-row" href={a.href}>
                <span
                  class="reads-rail-thumb"
                  style:background-image={a.image ? `url('${a.image}')` : 'none'}
                >
                  {#if !a.image}<span class="reads-rail-thumb-mark"><ZapMarkMono /></span>{/if}
                </span>
                <span class="reads-rail-title">{a.title}</span>
              </a>
            {/each}
          </RailCard>
        {/if}
        {#if moreRecipes.length > 0}
          <RailCard title="More from this chef">
            {#each moreRecipes as r (r.naddr)}
              <a class="reads-rail-row" href={r.href}>
                <span
                  class="reads-rail-thumb"
                  style:background-image={r.image ? `url('${r.image}')` : 'none'}
                >
                  {#if !r.image}<span class="reads-rail-thumb-mark"><ZapMarkMono /></span>{/if}
                </span>
                <span class="reads-rail-title">{r.title}</span>
              </a>
            {/each}
          </RailCard>
        {/if}
      </RightRail>
    {/if}
  </div>
{:else}
  <div class="flex justify-center items-center page-loader">
    <PanLoader />
  </div>
{/if}

<!-- ShareModal mints a zap.cooking/s/<code> short link for the article
     URL automatically when opened — unless the author's verified handle
     resolves, in which case the vanity URL (zap.cooking/<handle>/<slug>)
     is shared instead. -->
<ShareModal
  bind:open={shareModalOpen}
  url={articleShareUrl}
  vanityUrl={vanityShareUrl}
  title={fullPageTitle || og_title || 'Article'}
  imageUrl={og_image}
/>

<style>
  .reads-page-layout {
    display: flex;
    align-items: flex-start;
    gap: 3rem;
  }
  .reads-main {
    min-width: 0;
  }
  .reads-rail-row {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.375rem 0.25rem;
    border-radius: 0.5rem;
    text-decoration: none;
  }
  .reads-rail-row:hover {
    background-color: var(--color-input-bg);
  }
  .reads-rail-thumb {
    flex-shrink: 0;
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 0.5rem;
    background-color: var(--color-input-bg);
    background-size: cover;
    background-position: center;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  /* Monochrome zap mark shown when the article has no image, so the
     thumb reads as a deliberate placeholder instead of an empty box. */
  .reads-rail-thumb-mark {
    width: 1.375rem;
    height: 1.375rem;
    color: var(--color-caption);
    opacity: 0.55;
  }
  .reads-rail-title {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-text-primary);
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    transition: color 140ms ease;
  }
  .reads-rail-row:hover .reads-rail-title {
    color: var(--color-primary);
  }
</style>
