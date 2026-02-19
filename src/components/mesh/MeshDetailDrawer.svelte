<script lang="ts">
  import { fly } from 'svelte/transition';
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import type { MeshNode, RecipeNode, TagNode, ChefNode } from '$lib/mesh/meshTypes';
  import Avatar from '../Avatar.svelte';

  export let node: MeshNode;

  const dispatch = createEventDispatcher<{ close: void }>();

  // Touch handling for swipe-to-close
  let touchStartX = 0;
  let isSwiping = false;

  function close() {
    dispatch('close');
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      close();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      close();
    }
  }

  function handleTouchStart(e: TouchEvent) {
    touchStartX = e.touches[0].clientX;
    isSwiping = true;
  }

  function handleTouchEnd(e: TouchEvent) {
    if (!isSwiping) return;
    const touchEndX = e.changedTouches[0].clientX;
    if (touchEndX - touchStartX > 100) {
      close();
    }
    isSwiping = false;
  }

  // Prevent body scroll when drawer is open
  $: if (browser) {
    document.body.style.overflow = 'hidden';
  }

  onDestroy(() => {
    if (browser) {
      document.body.style.overflow = '';
    }
  });
</script>

<svelte:window on:keydown={handleKeydown} />

<!-- Backdrop -->
<div
  class="drawer-backdrop"
  on:click={handleBackdropClick}
  role="presentation"
  transition:fly={{ duration: 200, opacity: 0 }}
/>

<!-- Drawer -->
<aside
  class="drawer-panel"
  transition:fly={{ x: 400, duration: 300, easing: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2) }}
  on:touchstart={handleTouchStart}
  on:touchend={handleTouchEnd}
  role="dialog"
  aria-modal="true"
  aria-label="Node details"
>
  <!-- Close button -->
  <div class="drawer-header">
    <button
      class="close-btn"
      on:click={close}
      aria-label="Close details"
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
        <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"/>
      </svg>
    </button>
  </div>

  <div class="drawer-content">
    {#if node.type === 'recipe'}
      {@const recipe = node}
      <div class="recipe-detail">
        <img
          src={recipe.image}
          alt={recipe.title}
          class="recipe-image"
          loading="lazy"
        />
        <h2 class="text-lg font-bold mt-3" style="color: var(--color-text-primary);">
          {recipe.title}
        </h2>
        <div class="flex items-center gap-2 mt-2">
          <Avatar pubkey={recipe.pubkey} size={28} showRing={true} />
          <span class="text-sm" style="color: var(--color-caption);">Author</span>
        </div>
        <div class="flex gap-3 mt-3 text-sm" style="color: var(--color-caption);">
          {#if recipe.zaps > 0}
            <span>&#9889; {recipe.zaps} zaps</span>
          {/if}
          {#if recipe.likes > 0}
            <span>&#10084; {recipe.likes} likes</span>
          {/if}
        </div>
        {#if recipe.tags.length > 0}
          <div class="flex flex-wrap gap-1.5 mt-3">
            {#each recipe.tags as tag}
              <a href="/tag/{tag}" class="tag-chip">{tag}</a>
            {/each}
          </div>
        {/if}
        <a
          href={recipe.link}
          class="view-btn mt-4"
        >
          View Recipe
        </a>
      </div>
    {:else if node.type === 'tag'}
      {@const tag = node}
      <div class="tag-detail">
        <div class="text-4xl text-center">{tag.emoji}</div>
        <h2 class="text-lg font-bold mt-2 text-center" style="color: var(--color-text-primary);">
          {tag.name}
        </h2>
        <p class="text-sm text-center mt-1" style="color: var(--color-caption);">
          {tag.count} recipe{tag.count !== 1 ? 's' : ''} &middot; {tag.sectionTitle}
        </p>
        <a
          href="/tag/{tag.name}"
          class="view-btn mt-4"
        >
          View All Recipes
        </a>
      </div>
    {:else if node.type === 'chef'}
      {@const chef = node}
      <div class="chef-detail">
        <div class="flex justify-center">
          <Avatar pubkey={chef.pubkey} size={64} showRing={true} />
        </div>
        <h2 class="text-lg font-bold mt-3 text-center" style="color: var(--color-text-primary);">
          {chef.displayName || 'Chef'}
        </h2>
        <p class="text-sm text-center mt-1" style="color: var(--color-caption);">
          {chef.recipeCount} recipe{chef.recipeCount !== 1 ? 's' : ''} in the mesh
        </p>
      </div>
    {/if}
  </div>
</aside>

<style>
  .drawer-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    background-color: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(2px);
  }

  .drawer-panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 51;
    width: 100%;
    max-width: 360px;
    background-color: var(--color-bg-secondary);
    box-shadow: -4px 0 20px rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }

  .drawer-header {
    display: flex;
    justify-content: flex-end;
    padding: 12px;
    flex-shrink: 0;
  }

  .close-btn {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    cursor: pointer;
    color: var(--color-text-primary);
    transition: background-color 0.15s;
  }

  .close-btn:hover {
    background-color: var(--color-input-bg);
  }

  .drawer-content {
    padding: 0 1.25rem 1.5rem;
    flex: 1;
  }

  .recipe-image {
    width: 100%;
    aspect-ratio: 4 / 3;
    object-fit: cover;
    border-radius: 12px;
  }

  .tag-chip {
    padding: 2px 10px;
    border-radius: 999px;
    border: 1px solid var(--color-input-border);
    font-size: 12px;
    color: var(--color-text-primary);
    text-decoration: none;
    transition: background-color 0.15s;
  }

  .tag-chip:hover {
    background-color: var(--color-input-bg);
  }

  .view-btn {
    display: block;
    text-align: center;
    padding: 10px 20px;
    border-radius: 10px;
    background-color: var(--color-primary);
    color: white;
    font-weight: 600;
    font-size: 14px;
    text-decoration: none;
    transition: opacity 0.15s;
  }

  .view-btn:hover {
    opacity: 0.9;
  }

  @media (max-width: 400px) {
    .drawer-panel {
      max-width: 100%;
    }
  }
</style>
