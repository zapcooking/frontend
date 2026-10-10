<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import Modal from './Modal.svelte';
  import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlass';
  import SpinnerIcon from 'phosphor-svelte/lib/SpinnerGap';
  import {
    GIF_COL_WIDTH,
    GIF_QUERY_MAX,
    gifErrorMessage,
    gifRequest,
    gifSearchUrl,
    gifSuggestUrl,
    gifTopicsFor,
    parseGifPage,
    parseGifSuggestions,
    type Gif
  } from '$lib/gifSearch';

  export let open = false;

  const dispatch = createEventDispatcher<{ select: { url: string; title: string } }>();

  let query = '';
  let searchInputEl: HTMLInputElement;
  let gridEl: HTMLDivElement;
  let statusText = '';
  let statusIsError = false;
  let chips: string[] = [];

  // Columns packed shortest-first, so GIFs of every shape fit without
  // cropping. CSS columns would do the packing, but reflow every earlier GIF
  // on each new page.
  let columns: Gif[][] = [];
  let colHeights: number[] = [];
  let placed: Gif[] = [];
  const seen = new Set<string>();

  let nextOffset: number | null = null;
  let loading = false;
  let pageCtrl: AbortController | null = null;
  let suggestCtrl: AbortController | null = null;
  let typingTimer: ReturnType<typeof setTimeout>;
  let resizeObserver: ResizeObserver | null = null;

  $: if (open && gridEl) {
    openPicker();
  }

  // Re-measure the column count if the picker's width changes while open.
  $: watchGridSize(gridEl, open);

  function watchGridSize(el: HTMLDivElement | null, isOpen: boolean) {
    if (!isOpen || !el || typeof ResizeObserver !== 'function') return;
    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver(() => {
      if (open && columns.length !== columnsFor()) layout(columnsFor());
    });
    resizeObserver.observe(el);
  }

  onDestroy(() => resizeObserver?.disconnect());

  function columnsFor(): number {
    // As many columns as the width takes, about GIF_COL_WIDTH each, two to
    // five. Two in the narrowest case; more where two would stretch every
    // GIF awkwardly wide.
    const width = gridEl?.clientWidth || 0;
    return Math.max(2, Math.min(5, Math.round(width / GIF_COL_WIDTH) || 2));
  }

  // Rebuild the columns and lay out what is already showing again, in order.
  function layout(n: number) {
    const items = placed;
    columns = Array.from({ length: n }, () => [] as Gif[]);
    colHeights = columns.map(() => 0);
    placed = [];
    seen.clear();
    place(items);
  }

  function place(gifs: Gif[]) {
    const nextColumns = columns.map((c) => [...c]);
    const nextHeights = [...colHeights];
    for (const gif of gifs) {
      if (seen.has(gif.url)) continue;
      seen.add(gif.url);
      placed.push(gif);
      const col = nextHeights.indexOf(Math.min(...nextHeights));
      nextHeights[col] += gif.height / gif.width;
      nextColumns[col] = [...nextColumns[col], gif];
    }
    columns = nextColumns;
    colHeights = nextHeights;
  }

  function setStatus(text: string, isError = false) {
    statusText = text;
    statusIsError = isError;
  }

  async function load(offset: number) {
    if (pageCtrl) pageCtrl.abort();
    const mine = new AbortController();
    pageCtrl = mine;
    loading = true;
    try {
      const page = parseGifPage(await gifRequest(gifSearchUrl(query, offset), mine.signal));
      if (pageCtrl !== mine) return;
      place(page.gifs);
      nextOffset = page.next;
      if (!offset && !page.gifs.length) setStatus(`No GIFs found for “${query}”.`);
      else setStatus('');
    } catch (e) {
      if (pageCtrl !== mine || (e instanceof Error && e.name === 'AbortError')) return;
      setStatus(e instanceof Error ? e.message : gifErrorMessage(0), true);
    } finally {
      if (pageCtrl === mine) {
        pageCtrl = null;
        loading = false;
      }
    }
  }

  // NOTHING LOADS UNTIL SOMETHING IS ASKED FOR. An empty query clears the
  // grid and says what to do, rather than searching for a default nobody
  // chose.
  function search(q: string) {
    clearTimeout(typingTimer);
    query = String(q || '').trim();
    if (pageCtrl) {
      pageCtrl.abort();
      pageCtrl = null;
      loading = false;
    }
    placed = [];
    layout(columnsFor());
    nextOffset = null;
    if (gridEl) gridEl.scrollTop = 0;
    if (!query) {
      setStatus('Search or pick a topic.');
      return;
    }
    load(0);
  }

  async function suggest(q: string) {
    if (suggestCtrl) suggestCtrl.abort();
    const mine = new AbortController();
    suggestCtrl = mine;
    try {
      const terms = parseGifSuggestions(await gifRequest(gifSuggestUrl(q), mine.signal));
      if (suggestCtrl === mine && query.trim() === q) chips = terms;
    } catch {
      // Suggestions are a nicety: a failure leaves the chips as they were.
    } finally {
      if (suggestCtrl === mine) suggestCtrl = null;
    }
  }

  // Searched once typing pauses, not per keystroke: each search is a request
  // through the proxy and each one replaces the grid.
  function handleInput() {
    clearTimeout(typingTimer);
    const q = query.trim();
    if (!q) chips = gifTopicsFor();
    typingTimer = setTimeout(() => {
      search(q);
      if (q) suggest(q);
    }, 350);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      search(query);
    }
    // Escape: the Modal around the picker closes it.
  }

  function handleChip(term: string) {
    query = term;
    chips = gifTopicsFor();
    search(term);
  }

  function handleScroll() {
    if (loading || nextOffset === null || !gridEl) return;
    if (gridEl.scrollTop + gridEl.clientHeight >= gridEl.scrollHeight - 160) load(nextOffset);
  }

  function pick(gif: Gif) {
    // Every result is already hosted on a Nostr media host: its URL is
    // attached the way a pasted image URL is, and nothing is uploaded.
    dispatch('select', { url: gif.url, title: gif.title });
    close();
  }

  function openPicker() {
    // Measured once it is showing: a hidden picker has no width to divide.
    if (columns.length !== columnsFor()) layout(columnsFor());
    // A search cut off by closing is run again on the next open.
    if (!seen.size && !pageCtrl) {
      chips = gifTopicsFor();
      search(query);
    }
    setTimeout(() => searchInputEl?.focus(), 100);
  }

  function close() {
    open = false;
    clearTimeout(typingTimer);
    if (pageCtrl) {
      pageCtrl.abort();
      pageCtrl = null;
      loading = false;
    }
    if (suggestCtrl) {
      suggestCtrl.abort();
      suggestCtrl = null;
    }
    if (!seen.size) setStatus('');
    resizeObserver?.disconnect();
    resizeObserver = null;
  }
</script>

<Modal {open} cleanup={close}>
  <h1 slot="title">GIFs</h1>

  <div class="gif-picker">
    <!-- Attribution the gifs.nostr.build registration asks for -->
    <p class="gif-credit">
      GIFs from
      <a href="https://nostr.build" target="_blank" rel="noopener noreferrer">nostr.build</a>
    </p>

    <!-- Search -->
    <div class="gif-search">
      <div class="gif-search-icon">
        <MagnifyingGlassIcon size={16} />
      </div>
      <input
        bind:this={searchInputEl}
        bind:value={query}
        on:input={handleInput}
        on:keydown={handleKeydown}
        type="text"
        maxlength={GIF_QUERY_MAX}
        autocomplete="off"
        spellcheck="false"
        placeholder="Search GIFs..."
        class="gif-search-input"
        aria-label="Search GIFs"
      />
    </div>

    <!-- Topic chips while the field is empty, suggestions while typing -->
    {#if chips.length}
      <div class="gif-chips">
        {#each chips as term (term)}
          <button class="gif-chip" type="button" on:click={() => handleChip(term)}>{term}</button>
        {/each}
      </div>
    {/if}

    <!-- Grid: columns packed shortest-first, load more on scroll -->
    <div class="gif-grid" bind:this={gridEl} on:scroll={handleScroll}>
      {#if loading && columns.every((c) => c.length === 0)}
        <div class="gif-loading">
          <SpinnerIcon size={24} class="animate-spin" />
        </div>
      {:else}
        {#each columns as col, i (i)}
          <div class="gif-col">
            {#each col as gif (gif.url)}
              <button
                class="gif-cell"
                type="button"
                title={gif.title || 'GIF'}
                aria-label={gif.title || 'GIF'}
                on:click={() => pick(gif)}
              >
                <img
                  src={gif.preview}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  referrerpolicy="no-referrer"
                  style:aspect-ratio={`${gif.width} / ${gif.height}`}
                />
              </button>
            {/each}
          </div>
        {/each}
      {/if}
    </div>

    {#if statusText}
      <p class="gif-status" class:error={statusIsError}>{statusText}</p>
    {/if}
  </div>
</Modal>

<style>
  .gif-picker {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
  }

  .gif-credit {
    margin: 0;
    font-size: 12px;
    color: var(--color-caption);
  }

  .gif-credit a {
    color: inherit;
    text-decoration: underline;
  }

  .gif-credit a:hover {
    color: var(--color-primary);
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

  .gif-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .gif-chip {
    padding: 4px 12px;
    border-radius: 999px;
    border: 1px solid var(--color-input-border);
    background: var(--color-bg-primary);
    color: var(--color-text-primary);
    font-size: 12px;
    cursor: pointer;
    transition: border-color 0.15s;
  }

  .gif-chip:hover {
    border-color: var(--color-primary);
  }

  .gif-grid {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    min-height: 96px;
    max-height: 50vh;
    overflow-y: auto;
    border-radius: 8px;
  }

  .gif-col {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .gif-cell {
    display: block;
    padding: 0;
    border: none;
    background: var(--color-accent-gray, #e5e7eb);
    border-radius: 8px;
    overflow: hidden;
    cursor: pointer;
  }

  .gif-cell img {
    display: block;
    width: 100%;
    height: auto;
  }

  .gif-cell:hover img {
    opacity: 0.85;
  }

  .gif-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    padding: 48px 0;
    color: var(--color-caption);
  }

  .gif-status {
    margin: 0;
    font-size: 13px;
    color: var(--color-caption);
    text-align: center;
  }

  .gif-status.error {
    color: var(--color-danger);
  }
</style>
