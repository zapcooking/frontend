<script lang="ts">
  import { writable, type Writable } from 'svelte/store';
  import TagsComboBox from '../../components/TagsComboBox.svelte';
  import StringComboBox from '../../components/StringComboBox.svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { createMarkdown, validateMarkdownTemplate } from '$lib/parser';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import type { recipeTagSimple } from '$lib/consts';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { nip19 } from 'nostr-tools';
  import MediaUploader from '../../components/MediaUploader.svelte';
  import { addClientTagToEvent } from '$lib/nip89';
  import Button from '../../components/Button.svelte';
  import MarkdownEditor from '../../components/MarkdownEditor.svelte';
  import { onMount, onDestroy } from 'svelte';
  import { RECIPE_TAG_PREFIX_NEW } from '$lib/consts';
  import {
    saveDraft,
    getDraft,
    deleteDraft,
    getDraftWithSyncState,
    draftSyncState,
    initializeDraftStore
  } from '$lib/draftStore';
  import FloppyDiskIcon from 'phosphor-svelte/lib/FloppyDisk';
  import CloudCheckIcon from 'phosphor-svelte/lib/CloudCheck';
  import CloudArrowUpIcon from 'phosphor-svelte/lib/CloudArrowUp';
  import SpinnerIcon from 'phosphor-svelte/lib/CircleNotch';
  import WarningIcon from 'phosphor-svelte/lib/Warning';
  import Modal from '../../components/Modal.svelte';

  let title = '';
  let images: Writable<string[]> = writable([]);
  let selectedTags: Writable<recipeTagSimple[]> = writable([]);
  let summary = '';
  let chefsnotes = '';
  let preptime = '';
  let cooktime = '';
  let servings = '';
  let ingredientsArray: Writable<string[]> = writable([]);
  let ingredients = ``;
  let directionsArray: Writable<string[]> = writable([]);
  let directions = ``;
  let additionalMarkdown = '';

  let resultMessage = ' ';
  let disablePublishButton = false;
  let currentDraftId: string | null = null;
  let draftSaveMessage = '';
  let currentDraftSyncStatus: 'local' | 'syncing' | 'synced' | 'error' | undefined = undefined;
  let isSavingDraft = false;
  let showCancelConfirm = false;
  let hasDraftContent = false;

  let cancelListenerAttached = false;

  onMount(() => {
    if ($userPublickey == '') goto('/login');

    // Initialize draft store
    initializeDraftStore();

    // Check for draft ID in URL
    const draftId = $page.url.searchParams.get('draft');
    if (draftId) {
      loadDraftById(draftId);
    }

    if (browser) {
      window.addEventListener('create-cancel-requested', handleCancelRequest);
      cancelListenerAttached = true;
    }
  });

  onDestroy(() => {
    if (browser && cancelListenerAttached) {
      window.removeEventListener('create-cancel-requested', handleCancelRequest);
    }
  });

  function loadDraftById(draftId: string) {
    const draft = getDraftWithSyncState(draftId);
    if (draft) {
      currentDraftId = draftId;
      currentDraftSyncStatus = draft.syncStatus;
      title = draft.title;
      images.set(draft.images);
      selectedTags.set(draft.tags);
      summary = draft.summary;
      chefsnotes = draft.chefsnotes;
      preptime = draft.preptime;
      cooktime = draft.cooktime;
      servings = draft.servings;
      ingredientsArray.set(draft.ingredients);
      directionsArray.set(draft.directions);
      additionalMarkdown = draft.additionalMarkdown;
      draftSaveMessage = 'Draft loaded';
      setTimeout(() => {
        draftSaveMessage = '';
      }, 2000);
    } else {
      // Draft not found: clear current draft state and URL param, and show an error message.
      currentDraftId = null;
      draftSaveMessage = 'Draft not found';
      if (browser) {
        const url = new URL(window.location.href);
        url.searchParams.delete('draft');
        window.history.replaceState({}, '', url.toString());
      }
      setTimeout(() => {
        draftSaveMessage = '';
      }, 2000);
    }
  }

  function navigateBack() {
    if (browser && window.history.length > 1) {
      window.history.back();
    } else {
      goto('/');
    }
  }

  function handleCancelRequest(event: Event) {
    event.preventDefault();
    if (!hasDraftContent) {
      navigateBack();
      return;
    }
    showCancelConfirm = true;
  }

  async function saveDraftAndClose() {
    if (isSavingDraft) return;
    await handleSaveDraft();
    showCancelConfirm = false;
    navigateBack();
  }

  function discardDraftAndClose() {
    showCancelConfirm = false;
    navigateBack();
  }

  async function handleSaveDraft() {
    if (isSavingDraft) return;

    isSavingDraft = true;
    draftSaveMessage = '';

    const draftData = {
      title,
      images: $images,
      tags: $selectedTags,
      summary,
      chefsnotes,
      preptime,
      cooktime,
      servings,
      ingredients: $ingredientsArray,
      directions: $directionsArray,
      additionalMarkdown
    };

    // Save with immediate sync when sync is available
    const syncAvailable = $draftSyncState.syncAvailable;
    const { draftId, syncPromise } = saveDraft(
      draftData,
      currentDraftId || undefined,
      syncAvailable
    );
    currentDraftId = draftId;

    // Update URL to include draft ID (without navigation)
    if (browser) {
      const url = new URL(window.location.href);
      url.searchParams.set('draft', currentDraftId);
      window.history.replaceState({}, '', url.toString());
    }

    if (syncPromise) {
      // Show syncing state
      currentDraftSyncStatus = 'syncing';
      draftSaveMessage = 'Syncing to relays...';

      try {
        const success = await syncPromise;
        if (success) {
          currentDraftSyncStatus = 'synced';
          draftSaveMessage = 'Saved & synced to relays!';
        } else {
          currentDraftSyncStatus = 'error';
          draftSaveMessage = 'Saved locally (sync failed)';
        }
      } catch (e) {
        currentDraftSyncStatus = 'error';
        draftSaveMessage = 'Saved locally (sync failed)';
      }
    } else {
      // No sync available, just local save
      currentDraftSyncStatus = 'local';
      draftSaveMessage = 'Saved locally';
    }

    isSavingDraft = false;
    setTimeout(() => {
      draftSaveMessage = '';
    }, 3000);
  }

  function formatStringArrays() {
    ingredients = '';
    $ingredientsArray.forEach((e) => {
      ingredients += `- ${e}\n`;
    });
    directions = '';
    let i = 0;
    $directionsArray.forEach((e) => {
      i++;
      directions += `${i}. ${e}\n`;
    });
  }

  // Check if all required fields are filled (for enabling publish button)
  $: canPublish =
    $images.length > 0 &&
    title &&
    $selectedTags.length > 0 &&
    $directionsArray.length > 0 &&
    $ingredientsArray.length > 0;

  async function publishRecipe() {
    formatStringArrays();
    disablePublishButton = true;
    try {
      const md = createMarkdown(
        chefsnotes,
        preptime,
        cooktime,
        servings,
        ingredients,
        directions,
        additionalMarkdown
      );
      const va = validateMarkdownTemplate(md);
      if (typeof va == 'string') {
        resultMessage = `Error: ${va}`;
      } else if ($images.length == 0) {
        resultMessage = `Error: No Image Uploaded`;
      } else if (va) {
        const event = new NDKEvent($ndk);
        event.kind = 30023;
        event.content = md;
        event.tags.push(['d', title.toLowerCase().replaceAll(' ', '-')]);
        event.tags.push(['title', title]);
        event.tags.push(['t', RECIPE_TAG_PREFIX_NEW]);
        event.tags.push([
          't',
          `${RECIPE_TAG_PREFIX_NEW}-${title.toLowerCase().replaceAll(' ', '-')}`
        ]);
        if (summary !== '') {
          event.tags.push(['summary', summary]);
        }
        if ($images.length > 0) {
          for (let i = 0; i < $images.length; i++) {
            event.tags.push(['image', $images[i]]);
          }
        }
        $selectedTags.forEach((t) => {
          if (t.title) {
            event.tags.push([
              't',
              `${RECIPE_TAG_PREFIX_NEW}-${t.title.toLowerCase().replaceAll(' ', '-')}`
            ]);
          }
        });

        // Add NIP-89 client tag
        addClientTagToEvent(event);

        console.log('event to publish:', event);
        let relays = await event.publish();
        relays.forEach((relay) => {
          relay.once('published', () => {
            console.log('published to', relay);
          });
          relay.once('publish:failed', (relay, err) => {
            console.log('publish failed to', relay, err);
          });
        });
        const naddr = nip19.naddrEncode({
          identifier: title.toLowerCase().replaceAll(' ', '-'),
          pubkey: event.author.hexpubkey,
          kind: 30023
        });
        resultMessage = 'Success! Redirecting to your recipe...';

        // Delete the draft since it's now published
        if (currentDraftId) {
          deleteDraft(currentDraftId);
          currentDraftId = null;
        }

        // Redirect to the recipe page
        setTimeout(() => {
          goto(`/recipe/${naddr}`);
        }, 1500);
        return; // Don't reset disablePublishButton - keep it disabled until redirect
      }
    } catch (err) {
      console.error('error while publishing', err);
      resultMessage = 'Error: Something went wrong, Error: ' + String(err);
    } finally {
      if (resultMessage == 'Processing...') {
        resultMessage = ' ';
      }
      disablePublishButton = false;
    }
  }

  $: hasDraftContent =
    Boolean(title.trim()) ||
    $images.length > 0 ||
    $selectedTags.length > 0 ||
    Boolean(summary.trim()) ||
    Boolean(chefsnotes.trim()) ||
    Boolean(preptime.trim()) ||
    Boolean(cooktime.trim()) ||
    Boolean(servings.trim()) ||
    $ingredientsArray.length > 0 ||
    $directionsArray.length > 0 ||
    Boolean(additionalMarkdown.trim());
</script>

<svelte:head>
  <title>Create a Recipe - zap.cooking</title>
</svelte:head>

<form on:submit|preventDefault={publishRecipe} class="flex flex-col max-w-[760px] mx-auto gap-6">
  <div class="flex justify-between items-center">
    <h1>Create Recipe</h1>
  </div>

  {#if currentDraftId}
    <div class="text-sm text-caption flex items-center gap-2">
      <span>Editing draft</span>
      {#if $draftSyncState.syncAvailable}
        {#if currentDraftSyncStatus === 'synced'}
          <span class="flex items-center gap-1 text-green-500" title="Synced to cloud">
            <CloudCheckIcon size={14} />
            <span>Synced</span>
          </span>
        {:else}
          <span class="flex items-center gap-1 text-caption" title="Saved locally, will sync">
            <CloudArrowUpIcon size={14} />
            <span>Local</span>
          </span>
        {/if}
      {/if}
      <span>•</span>
      <button
        type="button"
        class="underline hover:text-primary cursor-pointer"
        on:click={() => goto('/create')}>Start fresh</button
      >
    </div>
  {/if}

  <div class="flex flex-col gap-2">
    <h3>Title*</h3>
    <span class="text-caption">Remember to make your title unique!</span>
    <input placeholder="Title" bind:value={title} class="input" />
  </div>

  <div class="flex flex-col gap-2">
    <h3>Tags*</h3>
    <span class="text-caption">Select tags that describe your recipe</span>
    <TagsComboBox {selectedTags} />
  </div>

  <div class="flex flex-col gap-2">
    <h3>Brief Summary</h3>
    <textarea
      placeholder="Some brief description of the dish (can be the same as chef's notes)"
      bind:value={summary}
      rows="6"
      class="input"
    />
  </div>

  <div class="flex flex-col gap-2">
    <h3>Chef's Notes</h3>
    <span class="text-caption">Some notes about this recipe. (Markdown is supported)</span>
    <MarkdownEditor
      bind:value={chefsnotes}
      placeholder="Eg. where the recipe is from, or any additional information"
      rows={6}
    />
  </div>

  <div class="flex flex-col gap-4">
    <h3>Details</h3>
    <div class="flex flex-col gap-2">
      <span class="font-bold">Prep Time</span>
      <input placeholder="20 min" bind:value={preptime} class="input" />
    </div>
    <div class="flex flex-col gap-2">
      <span class="font-bold">Cooking Time</span>
      <input placeholder="1 hour and 5 min" bind:value={cooktime} class="input" />
    </div>
    <div class="flex flex-col gap-2">
      <span class="font-bold">Servings (persons)</span>
      <input placeholder="4" bind:value={servings} class="input" />
    </div>
  </div>
  <div class="flex flex-col gap-2">
    <h3>Ingredients*</h3>
    <StringComboBox placeholder={'2 eggs'} selected={ingredientsArray} showIndex={false} />
  </div>
  <div class="flex flex-col gap-2">
    <h3>Directions*</h3>
    <StringComboBox placeholder={'Bake for 30 min'} selected={directionsArray} showIndex={false} />
  </div>
  <div class="flex flex-col gap-2">
    <h3>Photos & Videos*</h3>
    <span class="text-caption">First image will be your cover photo</span>
    <MediaUploader uploadedImages={images} />
  </div>

  <div class="flex justify-end items-center gap-2">
    {#if draftSaveMessage}
      <span
        class="text-sm {currentDraftSyncStatus === 'synced'
          ? 'text-green-500'
          : currentDraftSyncStatus === 'error'
            ? 'text-yellow-500'
            : currentDraftSyncStatus === 'syncing'
              ? 'text-blue-500'
              : 'text-caption'}"
      >
        {draftSaveMessage}
      </span>
    {/if}
    <span
      class={resultMessage.includes('Error')
        ? 'text-red-500'
        : resultMessage.includes('Success')
          ? 'text-green-500'
          : ''}
    >
      {resultMessage}
    </span>
    <button
      type="button"
      on:click={handleSaveDraft}
      disabled={isSavingDraft}
      class="flex items-center gap-2 px-4 py-2.5 rounded-full bg-input hover:bg-accent-gray transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      title={$draftSyncState.syncAvailable
        ? 'Save draft to local & sync to relays'
        : 'Save draft locally (login with encryption to sync)'}
    >
      {#if isSavingDraft}
        <SpinnerIcon size={18} class="animate-spin" />
        <span>Saving...</span>
      {:else if currentDraftSyncStatus === 'synced'}
        <CloudCheckIcon size={18} class="text-green-500" />
        <span>Save Draft</span>
      {:else if currentDraftSyncStatus === 'error'}
        <WarningIcon size={18} class="text-yellow-500" />
        <span>Save Draft</span>
      {:else if $draftSyncState.syncAvailable}
        <CloudArrowUpIcon size={18} />
        <span>Save Draft</span>
      {:else}
        <FloppyDiskIcon size={18} />
        <span>Save Draft</span>
      {/if}
    </button>
    <Button disabled={disablePublishButton || !canPublish} type="submit">Publish Recipe</Button>
  </div>
</form>

<Modal bind:open={showCancelConfirm}>
  <svelte:fragment slot="title">Save draft before leaving?</svelte:fragment>
  <div class="flex flex-col gap-3">
    <p class="text-sm" style="color: var(--color-caption);">
      You have unsaved changes. Save a draft so you can come back to this recipe later.
    </p>
    <div class="flex flex-wrap gap-3 justify-end mt-2">
      <Button primary={false} on:click={() => (showCancelConfirm = false)} disabled={isSavingDraft}>
        Keep editing
      </Button>
      <Button primary={false} on:click={discardDraftAndClose} disabled={isSavingDraft}>
        Discard
      </Button>
      <Button
        on:click={saveDraftAndClose}
        disabled={isSavingDraft}
        class="!bg-orange-500 hover:!bg-orange-600"
      >
        {isSavingDraft ? 'Saving...' : 'Save Draft'}
      </Button>
    </div>
  </div>
</Modal>
