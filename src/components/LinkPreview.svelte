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
      // Try microlink.io first (more reliable, has free tier)
      let data: any = null;

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
    <div class="flex">
      <div class="w-24 h-20 bg-accent-gray flex-shrink-0"></div>
      <div class="p-3 flex-1 space-y-2">
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
    class="text-blue-500 hover:text-blue-700 hover:underline break-all"
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
    <div class="flex">
      {#if meta.image}
        <div class="w-24 sm:w-32 flex-shrink-0 bg-accent-gray flex items-center">
          <img
            src={meta.image}
            alt=""
            class="w-full h-auto object-contain max-h-24"
            loading="lazy"
            on:error={handleImageError}
          />
        </div>
      {/if}
      <div class="p-2 sm:p-3 flex-1 min-w-0 flex flex-col justify-center">
        {#if meta.title}
          <h4 class="text-sm font-medium line-clamp-2 leading-tight" style="color: var(--color-text-primary)">
            {meta.title}
          </h4>
        {/if}
        {#if meta.description}
          <p class="text-xs text-caption line-clamp-2 mt-0.5 leading-snug">
            {meta.description}
          </p>
        {/if}
        <div class="flex items-center gap-1.5 mt-1.5">
          {#if meta.favicon}
            <img src={meta.favicon} alt="" class="w-3.5 h-3.5" on:error={() => meta && (meta.favicon = '')} />
          {/if}
          <span class="text-xs text-caption truncate">{displayDomain}</span>
        </div>
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
