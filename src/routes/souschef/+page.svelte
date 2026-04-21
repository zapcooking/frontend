<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { writable, type Writable } from 'svelte/store';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { Fetch } from 'hurdak';
  import { saveDraft } from '$lib/draftStore';
  import { membershipStatusMap, queueMembershipLookup, type MembershipStatus } from '$lib/stores/membershipStatus';
  import { recipeTags, RECIPE_TAG_PREFIX_NEW, type recipeTagSimple } from '$lib/consts';
  import { createMarkdown, validateMarkdownTemplate } from '$lib/parser';
  import { addClientTagToEvent } from '$lib/nip89';
  import { nip19 } from 'nostr-tools';
  import {
    ANON_IMPORT_HANDOFF_KEY,
    ANON_IMPORT_MAX_AGE_MS,
    type AnonImportHandoff
  } from '$lib/anonImport';
  import Button from '../../components/Button.svelte';
  import Tabs from '../../components/Tabs.svelte';
  import TagsComboBox from '../../components/TagsComboBox.svelte';
  import StringComboBox from '../../components/StringComboBox.svelte';
  import MediaUploader from '../../components/MediaUploader.svelte';
  import MarkdownEditor from '../../components/MarkdownEditor.svelte';
  import UploadIcon from 'phosphor-svelte/lib/UploadSimple';
  import LinkIcon from 'phosphor-svelte/lib/Link';
  import SparkleIcon from 'phosphor-svelte/lib/Sparkle';
  import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwise';
  import WarningIcon from 'phosphor-svelte/lib/Warning';
  import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircle';
  import PencilIcon from 'phosphor-svelte/lib/PencilSimple';
  import ImageIcon from 'phosphor-svelte/lib/Image';
  import FloppyDiskIcon from 'phosphor-svelte/lib/FloppyDisk';

  // Membership gate
  let membershipMap: Record<string, MembershipStatus> = {};
  const unsubMembership = membershipStatusMap.subscribe((v) => { membershipMap = v; });
  $: if ($userPublickey) queueMembershipLookup($userPublickey);
  $: normalizedPk = String($userPublickey || '').trim().toLowerCase();
  $: hasMembership = Boolean(membershipMap[normalizedPk]?.active);

  // State management
  let isLoading = true;
  let errorMessage = '';

  // Anon preview — set when an unauthenticated user arrives via the
  // landing hero with a parsed recipe stashed in sessionStorage.
  // Collapses the extraction UI and renders the editor read-only with
  // a sign-in CTA. Transitions to normal mode automatically if the user
  // signs in while on this page (see reactive block below).
  let isAnonPreview = false;
  let anonPreviewSourceUrl = '';
  
  // Input mode
  type InputMode = 'image' | 'url' | 'text';
  let inputMode: InputMode = 'url';
  const ALL_TABS = [
    { id: 'image', label: 'Upload Image' },
    { id: 'url', label: 'Paste URL' },
    { id: 'text', label: 'Paste Text' }
  ];
  // URL import is free for everyone; image/text stay behind the member
  // gate. Non-members see a URL-only tab set so the premium surfaces
  // aren't advertised to them inline. Initialize optimistically to the
  // URL-only set — the reactive statement below widens to ALL_TABS
  // once `hasMembership` resolves.
  let tabs: { id: string; label: string }[] = ALL_TABS.filter((t) => t.id === 'url');
  $: tabs = hasMembership ? ALL_TABS : ALL_TABS.filter((t) => t.id === 'url');
  $: if (!hasMembership && inputMode !== 'url') inputMode = 'url';

  // Text input state
  let textInput = '';

  // Image upload state
  let fileInput: HTMLInputElement;
  let isDragging = false;
  let uploadedImageData: string | null = null;
  let uploadedImagePreview: string | null = null;
  
  // URL input state
  let urlInput = '';
  let urlError = '';
  
  // Publishing state
  let isPublishing = false;
  let publishError = '';

  // Extraction state
  let isExtracting = false;
  let extractionProgress = '';
  let extractionError = '';
  let extractionSuccess = false;
  
  // Extracted recipe data (editable)
  let title = '';
  let images: Writable<string[]> = writable([]);
  let selectedTags: Writable<recipeTagSimple[]> = writable([]);
  let summary = '';
  let chefsnotes = '';
  let preptime = '';
  let cooktime = '';
  let servings = '';
  let ingredientsArray: Writable<string[]> = writable([]);
  let directionsArray: Writable<string[]> = writable([]);
  let additionalMarkdown = '';
  
  onMount(() => {
    // Handoff from the landing-page import hero. Present for both
    // anon visitors (full hero) AND logged-in non-premium users
    // (compact pill). If present and fresh, hydrate the editor and
    // skip the extraction UI — the recipe is already parsed. Only
    // enter "view-only preview" mode for actual anon visitors; a
    // logged-in user continuing from the pill should see full
    // publish/save-draft controls.
    if (browser) {
      try {
        const raw = sessionStorage.getItem(ANON_IMPORT_HANDOFF_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as AnonImportHandoff | null;
          if (
            parsed &&
            parsed.recipe &&
            typeof parsed.at === 'number' &&
            Date.now() - parsed.at <= ANON_IMPORT_MAX_AGE_MS
          ) {
            hydrateFromHandoff(parsed, !$userPublickey);
          }
          // Always clear — a stale or malformed handoff shouldn't
          // linger and re-hydrate on a later visit.
          sessionStorage.removeItem(ANON_IMPORT_HANDOFF_KEY);
        }
      } catch {
        // sessionStorage disabled or JSON malformed — fall through to
        // the normal extraction UI.
      }
    }
    isLoading = false;
    return () => unsubMembership();
  });

  function hydrateFromHandoff(handoff: AnonImportHandoff, viewOnly: boolean) {
    const recipe = handoff.recipe;
    title = recipe.title || '';
    summary = recipe.summary || '';
    chefsnotes = recipe.chefsnotes || '';
    preptime = recipe.preptime || '';
    cooktime = recipe.cooktime || '';
    servings = recipe.servings || '';
    ingredientsArray.set(recipe.ingredients || []);
    directionsArray.set(recipe.directions || []);

    // Tag matching mirrors the authenticated extractRecipe path so the
    // handoff looks identical to a fresh member extraction.
    const matchedTags: recipeTagSimple[] = [];
    for (const tagName of recipe.tags || []) {
      const normalizedTag = tagName.toLowerCase().trim();
      const existing = recipeTags.find((t) => t.title.toLowerCase() === normalizedTag);
      matchedTags.push(existing ?? { title: tagName });
    }
    selectedTags.set(matchedTags);

    // Anon can't rehost to nostr.build (NIP-98 sign required) — use the
    // raw external URLs as-is. If the user signs in and publishes, the
    // URLs are emitted on the kind:30023 event directly; this matches
    // the existing member-side fallback when rehosting fails.
    if (Array.isArray(recipe.imageUrls) && recipe.imageUrls.length > 0) {
      images.set([recipe.imageUrls[0]]);
    }

    anonPreviewSourceUrl = handoff.sourceUrl || '';
    isAnonPreview = viewOnly;
    extractionSuccess = true;
  }

  // If the user signs in while on this page (e.g. after clicking
  // "Sign in to publish"), drop the anon-preview flag so the normal
  // publish/save-draft controls unlock. The hydrated form fields stay
  // populated — they just become editable.
  $: if (isAnonPreview && $userPublickey) {
    isAnonPreview = false;
    // TODO(analytics): emit `post_import_signup` with
    // { sourceUrl: anonPreviewSourceUrl }.
  }
  
  // Handle tab change
  function handleTabChange(event: CustomEvent<string>) {
    inputMode = event.detail as InputMode;
    clearInputs();
  }
  
  // Clear all inputs
  function clearInputs() {
    uploadedImageData = null;
    uploadedImagePreview = null;
    urlInput = '';
    urlError = '';
    textInput = '';
    extractionError = '';
    extractionSuccess = false;
  }
  
  // Image handling
  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
    if (e.dataTransfer?.files) {
      handleFiles(e.dataTransfer.files);
    }
  }
  
  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    isDragging = true;
  }
  
  function handleDragLeave() {
    isDragging = false;
  }
  
  function handleFileSelect(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files) {
      handleFiles(target.files);
    }
  }
  
  async function handleFiles(files: FileList) {
    if (files.length === 0) return;
    
    const file = files[0];
    if (!file.type.startsWith('image/')) {
      extractionError = 'Please upload an image file (JPG, PNG, WEBP, or GIF)';
      return;
    }
    
    // Check file size (max 20MB for OpenAI)
    if (file.size > 20 * 1024 * 1024) {
      extractionError = 'Image file is too large. Please use an image under 20MB.';
      return;
    }
    
    // Read as base64
    const reader = new FileReader();
    reader.onload = () => {
      uploadedImageData = reader.result as string;
      uploadedImagePreview = uploadedImageData;
      extractionError = '';
    };
    reader.onerror = () => {
      extractionError = 'Failed to read image file';
    };
    reader.readAsDataURL(file);
  }
  
  function removeImage() {
    uploadedImageData = null;
    uploadedImagePreview = null;
  }
  
  // URL validation
  function validateUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
  
  $: if (urlInput) {
    urlError = validateUrl(urlInput) ? '' : 'Please enter a valid URL';
  }
  
  // Check if we can extract
  $: canExtract = inputMode === 'image'
    ? !!uploadedImageData
    : inputMode === 'url'
      ? (!!urlInput && !urlError)
      : !!textInput.trim();
  
  // Upload image to nostr.build
  async function uploadToNostrBuild(file: File): Promise<string | null> {
    const body = new FormData();
    body.append('file[]', file);
    
    const url = 'https://nostr.build/api/v2/upload/files';
    const template = new NDKEvent($ndk);
    template.kind = 27235;
    template.created_at = Math.floor(Date.now() / 1000);
    template.content = '';
    template.tags = [
      ['u', url],
      ['method', 'POST']
    ];

    await template.sign();
    
    const authEvent = {
      id: template.id,
      pubkey: template.pubkey,
      created_at: template.created_at,
      kind: template.kind,
      tags: template.tags,
      content: template.content,
      sig: template.sig
    };

    try {
      const result = await Fetch.fetchJson(url, {
        body,
        method: 'POST',
        headers: {
          Authorization: `Nostr ${btoa(JSON.stringify(authEvent))}`
        }
      });
      
      if (result && result.data && result.data[0]?.url) {
        return result.data[0].url;
      }
    } catch (error) {
      console.error('Upload failed:', error);
    }
    return null;
  }
  
  // Convert base64 to File
  function base64ToFile(base64: string, filename: string): File {
    const arr = base64.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
  }
  
  // Re-host an external image URL to nostr.build
  async function rehostImage(imageUrl: string): Promise<string | null> {
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) return null;
      
      const blob = await response.blob();
      const file = new File([blob], 'recipe-image.jpg', { type: blob.type || 'image/jpeg' });
      return await uploadToNostrBuild(file);
    } catch (error) {
      console.error('Failed to rehost image:', error);
      return null;
    }
  }
  
  // Extract recipe (requires login; redirect so reviewer can see upload UI first)
  async function extractRecipe() {
    if (!$userPublickey) {
      goto('/login?redirect=/souschef');
      return;
    }
    if (!canExtract || isExtracting) return;
    
    isExtracting = true;
    extractionError = '';
    extractionProgress = 'Analyzing content...';
    
    try {
      const requestBody: any = {
        type: inputMode,
        pubkey: $userPublickey
      };
      
      if (inputMode === 'image') {
        requestBody.imageData = uploadedImageData;
        extractionProgress = 'Extracting recipe from image...';
      } else if (inputMode === 'text') {
        requestBody.textData = textInput.trim();
        extractionProgress = 'Formatting your recipe...';
      } else {
        requestBody.url = urlInput;
        extractionProgress = 'Fetching and extracting recipe from URL...';
      }
      
      const response = await fetch('/api/extract-recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      
      const data = await response.json();
      
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to extract recipe');
      }
      
      // Populate the form with extracted data
      const recipe = data.recipe;
      title = recipe.title || '';
      summary = recipe.summary || '';
      chefsnotes = recipe.chefsnotes || '';
      preptime = recipe.preptime || '';
      cooktime = recipe.cooktime || '';
      servings = recipe.servings || '';
      ingredientsArray.set(recipe.ingredients || []);
      directionsArray.set(recipe.directions || []);
      
      // Match tags to existing tags
      const matchedTags: recipeTagSimple[] = [];
      for (const tagName of recipe.tags || []) {
        const normalizedTag = tagName.toLowerCase().trim();
        const existingTag = recipeTags.find(t => 
          t.title.toLowerCase() === normalizedTag
        );
        if (existingTag) {
          matchedTags.push(existingTag);
        } else {
          matchedTags.push({ title: tagName });
        }
      }
      selectedTags.set(matchedTags);
      
      // Handle image upload/rehosting
      const uploadedUrls: string[] = [];
      
      if (inputMode === 'image' && uploadedImageData) {
        // Upload the user's image to nostr.build
        extractionProgress = 'Uploading image to nostr.build...';
        const file = base64ToFile(uploadedImageData, 'recipe-image.jpg');
        const uploadedUrl = await uploadToNostrBuild(file);
        if (uploadedUrl) {
          uploadedUrls.push(uploadedUrl);
        }
      } else if (inputMode === 'url' && recipe.imageUrls && recipe.imageUrls.length > 0) {
        // Rehost the first image from the URL to nostr.build
        extractionProgress = 'Downloading and uploading recipe image...';
        const firstImageUrl = recipe.imageUrls[0];
        const rehostedUrl = await rehostImage(firstImageUrl);
        if (rehostedUrl) {
          uploadedUrls.push(rehostedUrl);
        } else {
          // If rehosting fails, try to use the original URL directly
          // (some sites block this, but it's worth trying)
          uploadedUrls.push(firstImageUrl);
        }
      }
      
      // Set the images
      if (uploadedUrls.length > 0) {
        images.set(uploadedUrls);
      }
      
      extractionSuccess = true;
      extractionProgress = '';
      
    } catch (err) {
      extractionError = err instanceof Error ? err.message : 'Failed to extract recipe';
      extractionProgress = '';
    } finally {
      isExtracting = false;
    }
  }
  
  // Save as draft and navigate to drafts page
  function saveDraftOnly() {
    if (!$userPublickey) {
      goto('/login?redirect=/souschef');
      return;
    }
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
    
    saveDraft(draftData);
    
    // Navigate to user's drafts tab
    if ($userPublickey) {
      goto(`/user/${nip19.npubEncode($userPublickey)}?tab=drafts`);
    }
  }
  
  // Publish recipe directly to relays
  async function publishRecipe() {
    if (!$userPublickey) {
      goto('/login?redirect=/souschef');
      return;
    }

    if (!title || $images.length === 0 || $selectedTags.length === 0 || $ingredientsArray.length === 0 || $directionsArray.length === 0) {
      publishError = 'Please fill in all required fields (title, tags, ingredients, directions) and add at least one image.';
      return;
    }

    isPublishing = true;
    publishError = '';

    try {
      // Format ingredients/directions into markdown strings
      let ingredients = '';
      $ingredientsArray.forEach((e) => {
        ingredients += `- ${e}\n`;
      });
      let directions = '';
      let i = 0;
      $directionsArray.forEach((e) => {
        i++;
        directions += `${i}. ${e}\n`;
      });

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
      if (typeof va === 'string') {
        publishError = va;
        isPublishing = false;
        return;
      }

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
      for (let j = 0; j < $images.length; j++) {
        event.tags.push(['image', $images[j]]);
      }
      $selectedTags.forEach((t) => {
        if (t.title) {
          event.tags.push([
            't',
            `${RECIPE_TAG_PREFIX_NEW}-${t.title.toLowerCase().replaceAll(' ', '-')}`
          ]);
        }
      });

      addClientTagToEvent(event);

      // Publish with timeout
      let publishTimeoutId: ReturnType<typeof setTimeout> | undefined;
      const publishTimeout: Promise<never> = new Promise((_, reject) => {
        publishTimeoutId = setTimeout(
          () => reject(new Error('Publish timed out after 15 seconds')),
          15000
        );
      });
      await Promise.race([event.publish(), publishTimeout]);
      if (publishTimeoutId !== undefined) {
        clearTimeout(publishTimeoutId);
      }

      const naddr = nip19.naddrEncode({
        identifier: title.toLowerCase().replaceAll(' ', '-'),
        pubkey: event.pubkey,
        kind: 30023
      });

      goto(`/recipe/${naddr}`);
    } catch (err) {
      console.error('Error publishing recipe:', err);
      publishError = 'Failed to publish: ' + String(err);
      isPublishing = false;
    }
  }
  
  // Cancel and go back
  function handleCancel() {
    goto('/');
  }
  
  // Check if form has data
  $: hasFormData = title || $ingredientsArray.length > 0 || $directionsArray.length > 0;
</script>

<svelte:head>
  <title>Sous Chef - zap.cooking</title>
</svelte:head>

<div class="flex flex-col max-w-[760px] mx-auto gap-6 pb-8">
  <!-- Header -->
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-3">
      <SparkleIcon size={32} class="text-primary" weight="fill" />
      <h1>Sous Chef</h1>
    </div>
    <p class="text-caption">
      Turn photos, links, or pasted text into ready-to-post recipes.
    </p>
    <p class="text-caption">
      A little extra help in the kitchen.
    </p>
    <p class="text-caption text-sm">
      URL imports are free. Image and text imports are a Pro Kitchen feature.
    </p>
  </div>

  {#if isLoading}
    <!-- Loading state -->
    <div class="flex flex-col items-center justify-center py-16 gap-4">
      <ArrowsClockwiseIcon size={48} class="animate-spin text-primary" />
      <p class="text-caption">Checking membership status...</p>
    </div>
  {:else}
    {#if $userPublickey && !hasMembership && !isAnonPreview && !extractionSuccess}
      <!-- Non-member upgrade nudge — inline banner rather than a blocking
           gate. URL import is free for all; this banner surfaces the
           image/text benefit without hiding the whole feature. -->
      <div class="flex items-start gap-3 p-4 rounded-xl" style="background-color: rgba(249, 115, 22, 0.08); border: 1px solid rgba(249, 115, 22, 0.25);">
        <SparkleIcon size={22} class="text-primary flex-shrink-0 mt-0.5" weight="fill" />
        <div class="flex-1">
          <p class="text-sm">
            <span class="font-semibold" style="color: var(--color-primary);">URL imports are on us.</span>
            Unlock image + text imports and more with
            <button type="button" class="underline" on:click={() => goto('/membership')}>Pro Kitchen</button>.
          </p>
        </div>
      </div>
    {/if}
    <!-- Has membership - show extraction UI -->
    
    {#if !extractionSuccess}
      <!-- Input Section -->
      <div class="flex flex-col gap-4">
        <Tabs {tabs} activeTab={inputMode} on:change={handleTabChange} />
        
        {#if inputMode === 'image'}
          <!-- Image Upload -->
          <div class="flex flex-col gap-4">
            {#if !uploadedImagePreview}
              <div
                class="relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 transition-all duration-200 cursor-pointer"
                class:border-primary={isDragging}
                style="border-color: {isDragging ? 'var(--color-primary)' : 'var(--color-input-border)'}; background-color: var(--color-input-bg)"
                on:drop={handleDrop}
                on:dragover={handleDragOver}
                on:dragleave={handleDragLeave}
                on:click={() => fileInput.click()}
                role="button"
                tabindex="0"
                on:keypress={(e) => e.key === 'Enter' && fileInput.click()}
              >
                <input
                  bind:this={fileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  class="hidden"
                  on:change={handleFileSelect}
                />
                
                <UploadIcon size={48} class="text-caption mb-4" />
                <div class="text-center">
                  <p class="font-semibold text-primary mb-1">Upload a recipe image</p>
                  <p class="text-caption text-sm">or drag and drop</p>
                  <p class="text-caption text-xs mt-2">JPG, PNG, WEBP, GIF (max 20MB)</p>
                </div>
              </div>
            {:else}
              <!-- Image Preview -->
              <div class="relative rounded-xl overflow-hidden">
                <img
                  src={uploadedImagePreview}
                  alt="Recipe to extract"
                  class="w-full max-h-[400px] object-contain bg-input"
                />
                <button
                  type="button"
                  class="absolute top-3 right-3 bg-black/60 hover:bg-red-500 text-white rounded-full p-2 transition-all cursor-pointer"
                  on:click={removeImage}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
            {/if}
          </div>
        {:else if inputMode === 'url'}
          <!-- URL Input -->
          <div class="flex flex-col gap-2">
            <div class="flex items-center gap-2">
              <LinkIcon size={20} class="text-caption" />
              <span class="text-sm text-caption">Recipe URL</span>
            </div>
            <input
              type="url"
              placeholder="https://example.com/recipe..."
              bind:value={urlInput}
              class="input"
            />
            {#if urlError}
              <p class="text-sm text-danger">{urlError}</p>
            {/if}
            <p class="text-xs text-caption">
              Paste a URL from any recipe website. The AI will extract the recipe details.
            </p>
          </div>
        {:else}
          <!-- Text Input -->
          <div class="flex flex-col gap-2">
            <label for="text-input" class="text-sm text-caption">Drop a recipe in here</label>
            <textarea
              id="text-input"
              bind:value={textInput}
              placeholder="Paste a URL, copy from a website, type it out, screenshot text — whatever you've got, Sous Chef will handle it."
              rows="10"
              class="input resize-none text-base"
              disabled={isExtracting}
            />
            <p class="text-xs text-caption">
              Paste any recipe text and Sous Chef will format it for zap.cooking.
            </p>
          </div>
        {/if}
        
        <!-- Error message -->
        {#if extractionError}
          <div class="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20">
            <WarningIcon size={20} class="text-red-500 flex-shrink-0 mt-0.5" />
            <p class="text-sm text-red-500">{extractionError}</p>
          </div>
        {/if}
        
        <!-- Extract Button -->
        {#if !$userPublickey}
          <p class="text-sm text-caption mb-2">Sign in to extract and save this recipe.</p>
        {/if}
        <Button 
          disabled={!canExtract || isExtracting}
          on:click={extractRecipe}
        >
          {#if isExtracting}
            <ArrowsClockwiseIcon size={18} class="animate-spin" />
            {extractionProgress}
          {:else if $userPublickey}
            🤖 Get Recipe
          {:else}
            Sign in to get recipe
          {/if}
        </Button>
      </div>
    {:else}
      <!-- Extraction Success - Show Editor -->
      <div class="flex flex-col gap-6">
        {#if isAnonPreview}
          <!-- Anon-preview banner (via landing hero handoff) -->
          <div class="flex items-start gap-3 p-4 rounded-xl" style="background-color: rgba(249, 115, 22, 0.08); border: 1px solid rgba(249, 115, 22, 0.25);">
            <SparkleIcon size={24} class="text-primary flex-shrink-0 mt-0.5" weight="fill" />
            <div class="flex-1">
              <p class="font-semibold" style="color: var(--color-primary);">Recipe imported — sign in to save or publish</p>
              <p class="text-sm text-caption mt-1">
                {#if anonPreviewSourceUrl}
                  Parsed from <span class="font-mono text-xs break-all">{anonPreviewSourceUrl}</span>.
                {/if}
                You can review the details below. Signing in unlocks editing, draft saving, and publishing to your feed.
              </p>
            </div>
          </div>
        {:else}
          <!-- Success Banner -->
          <div class="flex items-center gap-3 p-4 rounded-xl bg-green-500/10 border border-green-500/20">
            <CheckCircleIcon size={24} class="text-green-500" weight="fill" />
            <div class="flex-1">
              <p class="font-semibold text-green-600 dark:text-green-400">Recipe Extracted Successfully!</p>
              <p class="text-sm text-caption">
                Review and edit the details below, then choose an action.
                {#if $images.length > 0}
                  <span class="inline-flex items-center gap-1 ml-1">
                    <ImageIcon size={14} class="text-green-500" />
                    <span class="text-green-600 dark:text-green-400">Image ready!</span>
                  </span>
                {/if}
              </p>
            </div>
          </div>
        {/if}
        
        <!-- Recipe Form -->
        <div class="flex flex-col gap-6">
          <!-- Title -->
          <div class="flex flex-col gap-2">
            <h3>Title*</h3>
            <input placeholder="Recipe title" bind:value={title} class="input" disabled={isAnonPreview} />
          </div>
          
          <!-- Tags -->
          <div class="flex flex-col gap-2">
            <h3>Tags</h3>
            <span class="text-caption text-sm">Edit or add tags that describe your recipe</span>
            <TagsComboBox {selectedTags} />
          </div>
          
          <!-- Summary -->
          <div class="flex flex-col gap-2">
            <h3>Brief Summary</h3>
            <textarea
              placeholder="Brief description of the dish"
              bind:value={summary}
              rows="3"
              class="input"
              disabled={isAnonPreview}
            />
          </div>
          
          <!-- Chef's Notes -->
          <div class="flex flex-col gap-2">
            <h3>Chef's Notes</h3>
            <MarkdownEditor
              bind:value={chefsnotes}
              placeholder="Notes about this recipe"
              rows={4}
            />
          </div>
          
          <!-- Details -->
          <div class="flex flex-col gap-4">
            <h3>Details</h3>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div class="flex flex-col gap-2">
                <span class="text-sm font-medium">Prep Time</span>
                <input placeholder="20 min" bind:value={preptime} class="input" disabled={isAnonPreview} />
              </div>
              <div class="flex flex-col gap-2">
                <span class="text-sm font-medium">Cook Time</span>
                <input placeholder="1 hour" bind:value={cooktime} class="input" disabled={isAnonPreview} />
              </div>
              <div class="flex flex-col gap-2">
                <span class="text-sm font-medium">Servings</span>
                <input placeholder="4" bind:value={servings} class="input" disabled={isAnonPreview} />
              </div>
            </div>
          </div>
          
          <!-- Ingredients -->
          <div class="flex flex-col gap-2">
            <h3>Ingredients*</h3>
            <StringComboBox placeholder="Add ingredient..." selected={ingredientsArray} showIndex={false} />
          </div>
          
          <!-- Directions -->
          <div class="flex flex-col gap-2">
            <h3>Directions*</h3>
            <StringComboBox placeholder="Add step..." selected={directionsArray} showIndex={false} />
          </div>
          
          <!-- Photos -->
          <div class="flex flex-col gap-2">
            <h3>Photos & Videos{#if $images.length > 0}<span class="text-green-500 ml-2 text-sm font-normal">({$images.length} added)</span>{/if}</h3>
            <span class="text-caption text-sm">
              {#if $images.length > 0}
                Image extracted and uploaded! Add more or rearrange below.
              {:else}
                Add images before publishing. First image will be your cover.
              {/if}
            </span>
            <MediaUploader uploadedImages={images} />
          </div>
        </div>
        
        <!-- Action Buttons -->
        <div class="flex flex-col gap-5 pt-6">
          {#if publishError}
            <div class="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20">
              <WarningIcon size={20} class="text-red-500 flex-shrink-0 mt-0.5" />
              <p class="text-sm text-red-500">{publishError}</p>
            </div>
          {/if}

          {#if isAnonPreview}
            <!-- Sign-in CTA replaces publish/save-draft for anon preview.
                 redirect=/souschef keeps the handoff-populated form in
                 place (sessionStorage was already cleared on mount, but
                 the in-memory fields persist across login). -->
            <button
              type="button"
              on:click={() => goto('/login?redirect=/souschef')}
              class="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-full font-semibold transition-all"
              style="background: linear-gradient(135deg, #f97316 0%, #fb923c 100%); color: white; box-shadow: 0 2px 8px rgba(249, 115, 22, 0.3);"
            >
              <SparkleIcon size={18} weight="fill" />
              Sign in to publish
            </button>
            <p class="text-xs text-caption text-center">
              No account? You can create one in a few seconds — no email required.
            </p>
          {:else}
          <!-- Primary: Publish Recipe -->
          <button
            type="button"
            on:click={publishRecipe}
            disabled={isPublishing || !title || $images.length === 0 || $selectedTags.length === 0 || $ingredientsArray.length === 0 || $directionsArray.length === 0}
            class="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-full font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style="background: linear-gradient(135deg, #f97316 0%, #fb923c 100%); color: white; box-shadow: 0 2px 8px rgba(249, 115, 22, 0.3);"
            class:hover:shadow-lg={!isPublishing && title && $images.length > 0 && $selectedTags.length > 0 && $ingredientsArray.length > 0 && $directionsArray.length > 0}
          >
            {#if isPublishing}
              <ArrowsClockwiseIcon size={18} class="animate-spin" />
              Publishing...
            {:else}
              <PencilIcon size={18} weight="bold" />
              Publish Recipe
            {/if}
          </button>
          
          <!-- Secondary: Save Draft -->
          <button
            type="button"
            on:click={saveDraftOnly}
            disabled={!title || $ingredientsArray.length === 0 || $directionsArray.length === 0}
            class="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-full font-semibold transition-all border-2 disabled:opacity-50 disabled:cursor-not-allowed"
            style="border-color: var(--color-input-border); color: var(--color-text-primary); background-color: transparent;"
            class:hover:bg-input={title && $ingredientsArray.length > 0 && $directionsArray.length > 0}
          >
            <FloppyDiskIcon size={18} />
            Save Draft
          </button>
          
          <!-- Tertiary: Cancel -->
          <button
            type="button"
            on:click={handleCancel}
            class="w-full flex items-center justify-center gap-1.5 py-2 text-sm font-medium transition-colors hover:opacity-70"
            style="color: var(--color-text-secondary);"
          >
            Cancel
          </button>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</div>
