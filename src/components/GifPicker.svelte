<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import Modal from './Modal.svelte';
  import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlass';
  import SpinnerIcon from 'phosphor-svelte/lib/SpinnerGap';

  export let open = false;

  const dispatch = createEventDispatcher<{ select: { url: string; title: string } }>();
  const API_KEY = import.meta.env.VITE_GIPHY_API_KEY || '';
  const API_BASE = 'https://api.giphy.com/v1/gifs';

  interface GiphyGif {
    id: string;
    title: string;
    images: {
      fixed_width_small: { url: string; width: string; height: string };
      downsized: { url: string };
      original: { url: string };
    };
  }

  let query = '';
  let gifs: GiphyGif[] = [];
  let loading = false;
  let debounceTimer: ReturnType<typeof setTimeout>;
  let searchInputEl: HTMLInputElement;

  $: if (open && API_KEY) {
    loadTrending();
  }

  $: if (open && searchInputEl) {
    setTimeout(() => searchInputEl?.focus(), 100);
  }

  async function loadTrending() {
    if (loading) return;
    loading = true;
    try {
      const res = await fetch(`${API_BASE}/trending?api_key=${API_KEY}&limit=24&rating=g`);
      const data = await res.json();
      gifs = data.data || [];
    } catch (e) {
      console.error('[GifPicker] Failed to load trending:', e);
      gifs = [];
    } finally {
      loading = false;
    }
  }

  async function searchGifs(q: string) {
    if (!q.trim()) {
      loadTrending();
      return;
    }
    loading = true;
    try {
      const res = await fetch(
        `${API_BASE}/search?api_key=${API_KEY}&q=${encodeURIComponent(q)}&limit=24&rating=g`
      );
      const data = await res.json();
      gifs = data.data || [];
    } catch (e) {
      console.error('[GifPicker] Search failed:', e);
      gifs = [];
    } finally {
      loading = false;
    }
  }

  function handleInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      searchGifs(query);
    }, 300);
  }

  function selectGif(gif: GiphyGif) {
    const url = gif.images.downsized?.url || gif.images.original?.url;
    dispatch('select', { url, title: gif.title });
    close();
  }

  function close() {
    open = false;
    query = '';
    gifs = [];
  }
</script>

<Modal {open} cleanup={close}>
  <h1 slot="title">GIFs</h1>

  <div class="gif-picker">
    <!-- Search -->
    <div class="gif-search">
      <div class="gif-search-icon">
        <MagnifyingGlassIcon size={16} />
      </div>
      <input
        bind:this={searchInputEl}
        bind:value={query}
        on:input={handleInput}
        type="text"
        placeholder="Search GIFs..."
        class="gif-search-input"
      />
    </div>

    <!-- Grid -->
    <div class="gif-grid-container">
      {#if loading && gifs.length === 0}
        <div class="gif-loading">
          <SpinnerIcon size={24} class="animate-spin" />
        </div>
      {:else if !API_KEY}
        <div class="gif-empty">
          <p>GIPHY API key not configured</p>
        </div>
      {:else if gifs.length === 0 && query}
        <div class="gif-empty">
          <p>No GIFs found for "{query}"</p>
        </div>
      {:else}
        <div class="gif-grid">
          {#each gifs as gif (gif.id)}
            <button
              class="gif-tile"
              on:click={() => selectGif(gif)}
              title={gif.title}
            >
              <img
                src={gif.images.fixed_width_small.url}
                alt={gif.title}
                loading="lazy"
                class="gif-thumb"
              />
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <!-- GIPHY Attribution (required by API terms) -->
    <div class="gif-attribution">
      <img
        src="https://giphy.com/static/img/powered-by-giphy.png"
        alt="Powered by GIPHY"
        class="gif-attribution-img"
      />
    </div>
  </div>
</Modal>

<style>
  .gif-picker {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
  }

  .gif-search {
    position: relative;
    display: flex;
    align-items: center;
  }

  .gif-search-icon {
    position: absolute;
    left: 12px;
    color: var(--color-caption);
    pointer-events: none;
    display: flex;
    align-items: center;
  }

  .gif-search-input {
    width: 100%;
    padding: 10px 12px 10px 36px;
    border-radius: 12px;
    border: 1px solid var(--color-input-border);
    background: var(--color-bg-primary);
    color: var(--color-text-primary);
    font-size: 14px;
    outline: none;
    transition: border-color 0.15s;
  }

  .gif-search-input:focus {
    border-color: var(--color-primary);
  }

  .gif-search-input::placeholder {
    color: var(--color-caption);
  }

  .gif-grid-container {
    max-height: 50vh;
    overflow-y: auto;
    border-radius: 8px;
  }

  .gif-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 6px;
  }

  .gif-tile {
    aspect-ratio: 1;
    overflow: hidden;
    border-radius: 8px;
    cursor: pointer;
    background: var(--color-accent-gray, #e5e7eb);
    border: none;
    padding: 0;
    transition: opacity 0.15s, transform 0.15s;
  }

  .gif-tile:hover {
    opacity: 0.85;
    transform: scale(1.03);
  }

  .gif-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .gif-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 48px 0;
    color: var(--color-caption);
  }

  .gif-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 48px 0;
    color: var(--color-caption);
    font-size: 14px;
  }

  .gif-attribution {
    display: flex;
    justify-content: center;
    padding-top: 4px;
  }

  .gif-attribution-img {
    height: 16px;
    opacity: 0.6;
  }

  @media (min-width: 768px) {
    .gif-grid {
      grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
      gap: 8px;
    }
  }
</style>
