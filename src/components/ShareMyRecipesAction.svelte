<script lang="ts">
  /**
   * "Share My Recipes as Pack" — one-click action that turns every
   * recipe a user has authored on Nostr into a single replaceable
   * Recipe Pack at d-tag `zapcooking-my-recipes`.
   *
   * Self-contained: owns its own button + loading + empty-state +
   * SharePackModal wiring, so any page that wants the action just
   * mounts <ShareMyRecipesAction pubkey={…} displayName={…} /> with
   * minimal page-side state.
   *
   * Flow on click:
   *   1. Fetch all kind:30023 recipes authored by `pubkey` via
   *      fetchMyAuthoredRecipes.
   *   2. If zero recipes → show empty-state inline (with /recipe/create CTA).
   *   3. Otherwise → open SharePackModal pre-populated with sensible
   *      defaults (title from displayName, description, cover image)
   *      and pass the rich recipe list so the user can deselect any
   *      they don't want in the pack.
   *
   * The modal handles publish, signing, and the optional kind:1 feed
   * announcement — same path as cookbook/collection shares. Re-publishing
   * replaces the existing "My Recipes" pack at the same d-tag.
   */
  import ShareNetworkIcon from 'phosphor-svelte/lib/ShareNetwork';
  import SharePackModal from './SharePackModal.svelte';
  import Button from './Button.svelte';
  import { ndk } from '$lib/nostr';
  import { showToast } from '$lib/toast';
  import { fetchMyAuthoredRecipes, type MyRecipeForPack } from '$lib/myRecipesPack';

  /** Pubkey of the author whose recipes we're packaging. Always the
   *  signed-in user's pubkey in practice — the parent page is
   *  responsible for only mounting this on the own-profile path. */
  export let pubkey: string;
  /** Display name used to pre-fill default title + description. */
  export let displayName: string = '';
  /**
   * Optional class hook for the trigger button so the parent page can
   * make it match local nav/sort/share controls without us baking in
   * a specific style.
   */
  export let buttonClass: string = '';

  let modalOpen = false;
  let recipes: MyRecipeForPack[] = [];
  let isLoading = false;
  let lastError = '';
  /**
   * The fetch can resolve to "no recipes published yet". We surface
   * that inline rather than opening an empty modal, since the modal
   * is review-and-publish UX and there's nothing to publish.
   */
  let showEmptyState = false;

  function defaultTitle(): string {
    const name = displayName.trim();
    return name ? `${name}'s Recipes` : 'My Recipes';
  }

  function defaultDescription(): string {
    const name = displayName.trim();
    return name
      ? `A collection of recipes shared by ${name} on Zap Cooking.`
      : 'A collection of recipes shared on Zap Cooking.';
  }

  async function handleClick() {
    if (isLoading || modalOpen) return;
    if (!pubkey) {
      showToast('error', 'Sign in to share your recipes.');
      return;
    }
    if (!$ndk) {
      showToast('error', 'Not connected — try again in a moment.');
      return;
    }
    isLoading = true;
    lastError = '';
    showEmptyState = false;
    try {
      recipes = await fetchMyAuthoredRecipes($ndk, pubkey);
      if (recipes.length === 0) {
        showEmptyState = true;
        return;
      }
      modalOpen = true;
    } catch (e: any) {
      console.error('[ShareMyRecipesAction] fetch failed', e);
      lastError = e?.message || 'Could not load your recipes.';
      showToast('error', lastError);
    } finally {
      isLoading = false;
    }
  }
</script>

<button
  type="button"
  on:click={handleClick}
  disabled={isLoading || !pubkey}
  class={buttonClass ||
    'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed'}
  style={buttonClass
    ? ''
    : 'background-color: var(--color-input-bg); color: var(--color-text-primary); border: 1px solid var(--color-input-border);'}
  title="Share every recipe you've published as a single Recipe Pack"
  aria-label="Share my recipes as a Recipe Pack"
>
  <ShareNetworkIcon size={16} />
  {#if isLoading}
    <span>Loading…</span>
  {:else}
    <span>Share My Recipes</span>
  {/if}
</button>

{#if showEmptyState}
  <!-- Inline empty-state (vs. opening an empty modal). Anchored just
       below the button so it reads as a response to the click. -->
  <div
    class="mt-2 p-3 rounded-lg flex flex-col gap-2 text-sm"
    style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border); color: var(--color-text-primary);"
  >
    <p>You haven't published any recipes yet.</p>
    <div class="flex">
      <Button
        on:click={() => {
          showEmptyState = false;
          window.location.href = '/recipe/create';
        }}
      >
        Create a Recipe
      </Button>
    </div>
  </div>
{/if}

<SharePackModal
  bind:open={modalOpen}
  source={{ type: 'my-recipes' }}
  recipes={recipes.map((r) => ({ aTag: r.aTag, title: r.title, image: r.image }))}
  recipeATags={recipes.map((r) => r.aTag)}
  initialTitle={defaultTitle()}
  initialDescription={defaultDescription()}
/>
