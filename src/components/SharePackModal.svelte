<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Modal from './Modal.svelte';
  import Button from './Button.svelte';
  import RecipePackCard from './RecipePackCard.svelte';
  import CopyIcon from 'phosphor-svelte/lib/Copy';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import { userPublickey } from '$lib/nostr';
  import { showToast } from '$lib/toast';
  import {
    publishRecipePack,
    publishPackAnnouncement,
    resolveFirstRecipeImage,
    type RecipePackSource
  } from '$lib/recipePack';
  import { copyToClipboard } from '$lib/utils/share';

  export let open = false;
  export let source: RecipePackSource;
  export let recipeATags: string[] = [];
  /**
   * Optional rich recipe list for the preview. When supplied, the
   * modal renders a checkbox-list of titles so the user can deselect
   * individual recipes before publishing. When omitted, the modal
   * stays in the legacy "trust caller's recipeATags" shape used by
   * cookbook + collection share buttons. Backwards-compatible: any
   * caller still passing only `recipeATags` gets the same UI as today.
   */
  export let recipes: { aTag: string; title: string; image?: string }[] | undefined = undefined;
  export let initialTitle: string = '';
  export let initialDescription: string = '';
  export let initialImage: string | undefined = undefined;

  const dispatch = createEventDispatcher();

  let title = '';
  let description = '';
  let effectiveImage: string | undefined = undefined;
  let isResolvingImage = false;
  let alsoShareToFeed = true;
  let isSubmitting = false;
  let announcementFailed = false;
  let error = '';
  let publishedUrl = '';
  let publishedNaddr = '';
  let publishedEvent: import('@nostr-dev-kit/ndk').NDKEvent | null = null;
  let copied = false;

  /**
   * Selected a-tags from the rich recipe list. Default = all selected.
   * Only used when `recipes` is provided; when not, the publish path
   * uses `recipeATags` directly.
   */
  let selectedATags = new Set<string>();

  /** Toggle a single recipe's selection. Extracted from the template
   *  so the cast stays in TS-land — Svelte's inline expression parser
   *  doesn't reliably handle `as HTMLInputElement` mid-template. */
  function toggleRecipeSelection(aTag: string, checked: boolean) {
    const next = new Set(selectedATags);
    if (checked) next.add(aTag);
    else next.delete(aTag);
    selectedATags = next;
  }

  // Reset selection whenever a new `recipes` list arrives. Without this,
  // closing + reopening the modal with a different recipe set would
  // carry stale selections forward.
  $: if (recipes) {
    selectedATags = new Set(recipes.map((r) => r.aTag));
  }

  /** A-tags actually included in the publish: derived from the selection
   *  when the rich recipe list is in play, or the prop directly otherwise. */
  $: effectiveRecipeATags = recipes
    ? recipes.filter((r) => selectedATags.has(r.aTag)).map((r) => r.aTag)
    : recipeATags;

  $: recipeCount = effectiveRecipeATags.length;

  // Reset state every time the modal opens
  $: if (open) initStateOnOpen();
  $: if (!open) {
    publishedUrl = '';
    publishedNaddr = '';
    publishedEvent = null;
    copied = false;
    error = '';
    announcementFailed = false;
  }

  function initStateOnOpen() {
    if (!publishedUrl) {
      title = initialTitle || '';
      description = initialDescription || '';
      effectiveImage = initialImage;

      // Cover image resolution. When the caller passed the rich recipe
      // list we already have image URLs in memory — pick the first one
      // synchronously and skip the network round-trip. Otherwise fall
      // back to resolveFirstRecipeImage's cache-first lookup.
      if (!effectiveImage && recipes && recipes.length > 0) {
        const firstWithImage = recipes.find((r) => r.image);
        if (firstWithImage?.image) {
          effectiveImage = firstWithImage.image;
        }
      }
      if (!effectiveImage && effectiveRecipeATags.length > 0) {
        isResolvingImage = true;
        resolveFirstRecipeImage(effectiveRecipeATags)
          .then((img) => {
            if (img && !effectiveImage) effectiveImage = img;
          })
          .catch((e) => console.warn('[SharePackModal] resolve image failed', e))
          .finally(() => (isResolvingImage = false));
      }
    }
  }

  async function handlePublish() {
    console.log('[SharePackModal] handlePublish entered', {
      titleLen: title.trim().length,
      recipeCount,
      hasUser: !!$userPublickey,
      isSubmitting
    });
    if (isSubmitting) return;
    error = '';
    if (!title.trim()) {
      error = 'Please enter a title.';
      return;
    }
    if (recipeCount === 0) {
      error = 'There are no recipes to share.';
      return;
    }
    if (!$userPublickey) {
      error = 'Sign in to share a Recipe Pack.';
      return;
    }
    isSubmitting = true;
    announcementFailed = false;
    try {
      const result = await publishRecipePack({
        source,
        title: title.trim(),
        description: description.trim() || undefined,
        image: effectiveImage,
        // Use the user's current selection when the rich list is in
        // play, otherwise fall through to the caller-supplied a-tags.
        recipeATags: effectiveRecipeATags
      });
      publishedEvent = result.event;
      publishedNaddr = result.naddr;
      publishedUrl = result.url;

      // Optional kind:1 announcement so the pack also surfaces in feed-only clients.
      if (alsoShareToFeed) {
        try {
          await publishPackAnnouncement(result, {
            title: title.trim(),
            description: description.trim() || undefined,
            recipeCount
          });
          showToast('success', 'Recipe Pack published & posted to feed.');
        } catch (annErr) {
          console.warn('[SharePackModal] announcement failed', annErr);
          announcementFailed = true;
          showToast('info', 'Pack published. Feed announcement failed — you can copy the link manually.');
        }
      } else {
        showToast('success', 'Recipe Pack published.');
      }

      dispatch('published', { event: result.event, naddr: result.naddr, url: result.url });
    } catch (e: any) {
      console.error('[SharePackModal] publish failed', e);
      error = e?.message || 'Failed to publish Recipe Pack.';
      showToast('error', error);
    } finally {
      isSubmitting = false;
    }
  }

  async function handleCopyUrl() {
    if (!publishedUrl) return;
    const ok = await copyToClipboard(publishedUrl);
    if (ok) {
      copied = true;
      setTimeout(() => (copied = false), 1800);
    }
  }

  function handleClose() {
    open = false;
  }
</script>

<Modal cleanup={handleClose} bind:open>
  <h1 slot="title">Share Recipe Pack</h1>

  {#if !publishedUrl}
    <!--
      Using a <div> + on:click on the Publish button rather than
      <form on:submit>+<button type="submit">. The Modal portals
      content into a <dialog> element, and inside <dialog> some
      browsers swallow or reroute form-submit events depending on
      focus/method state, which made the Publish button silently
      no-op for some users. Direct on:click is unambiguous.
    -->
    <div class="flex flex-col gap-4">
      <p class="text-sm text-caption">
        Publish your saved recipes as a curated pack. Anyone on Nostr can open it,
        zap it, and zaps go to you.
      </p>

      <div class="flex flex-col gap-2">
        <label for="pack-title" class="text-sm font-medium" style="color: var(--color-text-primary)">
          Title <span class="text-red-500">*</span>
        </label>
        <input
          id="pack-title"
          type="text"
          class="input"
          bind:value={title}
          placeholder="e.g., Weeknight Dinners"
          maxlength="120"
          disabled={isSubmitting}
        />
      </div>

      <div class="flex flex-col gap-2">
        <label
          for="pack-description"
          class="text-sm font-medium"
          style="color: var(--color-text-primary)"
        >
          Description
        </label>
        <textarea
          id="pack-description"
          class="input"
          rows="3"
          bind:value={description}
          placeholder="Tell people what's in this pack…"
          maxlength="500"
          disabled={isSubmitting}
        />
      </div>

      {#if recipes && recipes.length > 0}
        <!-- Per-recipe checkbox list. Only rendered when the caller
             passed a rich `recipes` prop; cookbook + collection share
             paths still use the legacy preview-only flow. Default-all-
             selected, capped at a max-height so a 200-recipe author
             doesn't get a runaway scroll inside the modal. -->
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium" style="color: var(--color-text-primary)">
              Recipes ({recipeCount} of {recipes.length} selected)
            </span>
            {#if recipeCount < recipes.length}
              <button
                type="button"
                class="text-xs underline"
                style="color: var(--color-text-secondary)"
                disabled={isSubmitting}
                on:click={() => (selectedATags = new Set((recipes ?? []).map((r) => r.aTag)))}
              >
                Select all
              </button>
            {:else if recipeCount > 0}
              <button
                type="button"
                class="text-xs underline"
                style="color: var(--color-text-secondary)"
                disabled={isSubmitting}
                on:click={() => (selectedATags = new Set())}
              >
                Clear
              </button>
            {/if}
          </div>
          <div
            class="flex flex-col gap-1 max-h-56 overflow-y-auto rounded-lg p-1"
            style="background-color: var(--color-input-bg); border: 1px solid var(--color-input-border);"
          >
            {#each recipes as recipe (recipe.aTag)}
              <label
                class="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
              >
                <input
                  type="checkbox"
                  class="w-4 h-4 accent-orange-500 flex-shrink-0"
                  checked={selectedATags.has(recipe.aTag)}
                  disabled={isSubmitting}
                  on:change={(e) =>
                    toggleRecipeSelection(recipe.aTag, e.currentTarget.checked)}
                />
                <span class="text-sm truncate" style="color: var(--color-text-primary)">
                  {recipe.title}
                </span>
              </label>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Live preview -->
      <div class="flex flex-col gap-2">
        <span class="text-sm font-medium" style="color: var(--color-text-primary)">Preview</span>
        <RecipePackCard
          title={title || 'Untitled pack'}
          description={description}
          image={effectiveImage}
          creatorPubkey={$userPublickey}
          recipeCount={recipeCount}
          preview={true}
        />
      </div>

      <!-- Distribution toggle -->
      <label class="flex items-start gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          bind:checked={alsoShareToFeed}
          disabled={isSubmitting}
          class="mt-0.5 w-4 h-4 accent-orange-500"
        />
        <span class="flex flex-col gap-0.5">
          <span class="text-sm font-medium" style="color: var(--color-text-primary)">
            Also share to feed
          </span>
          <span class="text-xs text-caption">
            Posts a regular note linking to your pack so it appears in standard Nostr feeds.
          </span>
        </span>
      </label>

      {#if error}
        <p class="text-sm text-red-500">{error}</p>
      {/if}

      <!--
        The Publish button is always clickable (only blocked while a
        publish is in flight). Validation runs inside handlePublish and
        surfaces user-readable error text — that way clicks never
        silently no-op due to a stale `canPublish` reactive value or a
        race between modal-open and the title prop landing.
      -->
      <div class="flex justify-end gap-2 pt-1">
        <Button on:click={handleClose} primary={false} disabled={isSubmitting}>Cancel</Button>
        <Button on:click={handlePublish} disabled={isSubmitting}>
          {isSubmitting ? 'Publishing…' : 'Publish Recipe Pack'}
        </Button>
      </div>
    </div>
  {:else}
    <div class="flex flex-col gap-4">
      <p class="text-sm" style="color: var(--color-text-primary)">
        Recipe Pack published to Nostr. Share the link or zap the pack from any client.
      </p>
      {#if announcementFailed}
        <p class="text-xs px-3 py-2 rounded-lg" style="background-color: var(--color-input-bg); color: var(--color-text-secondary); border: 1px solid var(--color-input-border);">
          The optional feed announcement didn't publish. The pack itself is live —
          you can paste the link below into any Nostr client.
        </p>
      {/if}

      {#if publishedEvent}
        <RecipePackCard
          event={publishedEvent}
          {title}
          {description}
          image={effectiveImage}
          creatorPubkey={$userPublickey}
          recipeCount={recipeCount}
          viewUrl={publishedUrl}
        />
      {/if}

      <div class="flex items-center gap-2">
        <input
          type="text"
          class="input flex-1 text-sm"
          readonly
          value={publishedUrl}
          on:focus={(e) => (e.currentTarget).select()}
        />
        <button
          type="button"
          on:click={handleCopyUrl}
          class="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
          style="background-color: var(--color-bg-secondary); color: var(--color-text-primary); border: 1px solid var(--color-input-border);"
          aria-label="Copy share link"
        >
          {#if copied}
            <CheckIcon size={14} weight="bold" />
            <span>Copied</span>
          {:else}
            <CopyIcon size={14} weight="bold" />
            <span>Copy</span>
          {/if}
        </button>
      </div>

      <div class="flex justify-end gap-2 pt-1">
        <Button on:click={handleClose}>Done</Button>
      </div>
    </div>
  {/if}
</Modal>
