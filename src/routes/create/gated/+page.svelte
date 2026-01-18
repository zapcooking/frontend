<script lang="ts">
  import { writable, type Writable } from 'svelte/store';
  import TagsComboBox from '../../../components/TagsComboBox.svelte';
  import StringComboBox from '../../../components/StringComboBox.svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { createMarkdown, validateMarkdownTemplate } from '$lib/parser';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import type { recipeTagSimple } from '$lib/consts';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { nip19 } from 'nostr-tools';
  import MediaUploader from '../../../components/MediaUploader.svelte';
  import { addClientTagToEvent } from '$lib/nip89';
  import Button from '../../../components/Button.svelte';
  import MarkdownEditor from '../../../components/MarkdownEditor.svelte';
  import { onMount } from 'svelte';
  import { RECIPE_TAG_PREFIX_NEW, GATED_RECIPE_KIND, GATED_RECIPE_TAG } from '$lib/consts';
  import { saveDraft, getDraft, deleteDraft } from '$lib/draftStore';
  import FloppyDiskIcon from 'phosphor-svelte/lib/FloppyDisk';
  import GateRecipeToggle from '../../../components/GateRecipeToggle.svelte';
  import { createGatedRecipe } from '$lib/nip108/client';
  import { membershipStore } from '$lib/membershipStore';
  import { get } from 'svelte/store';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import { resolveProfileByPubkey } from '$lib/profileResolver';

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

  // Lightning gating options
  let isGated = true; // Always enabled on this page
  let gateCostSats = 100; // Cost in whole sats
  let gatePreview = '';

  // Check Pro Kitchen membership
  let isProKitchen = true; // Membership check disabled for testing
  let membershipChecked = true;
  
  // Author's Lightning address for receiving payments
  let authorLightningAddress = '';

  onMount(async () => {
    if ($userPublickey == '') {
      goto('/login');
      return;
    }
    
    // Fetch author's Lightning address from their profile
    try {
      const profile = await resolveProfileByPubkey($userPublickey, $ndk);
      if (profile?.lud16) {
        authorLightningAddress = profile.lud16;
      }
    } catch (e) {
      // Profile fetch failed - payments will use test mode
    }
    
    // Membership check disabled for now
    // When re-enabling, check tier and redirect non-pro users to /membership

    // Check for draft ID in URL
    const draftId = $page.url.searchParams.get('draft');
    if (draftId) {
      loadDraftById(draftId);
    }
  });

  function loadDraftById(draftId: string) {
    const draft = getDraft(draftId);
    if (draft) {
      currentDraftId = draftId;
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
      setTimeout(() => { draftSaveMessage = ''; }, 2000);
    } else {
      currentDraftId = null;
      draftSaveMessage = 'Draft not found';
      if (browser) {
        const url = new URL(window.location.href);
        url.searchParams.delete('draft');
        window.history.replaceState({}, '', url.toString());
      }
      setTimeout(() => { draftSaveMessage = ''; }, 2000);
    }
  }

  function handleSaveDraft() {
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
    
    currentDraftId = saveDraft(draftData, currentDraftId || undefined);
    draftSaveMessage = 'Draft saved!';
    
    if (browser) {
      const url = new URL(window.location.href);
      url.searchParams.set('draft', currentDraftId);
      window.history.replaceState({}, '', url.toString());
    }
    
    setTimeout(() => { draftSaveMessage = ''; }, 2000);
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
  $: canPublish = $images.length > 0 && title && $selectedTags.length > 0 && $directionsArray.length > 0 && $ingredientsArray.length > 0 && gateCostSats > 0;

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
        // Create the gated recipe event (kind 35000)
        const event = new NDKEvent($ndk);
        event.kind = GATED_RECIPE_KIND;
        event.content = md;
        event.tags.push(['d', title.toLowerCase().replaceAll(' ', '-')]);
        event.tags.push(['title', title]);
        event.tags.push(['t', GATED_RECIPE_TAG]); // Premium recipe tag for filtering
        event.tags.push(['t', RECIPE_TAG_PREFIX_NEW]); // Also tag as zapcooking for discoverability
        event.tags.push(['t', `${RECIPE_TAG_PREFIX_NEW}-${title.toLowerCase().replaceAll(' ', '-')}`]);
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
            event.tags.push(['t', `${RECIPE_TAG_PREFIX_NEW}-${t.title.toLowerCase().replaceAll(' ', '-')}`]);
          }
        });
        
        // Add NIP-89 client tag
        addClientTagToEvent(event);
        
        resultMessage = 'Creating gated content...';
        
        // Create gated content (stores encrypted content on server)
        // Convert sats to msats for Lightning compatibility
        const costMsats = gateCostSats * 1000;
        const endpoint = `${window.location.origin}/api/nip108/payment`;
        const gatedResult = await createGatedRecipe(
          event,
          $ndk,
          costMsats,
          endpoint,
          gatePreview || summary,
          authorLightningAddress // Pass Lightning address for payments to author
        );
        
        resultMessage = 'Publishing recipe...';
        
        // Add gated tag to recipe with gatedNoteId and cost in sats (human readable)
        event.tags.push(['gated', gatedResult.gatedNoteId, gateCostSats.toString()]);
        
        // Publish the recipe with gated tag
        await event.publish();
        
        const naddr = nip19.naddrEncode({
          identifier: title.toLowerCase().replaceAll(' ', '-'),
          pubkey: event.author.hexpubkey,
          kind: GATED_RECIPE_KIND
        });
        
        // Update the server store with the naddr for easy linking
        try {
          await fetch('/api/nip108/store-gated', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              gatedNoteId: gatedResult.gatedNoteId,
              naddr
            })
          });
        } catch (e) {
          // Non-critical: naddr update failed
        }
        
        resultMessage = 'Premium recipe created! Redirecting...';
        
        // Delete the draft since it's now published
        if (currentDraftId) {
          deleteDraft(currentDraftId);
          currentDraftId = null;
        }
        
        // Redirect to the premium recipe page
        setTimeout(() => {
          goto(`/premium/recipe/${naddr}`);
        }, 1500);
        return; // Don't reset disablePublishButton - keep it disabled until redirect
      }
    } catch (err) {
      resultMessage = 'Error: Something went wrong, Error: ' + String(err);
    } finally {
      if (resultMessage == 'Processing...') {
        resultMessage = ' ';
      }
      disablePublishButton = false;
    }
  }
</script>

<svelte:head>
  <title>Create Premium Recipe - zap.cooking</title>
</svelte:head>

{#if !membershipChecked}
  <div class="max-w-[760px] mx-auto p-8 text-center">
    <p class="text-caption">Loading...</p>
  </div>
{:else if !isProKitchen}
  <div class="max-w-[760px] mx-auto p-8 text-center">
    <LightningIcon size={48} class="mx-auto mb-4 text-orange-500" />
    <h1 class="text-2xl font-bold mb-4">Pro Kitchen Required</h1>
    <p class="text-caption mb-6">
      Lightning-gated recipes are a Pro Kitchen feature. Upgrade to create premium recipes!
    </p>
    <Button on:click={() => goto('/membership')}>Upgrade to Pro Kitchen</Button>
  </div>
{:else}
  <form on:submit|preventDefault={publishRecipe} class="flex flex-col max-w-[760px] mx-auto gap-6">
    <div class="flex justify-between items-center">
      <div>
        <h1>Create Premium Recipe</h1>
        <p class="text-sm text-caption mt-1">Create a Lightning-gated recipe (Pro Kitchen feature)</p>
      </div>
      <a href="/create" class="text-sm text-primary hover:underline">← Regular Recipe</a>
    </div>
    
    {#if currentDraftId}
      <div class="text-sm text-caption">
        Editing draft • <button type="button" class="underline hover:text-primary cursor-pointer" on:click={() => goto('/create/gated')}>Start fresh</button>
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

    <!-- Lightning Gating Options -->
    <GateRecipeToggle bind:enabled={isGated} bind:costSats={gateCostSats} bind:preview={gatePreview} />

    <!-- Lightning Address for Payments -->
    <div class="flex flex-col gap-3 p-4 rounded-xl border" style="border-color: var(--color-input-border); background-color: var(--color-input-bg);">
      <div class="flex items-center gap-2">
        <LightningIcon size={20} class="text-amber-500" />
        <h3 class="font-semibold">Payment Destination</h3>
      </div>
      
      {#if authorLightningAddress}
        <div class="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/30">
          <svg class="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
          </svg>
          <span class="text-green-700 dark:text-green-400">
            Payments will be sent to: <strong>{authorLightningAddress}</strong>
          </span>
        </div>
      {:else}
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <svg class="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
            </svg>
            <span class="text-amber-700 dark:text-amber-400 text-sm">
              No Lightning address found in your profile. Enter one below to receive payments.
            </span>
          </div>
          <input 
            type="text" 
            bind:value={authorLightningAddress}
            placeholder="your@lightning.address"
            class="input"
          />
          <span class="text-xs text-caption">
            Update your Nostr profile with a lud16 (Lightning address) to have it auto-fill.
          </span>
        </div>
      {/if}
    </div>

    <div class="flex justify-end items-center gap-2">
      {#if draftSaveMessage}
        <span class="text-sm text-green-500">{draftSaveMessage}</span>
      {/if}
      <span class={resultMessage.includes('Error') ? 'text-red-500' : resultMessage.includes('Success') || resultMessage.includes('created') ? 'text-green-500' : ''}>
        {resultMessage}
      </span>
      <button 
        type="button" 
        on:click={handleSaveDraft}
        class="flex items-center gap-2 px-4 py-2 rounded-lg bg-input hover:bg-accent-gray transition-colors cursor-pointer"
        title="Save as draft"
      >
        <FloppyDiskIcon size={18} />
        <span>Save Draft</span>
      </button>
      <Button disabled={disablePublishButton || !canPublish} type="submit">
        <LightningIcon size={18} class="inline mr-2" />
        Publish Premium Recipe
      </Button>
    </div>
  </form>
{/if}
