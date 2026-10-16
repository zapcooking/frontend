<script lang="ts">
  import { onMount } from 'svelte';

  export let url: string;

  interface LinkMeta {
    title?: string;
    description?: string;
    image?: string;
    siteName?: string;
    favicon?: string;
  }

  let meta: LinkMeta | null = null;
  let loading = true;
  let error = false;

  // Simple cache to avoid re-fetching
  const metaCache = new Map<string, LinkMeta>();

  async function fetchMetadata() {
    if (!url) return;

    // Check cache first
    const cached = metaCache.get(url);
    if (cached) {
      meta = cached;
      loading = false;
      return;
    }

    loading = true;
    error = false;

    try {
      let data: any = null;

      // Prefer our own server-side unfurler — no CORS, no third-party quota.
      try {
        const response = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
        if (response.ok) {
          const result = await response.json();
          if (result && !result.error && (result.title || result.description || result.image)) {
            data = {
              title: result.title || '',
              description: result.description || '',
              image: result.image || '',
              favicon:
                result.favicon ||
                `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`
            };
          }
        }
      } catch (e) {
        // Internal endpoint failed — fall back to microlink below.
      }

      // Fallback: microlink.io (free tier, rate-limited) if ours came up empty.
      if (!data) {
        try {
          const response = await fetch(`https://api.microlink.io?url=${encodeURIComponent(url)}`);
          if (response.ok) {
            const result = await response.json();
            if (result.status === 'success' && result.data) {
              data = {
                title: result.data.title || '',
                description: result.data.description || '',
                image: result.data.image?.url || result.data.logo?.url || '',
                favicon: result.data.logo?.url || `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`
              };
            }
          }
        } catch (e) {
          // Microlink failed - will fall back to showing plain URL
        }
      }

      if (data) {
        meta = {
          title: data.title || '',
          description: data.description || '',
          image: data.image || '',
          siteName: new URL(url).hostname.replace('www.', ''),
          favicon: data.favicon || `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`
        };

        // Cache the result
        if (meta.title || meta.description || meta.image) {
          metaCache.set(url, meta);
        } else {
          error = true;
        }
      } else {
        error = true;
      }
    } catch (e) {
      // Silently handle errors - CORS failures are expected for some link preview services
      error = true;
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    fetchMetadata();
  });

  function handleImageError() {
    if (meta) {
      meta = { ...meta, image: '' };
    }
  }

  // Extract domain for display
  $: displayDomain = (() => {
    try {
      return new URL(url).hostname.replace('www.', '');
    } catch {
      return url;
    }
  })();
</script>

{#if loading}
  <!-- Loading skeleton -->
  <div class="my-1 border rounded-lg overflow-hidden animate-pulse" style="border-color: var(--color-input-border)">
    <div class="flex flex-col sm:flex-row sm:h-28 md:h-32">
      <div class="h-52 bg-accent-gray shrink-0 sm:aspect-square sm:h-full md:aspect-[1.91/1]"></div>
      <div class="flex-1 p-3 space-y-2">
        <div class="h-3 bg-accent-gray rounded w-3/4"></div>
        <div class="h-2 bg-accent-gray rounded w-full"></div>
        <div class="h-2 bg-accent-gray rounded w-1/2"></div>
      </div>
    </div>
  </div>
{:else if error || !meta || (!meta.title && !meta.description && !meta.image)}
  <!-- Fallback: just show the URL as a link -->
  <a
    href={url}
    target="_blank"
    rel="noopener noreferrer"
    class="text-orange-500 hover:text-orange-600 hover:underline break-all"
  >
    {url}
  </a>
{:else}
  <!-- Link preview card -->
  <a
    href={url}
    target="_blank"
    rel="noopener noreferrer"
    class="my-1 block border rounded-lg overflow-hidden hover:bg-accent-gray/50 transition-colors"
    style="border-color: var(--color-input-border)"
  >
    <!-- Jumble-style proportions, image still beside the text: a wider
         image column (160–176px vs the old 96–128) at a square crop with
         object-cover, so wide images fill edge-to-edge instead of
         letterboxing inside a short object-contain box. -->
    <!-- Jumble WebPreview proportions on sm and up: card height steps
         96 -> 112 -> 128px with the viewport, the image fills the left
         column (square at sm, 1.91:1 at md) with object-cover — wide
         social images crop minimally instead of letterboxing — and the
         text column centers vertically with the domain on top. On phones
         the card stacks: the image spans the full width on top at its
         NATURAL aspect — wide banners (GitHub 2:1, og 1.91:1) show their
         full horizontal area, nothing sliced off the sides — with a
         max-height cap so tall images crop instead of towering. -->
    <div class="flex flex-col sm:flex-row sm:h-28 md:h-32">
      {#if meta.image}
        <div class="bg-accent-gray shrink-0 sm:h-full sm:aspect-square md:aspect-[1.91/1]">
          <img
            src={meta.image}
            alt=""
            class="w-full max-h-56 object-cover sm:max-h-none sm:h-full"
            loading="lazy"
            on:error={handleImageError}
          />
        </div>
      {/if}
      <div class="flex min-w-0 flex-1 flex-col justify-center gap-1.5 p-3 sm:p-4">
        <div class="flex min-w-0 items-center gap-1.5 text-xs" style="color: var(--color-caption)">
          {#if meta.favicon}
            <img src={meta.favicon} alt="" class="w-3.5 h-3.5" on:error={() => meta && (meta.favicon = '')} />
          {/if}
          <span class="truncate">{displayDomain}</span>
        </div>
        {#if meta.title}
          <h4 class="text-sm font-medium line-clamp-2 leading-tight" style="color: var(--color-text-primary)">
            {meta.title}
          </h4>
        {/if}
        {#if meta.description}
          <p class="text-xs text-caption line-clamp-2 leading-snug mt-0.5">
            {meta.description}
          </p>
        {/if}
      </div>
    </div>
  </a>
{/if}

<style>
  .line-clamp-2 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
