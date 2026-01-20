<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { writable, type Writable } from 'svelte/store';
  import { ndk, userPublickey } from '$lib/nostr';
  import { NDKEvent } from '@nostr-dev-kit/ndk';
  import { Fetch } from 'hurdak';
  import { membershipStore, type MembershipTier } from '$lib/membershipStore';
  import { saveDraft } from '$lib/draftStore';
  import { recipeTags, type recipeTagSimple } from '$lib/consts';
  import { nip19 } from 'nostr-tools';
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

  // State management
  let isLoading = true;
  let hasMembership = true; // Membership check disabled for testing
  let membershipTier: MembershipTier = 'pro';
  let errorMessage = '';
  
  // Input mode
  type InputMode = 'image' | 'url';
  let inputMode: InputMode = 'image';
  const tabs = [
    { id: 'image', label: 'Upload Image' },
    { id: 'url', label: 'Paste URL' }
  ];
  
  // Image upload state
  let fileInput: HTMLInputElement;
  let isDragging = false;
  let uploadedImageData: string | null = null;
  let uploadedImagePreview: string | null = null;
  
  // URL input state
  let urlInput = '';
  let urlError = '';
  
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
  
  // Check membership on mount
  onMount(async () => {
    if (!$userPublickey) {
      goto('/login?redirect=/extract');
      return;
    }
    
    // Membership check disabled for testing - re-enable when ready
    isLoading = false;
  });
  
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
    : (!!urlInput && !urlError);
  
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
  
  // Extract recipe
  async function extractRecipe() {
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
  
  // Save as draft and open in editor to publish
  function saveDraftAndPublish() {
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
    
    const draftId = saveDraft(draftData);
    
    // Navigate directly to create page with draft ID
    goto(`/create?draft=${draftId}`);
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
      Turn photos or links into ready-to-post recipes.
    </p>
    <p class="text-caption">
      A little extra help in the kitchen.
    </p>
    <p class="text-caption text-sm">Pro Kitchen feature.</p>
  </div>
  
  {#if isLoading}
    <!-- Loading state -->
    <div class="flex flex-col items-center justify-center py-16 gap-4">
      <ArrowsClockwiseIcon size={48} class="animate-spin text-primary" />
      <p class="text-caption">Checking membership status...</p>
    </div>
  {:else if !hasMembership}
    <!-- No membership -->
    <div class="flex flex-col items-center justify-center py-16 gap-6">
      <div class="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
        <SparkleIcon size={40} class="text-primary" weight="fill" />
      </div>
      <div class="text-center max-w-md">
        <h2 class="mb-2">Pro Kitchen Feature</h2>
        <p class="text-caption mb-6">
          Sous Chef is available exclusively for Pro Kitchen members. 
          Upgrade your membership to unlock your AI recipe assistant.
        </p>
        <Button on:click={() => goto('/membership')}>
          View Membership Options
        </Button>
      </div>
    </div>
  {:else}
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
        {:else}
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
        {/if}
        
        <!-- Error message -->
        {#if extractionError}
          <div class="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20">
            <WarningIcon size={20} class="text-red-500 flex-shrink-0 mt-0.5" />
            <p class="text-sm text-red-500">{extractionError}</p>
          </div>
        {/if}
        
        <!-- Extract Button -->
        <Button 
          disabled={!canExtract || isExtracting}
          on:click={extractRecipe}
        >
          {#if isExtracting}
            <ArrowsClockwiseIcon size={18} class="animate-spin" />
            {extractionProgress}
          {:else}
            🤖 Get Recipe
          {/if}
        </Button>
      </div>
    {:else}
      <!-- Extraction Success - Show Editor -->
      <div class="flex flex-col gap-6">
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
        
        <!-- Recipe Form -->
        <div class="flex flex-col gap-6">
          <!-- Title -->
          <div class="flex flex-col gap-2">
            <h3>Title*</h3>
            <input placeholder="Recipe title" bind:value={title} class="input" />
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
                <input placeholder="20 min" bind:value={preptime} class="input" />
              </div>
              <div class="flex flex-col gap-2">
                <span class="text-sm font-medium">Cook Time</span>
                <input placeholder="1 hour" bind:value={cooktime} class="input" />
              </div>
              <div class="flex flex-col gap-2">
                <span class="text-sm font-medium">Servings</span>
                <input placeholder="4" bind:value={servings} class="input" />
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
          <!-- Primary: Publish Recipe -->
          <button
            type="button"
            on:click={saveDraftAndPublish}
            disabled={!title || $ingredientsArray.length === 0 || $directionsArray.length === 0}
            class="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-full font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style="background: linear-gradient(135deg, #f97316 0%, #fb923c 100%); color: white; box-shadow: 0 2px 8px rgba(249, 115, 22, 0.3);"
            class:hover:shadow-lg={title && $ingredientsArray.length > 0 && $directionsArray.length > 0}
          >
            <PencilIcon size={18} weight="bold" />
            Publish Recipe
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
        </div>
      </div>
    {/if}
  {/if}
</div>
