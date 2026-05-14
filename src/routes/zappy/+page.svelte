<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { userPublickey } from '$lib/nostr';
  import { membershipStatusMap, queueMembershipLookup, type MembershipStatus } from '$lib/stores/membershipStatus';
  import { activeWallet, getWalletKindName } from '$lib/wallet';
  import { sendPayment } from '$lib/wallet/walletManager';
  import { lightningService } from '$lib/lightningService';
  import Button from '../../components/Button.svelte';
  import Modal from '../../components/Modal.svelte';
  import Skeleton from '../../components/Skeleton.svelte';
  import { parseMarkdown, parseMarkdownForEditing } from '$lib/parser';
  import { saveDraft } from '$lib/draftStore';
  import ShareIcon from 'phosphor-svelte/lib/Share';
  import FloppyDiskIcon from 'phosphor-svelte/lib/FloppyDisk';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import RobotIcon from 'phosphor-svelte/lib/Robot';
  import LeafIcon from 'phosphor-svelte/lib/Leaf';
  import CookingPotIcon from 'phosphor-svelte/lib/CookingPot';
  import CopyIcon from 'phosphor-svelte/lib/Copy';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwise';
  import WarningIcon from 'phosphor-svelte/lib/Warning';
  import HeartIcon from 'phosphor-svelte/lib/Heart';
  import Checkmark from 'phosphor-svelte/lib/CheckFat';
  import CameraIcon from 'phosphor-svelte/lib/Camera';
  import ShuffleIcon from 'phosphor-svelte/lib/Shuffle';
  import XIcon from 'phosphor-svelte/lib/X';
  import PlusIcon from 'phosphor-svelte/lib/Plus';

  // Zappy's lightning address
  const ZAPPY_LIGHTNING_ADDRESS = 'ZapCooking@getalby.com';

  // Membership gate
  let membershipMap: Record<string, MembershipStatus> = {};
  const unsubMembership = membershipStatusMap.subscribe((v) => { membershipMap = v; });
  $: if ($userPublickey) queueMembershipLookup($userPublickey);
  $: normalizedPk = String($userPublickey || '').trim().toLowerCase();
  $: hasMembership = Boolean(membershipMap[normalizedPk]?.active);

  // State management
  let isLoading = true;
  
  // Form state
  let promptInput = '';
  let promptEl: HTMLTextAreaElement;

  // Auto-grow the prompt textarea between min (~2 rows) and max
  // (~6 rows). CSS sets the bounds via min-height / max-height +
  // overflow-y:auto; this keeps the rendered height in sync with
  // content. Wrapped in tick() so we read scrollHeight *after* the
  // new value is in the DOM (covers chip taps, scan auto-fill,
  // ingredient add/remove — all of which assign promptInput
  // programmatically).
  async function autoSizePrompt() {
    await tick();
    if (!promptEl) return;
    promptEl.style.height = 'auto';
    promptEl.style.height = `${promptEl.scrollHeight}px`;
  }

  // Run autoSize whenever the prompt value changes from any path —
  // user typing (via bind:value), chip apply, scan auto-fill, etc.
  $: if (browser) {
    promptInput;
    autoSizePrompt();
  }

  // One-tap prompt seeds. Tapping a chip fires a generation
  // immediately using the chip's label as the prompt — the textarea
  // is left alone so chips and the custom input stay separate
  // affordances (one-tap presets vs. write-your-own).
  //
  // The three Nourish-tagged chips carry a green leaf glyph so users
  // can see at a glance which prompts align with the Nourish
  // nutrition surface. They share the same fireChip behavior and
  // POST to /api/zappy like every other chip; the leaf is a visual
  // tag only. Order is intentionally interspersed (not grouped) so
  // the row reads as a mixed bag of presets rather than a taxonomy.
  type Chip = { label: string; nourish?: boolean };
  const suggestionChips: Chip[] = [
    { label: 'Cozy vegetarian' },
    { label: 'High protein', nourish: true },
    { label: '30-min dinner' },
    { label: 'Mediterranean dinner' },
    { label: 'Gut health', nourish: true },
    { label: 'One-pot meal' },
    { label: 'Sheet pan dinner' },
    { label: 'Real food', nourish: true },
    { label: 'Hearty salad' },
    { label: 'Kid-friendly' },
    { label: 'Pantry only' }
  ];

  // Tracks which chip (if any) is currently driving the generation.
  // Used to show a per-chip spinner while leaving the rest dimmed.
  let tappedChip: string | null = null;

  async function fireChip(text: string) {
    if (status === 'generating') return;
    tappedChip = text;
    try {
      await generateRecipe('prompt', text);
    } finally {
      // Reset on both success and error so the chip returns to idle
      // even when generateRecipe surfaces an error via errorMessage.
      tappedChip = null;
    }
  }
  
  // Rotating placeholder examples
  const placeholderExamples = [
    "Quick dinner with chicken",
    "I have eggs, spinach, and rice",
    "Something cozy and vegetarian",
    "Simple weeknight pasta",
    "Easy lunch under 20 minutes",
    "Comfort food for a rainy day"
  ];
  let currentPlaceholderIndex = 0;
  let placeholderInterval: ReturnType<typeof setInterval>;
  
  $: currentPlaceholder = placeholderExamples[currentPlaceholderIndex];
  
  // Generation state
  type Status = 'idle' | 'generating' | 'error';
  let status: Status = 'idle';
  let errorMessage = '';
  let output = '';
  // The prompt that the in-flight (or most recent) generation was
  // started from — echoed back during the loading state so the user
  // can see what's cooking. For chips it's the chip label; for Cook
  // It it's the textarea content; for Surprise Me it's "Surprise me".
  let currentPrompt = '';
  
  // Copy state
  let copied = false;
  let copyTimeout: ReturnType<typeof setTimeout>;
  
  // Scan Fridge state
  let fileInput: HTMLInputElement;
  let isScanning = false;
  let scanError = '';
  let detectedIngredients: string[] = [];
  let newIngredient = '';
  let showIngredientInput = false;
  
  // Zap Zappy state
  let zapModalOpen = false;
  let zapAmount = 21;
  let zapMessage = '';
  type ZapStatus = 'idle' | 'paying' | 'success' | 'error';
  let zapStatus: ZapStatus = 'idle';
  let zapError = '';
  let showZapSuccess = false;
  let zapSuccessTimeout: ReturnType<typeof setTimeout>;
  
  const zapAmounts = [
    { amount: 21, emoji: '🤖', label: '21' },
    { amount: 100, emoji: '⚡', label: '100' },
    { amount: 500, emoji: '🍳', label: '500' },
    { amount: 1000, emoji: '👨‍🍳', label: '1K' },
    { amount: 2100, emoji: '🔥', label: '2.1K' },
    { amount: 10000, emoji: '🚀', label: '10K' },
  ];
  
  // Check if user has an in-app wallet
  $: hasInAppWallet = $activeWallet && ($activeWallet.kind === 3 || $activeWallet.kind === 4);
  
  // Check membership on mount
  onMount(() => {
    if (!$userPublickey) {
      goto('/login?redirect=/zappy');
      return;
    }

    isLoading = false;
    
    // Start rotating placeholder examples
    placeholderInterval = setInterval(() => {
      currentPlaceholderIndex = (currentPlaceholderIndex + 1) % placeholderExamples.length;
    }, 4000);
  });
  
  onDestroy(() => {
    unsubMembership();
    if (placeholderInterval) clearInterval(placeholderInterval);
    if (copyTimeout) clearTimeout(copyTimeout);
    if (zapSuccessTimeout) clearTimeout(zapSuccessTimeout);
  });
  
  // Generate recipe from prompt. `promptOverride` lets one-tap chips
  // supply their label as the prompt without writing into the
  // textarea — keeps presets and custom input as separate paths.
  async function generateRecipe(
    mode: 'prompt' | 'hungry' = 'prompt',
    promptOverride?: string
  ) {
    if (status === 'generating') return;
    const effectivePrompt = (promptOverride ?? promptInput).trim();
    if (mode === 'prompt' && !effectivePrompt) return;

    currentPrompt = mode === 'hungry' ? 'Surprise me' : effectivePrompt;
    status = 'generating';
    errorMessage = '';
    output = '';

    try {
      const response = await fetch('/api/zappy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: effectivePrompt,
          mode,
          pubkey: $userPublickey
        })
      });
      
      const data = await response.json();
      
      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Failed to generate recipe');
      }
      
      output = data.output;
      status = 'idle';
      
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Failed to generate recipe';
      status = 'error';
    }
  }
  
  // ── Recipe-card actions ──────────────────────────────────────
  // Pull the recipe title out of the first `# Heading` line in the
  // generated markdown. Falls back to a generic label if the model
  // skipped the heading.
  function extractRecipeTitle(md: string): string {
    const match = md.match(/^#\s+(.+?)\s*$/m);
    return match ? match[1].trim() : 'Recipe from Chef ₿';
  }

  let isSaving = false;

  // Save → /create pre-filled. Reuses the same `saveDraft` →
  // `goto('/create?draft=...')` pattern that Recipe.svelte's edit
  // flow uses, so AI-generated recipes go through the existing
  // human-review-then-publish path rather than getting auto-pushed
  // to the relay.
  async function saveAsRecipeDraft() {
    if (!output || isSaving) return;
    isSaving = true;
    try {
      const title = extractRecipeTitle(output);
      const parsed = parseMarkdownForEditing(output);
      const { draftId } = saveDraft(
        {
          title,
          images: [],
          tags: [],
          summary: '',
          chefsnotes: parsed.chefNotes || '',
          preptime: parsed.information?.prepTime || '',
          cooktime: parsed.information?.cookTime || '',
          servings: parsed.information?.servings || '',
          ingredients: parsed.ingredients || [],
          directions: parsed.directions || [],
          additionalMarkdown: parsed.additionalMarkdown || ''
        },
        undefined,
        false
      );
      goto(`/create?draft=${draftId}`);
    } catch (e) {
      console.error('[Chef ₿] Save-as-draft failed:', e);
      errorMessage = e instanceof Error ? e.message : 'Failed to save draft';
      status = 'error';
    } finally {
      isSaving = false;
    }
  }

  // Share — Web Share API when present (mobile + some desktops),
  // otherwise fall back to copying the markdown to the clipboard.
  async function shareRecipe() {
    if (!output || !browser) return;
    const title = extractRecipeTitle(output);
    if (navigator.share) {
      try {
        await navigator.share({ title, text: output });
        return;
      } catch (e) {
        // User canceled the share sheet — that's a no-op, not an
        // error. Anything else falls through to clipboard.
        if ((e as DOMException)?.name === 'AbortError') return;
      }
    }
    await copyToClipboard();
  }

  // Copy output to clipboard
  async function copyToClipboard() {
    if (!output || !browser) return;
    
    try {
      await navigator.clipboard.writeText(output);
      copied = true;
      
      // Clear any existing timeout
      if (copyTimeout) clearTimeout(copyTimeout);
      
      // Reset copied state after 2 seconds
      copyTimeout = setTimeout(() => {
        copied = false;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }
  
  // Zap Zappy functions
  function openZapModal() {
    zapModalOpen = true;
    zapStatus = 'idle';
    zapError = '';
  }
  
  async function zapZappy() {
    if (zapStatus === 'paying') return;
    
    zapStatus = 'paying';
    zapError = '';
    
    try {
      if (hasInAppWallet) {
        // Use in-app wallet directly
        const result = await sendPayment(ZAPPY_LIGHTNING_ADDRESS, {
          amount: zapAmount,
          description: zapMessage || `Zap to Chef ₿ from ${$userPublickey?.substring(0, 8)}...`,
          comment: zapMessage
        });
        
        if (!result.success) {
          throw new Error(result.error || 'Payment failed');
        }
        
        zapStatus = 'success';
        triggerZapSuccess();
      } else {
        // External wallet - fetch invoice from lightning address and use Bitcoin Connect
        const invoice = await fetchLightningAddressInvoice(ZAPPY_LIGHTNING_ADDRESS, zapAmount * 1000, zapMessage);
        
        zapModalOpen = false;
        
        await lightningService.launchPayment({
          invoice,
          onPaid: () => {
            zapStatus = 'success';
            triggerZapSuccess();
          },
          onCancelled: () => {
            zapStatus = 'idle';
            zapModalOpen = true;
          }
        });
      }
    } catch (err) {
      console.error('Zap failed:', err);
      zapError = err instanceof Error ? err.message : 'Payment failed';
      zapStatus = 'error';
    }
  }
  
  // Fetch invoice from lightning address
  async function fetchLightningAddressInvoice(address: string, amountMsats: number, comment?: string): Promise<string> {
    const [username, domain] = address.split('@');
    const lnurlEndpoint = `https://${domain}/.well-known/lnurlp/${username}`;
    
    // Fetch LNURL pay request
    const lnurlResponse = await fetch(lnurlEndpoint);
    if (!lnurlResponse.ok) throw new Error('Failed to resolve lightning address');
    const lnurlData = await lnurlResponse.json();
    
    if (lnurlData.status === 'ERROR') throw new Error(lnurlData.reason || 'Lightning address error');
    
    // Build callback URL with amount
    const callbackUrl = new URL(lnurlData.callback);
    callbackUrl.searchParams.set('amount', amountMsats.toString());
    if (comment && lnurlData.commentAllowed) {
      callbackUrl.searchParams.set('comment', comment.substring(0, lnurlData.commentAllowed));
    }
    
    // Fetch invoice
    const invoiceResponse = await fetch(callbackUrl.toString());
    if (!invoiceResponse.ok) throw new Error('Failed to get invoice');
    const invoiceData = await invoiceResponse.json();
    
    if (invoiceData.status === 'ERROR') throw new Error(invoiceData.reason || 'Failed to get invoice');
    if (!invoiceData.pr) throw new Error('No invoice returned');
    
    return invoiceData.pr;
  }
  
  // Show success animation
  function triggerZapSuccess() {
    showZapSuccess = true;
    
    if (zapSuccessTimeout) clearTimeout(zapSuccessTimeout);
    
    zapSuccessTimeout = setTimeout(() => {
      showZapSuccess = false;
      zapModalOpen = false;
      zapStatus = 'idle';
    }, 3000);
  }
  
  // Reset zap modal when closed
  $: if (!zapModalOpen && zapStatus !== 'success') {
    zapStatus = 'idle';
    zapError = '';
  }
  
  // Check if we can generate
  $: canGenerate = (promptInput.trim().length > 0 || detectedIngredients.length > 0) && status !== 'generating';
  
  // Scan Fridge functions
  function triggerScan() {
    fileInput?.click();
  }
  
  async function handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
      scanError = 'Please select an image file';
      return;
    }
    
    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      scanError = 'Image too large. Please select an image under 10MB.';
      return;
    }
    
    isScanning = true;
    scanError = '';
    
    try {
      // Convert to base64
      const base64 = await fileToBase64(file);
      
      // Call scan API
      const response = await fetch('/api/zappy/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: base64,
          pubkey: $userPublickey
        })
      });
      
      const data = await response.json();
      
      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Failed to analyze image');
      }
      
      // Set detected ingredients
      detectedIngredients = data.ingredients || [];
      
      // Auto-populate prompt
      if (detectedIngredients.length > 0) {
        promptInput = `I have: ${detectedIngredients.join(', ')}`;
      }
      
    } catch (err) {
      scanError = err instanceof Error ? err.message : 'Failed to scan image';
    } finally {
      isScanning = false;
      // Reset file input
      if (input) input.value = '';
    }
  }
  
  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data URL prefix to get just the base64 content
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  
  function removeIngredient(ingredient: string) {
    detectedIngredients = detectedIngredients.filter(i => i !== ingredient);
    // Update prompt
    if (detectedIngredients.length > 0) {
      promptInput = `I have: ${detectedIngredients.join(', ')}`;
    } else {
      promptInput = '';
    }
  }
  
  function addIngredient() {
    const trimmed = newIngredient.trim();
    if (trimmed && !detectedIngredients.includes(trimmed)) {
      detectedIngredients = [...detectedIngredients, trimmed];
      promptInput = `I have: ${detectedIngredients.join(', ')}`;
    }
    newIngredient = '';
    showIngredientInput = false;
  }
  
  function clearIngredients() {
    detectedIngredients = [];
    promptInput = '';
  }
</script>

<svelte:head>
  <title>Chef ₿ - zap.cooking</title>
</svelte:head>

<div class="flex flex-col max-w-[760px] mx-auto gap-6 pb-8">
  <!-- Header -->
  <div class="flex items-center gap-3 flex-wrap">
    <RobotIcon size={32} class="text-primary" weight="fill" />
    <h1>Chef ₿</h1>
    <!-- Pro Kitchen badge — replaces the standalone
         "Pro Kitchen feature." line that used to sit below the
         H1. Folded in here since it's the same copy-consolidation
         pass (Phase 5 work, cheap to do now). -->
    <span
      class="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide border bg-primary/10 text-primary border-primary/30"
    >
      PRO KITCHEN
    </span>
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
        <RobotIcon size={40} class="text-primary" weight="fill" />
      </div>
      <div class="text-center max-w-md">
        <h2 class="mb-2">Pro Kitchen Feature</h2>
        <p class="text-caption mb-6">
          Chef ₿ is available exclusively for Pro Kitchen members.
          Upgrade your membership to unlock your AI recipe generator.
        </p>
        <Button on:click={() => goto('/membership')}>
          View Membership Options
        </Button>
      </div>
    </div>
  {:else}
    <!-- Has membership - show Chef ₿ UI -->
    <div class="flex flex-col gap-6">
      <!-- Input Section -->
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-2">
          <label for="prompt" class="text-sm font-medium">What are you in the mood for?</label>
          <div class="relative">
            <textarea
              id="prompt"
              bind:this={promptEl}
              bind:value={promptInput}
              placeholder={currentPlaceholder}
              rows="2"
              class="input auto-grow resize-none text-base w-full pb-12"
              disabled={status === 'generating'}
            ></textarea>
            <!-- Scan Fridge — small labeled pill docked in the textarea's
                 bottom-right corner (Slack/ChatGPT/iMessage convention).
                 Always-visible "Scan" text makes it self-describing on
                 mobile where hover tooltips don't fire. Triggers the
                 same hidden file input as before; spinner + "Scanning"
                 replace the icon + text while scanning. -->
            <button
              type="button"
              class="scan-pill"
              on:click={triggerScan}
              disabled={isScanning || status === 'generating'}
              title="Scan fridge"
              aria-label="Scan fridge"
            >
              {#if isScanning}
                <ArrowsClockwiseIcon size={14} class="animate-spin" />
                <span>Scanning</span>
              {:else}
                <CameraIcon size={14} weight="fill" />
                <span>Scan</span>
              {/if}
            </button>
          </div>

          <!-- Suggestion chips — one-tap presets. The chip's label IS
               the prompt; tapping fires a generation immediately
               (textarea is left alone). Nourish-tagged chips carry
               a small green leaf next to the label; they're
               interspersed (not grouped) so the row reads as a
               mixed bag rather than a taxonomy. Built as a local
               pattern; not extracted to a shared Chip component
               yet. -->
          <div class="flex flex-wrap gap-2" aria-label="Prompt suggestions">
            {#each suggestionChips as chip}
              {@const isFiring = tappedChip === chip.label}
              <button
                type="button"
                class="suggestion-chip"
                class:is-loading={isFiring}
                on:click={() => fireChip(chip.label)}
                disabled={status === 'generating'}
                aria-busy={isFiring}
              >
                {#if isFiring}
                  <ArrowsClockwiseIcon size={12} class="animate-spin" />
                {:else if chip.nourish}
                  <LeafIcon size={12} weight="fill" class="text-green-500" />
                {/if}
                {chip.label}
              </button>
            {/each}
          </div>
        </div>

        <!-- Hidden file input for camera/upload -->
        <input
          bind:this={fileInput}
          type="file"
          accept="image/*"
          capture="environment"
          class="hidden"
          on:change={handleFileSelect}
        />

        <!-- Two-button action row — clear orange hierarchy:
             Cook It = solid primary (~60% width on desktop, top on
             mobile); Surprise Me = outline secondary (~40% width on
             desktop, bottom on mobile). -->
        <div class="flex flex-col-reverse sm:flex-row gap-3">
          <Button
            variant="outline"
            class="w-full sm:flex-[2] py-3"
            disabled={status === 'generating'}
            on:click={() => generateRecipe('hungry')}
          >
            {#if status === 'generating' && !promptInput.trim()}
              <ArrowsClockwiseIcon size={18} class="animate-spin" />
            {:else}
              <ShuffleIcon size={18} weight="fill" />
            {/if}
            Surprise Me
          </Button>
          <Button
            variant="primary"
            class="w-full sm:flex-[3] py-3"
            disabled={!canGenerate}
            on:click={() => generateRecipe('prompt')}
          >
            {#if status === 'generating' && promptInput.trim()}
              <ArrowsClockwiseIcon size={18} class="animate-spin" />
              Cooking...
            {:else}
              <RobotIcon size={18} weight="fill" />
              Cook It
            {/if}
          </Button>
        </div>

        <!-- Disabled-state helper: surfaces when Cook It is blocked
             because the textarea is empty (canGenerate is false &
             nothing is generating). Surprise Me always works, so we
             point users at it. -->
        {#if !canGenerate && status !== 'generating'}
          <p class="text-xs text-caption text-center -mt-1">
            Type an idea or try Surprise Me.
          </p>
        {/if}
        
        <!-- Scan error message -->
        {#if scanError}
          <div class="flex items-start gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
            <WarningIcon size={18} class="text-red-500 flex-shrink-0 mt-0.5" />
            <p class="text-sm text-red-500">{scanError}</p>
          </div>
        {/if}
        
        <!-- Detected Ingredients Chips -->
        {#if detectedIngredients.length > 0}
          <div class="flex flex-col gap-3 p-4 rounded-xl bg-teal-500/10 border border-teal-500/20">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium" style="color: var(--color-text-primary)">
                🥬 Detected Ingredients ({detectedIngredients.length})
              </span>
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="text-xs text-teal-600 hover:text-teal-700 font-medium"
                  on:click={triggerScan}
                >
                  🔄 Scan Again
                </button>
                <button
                  type="button"
                  class="text-xs text-caption hover:text-red-500"
                  on:click={clearIngredients}
                >
                  Clear All
                </button>
              </div>
            </div>
            
            <div class="flex flex-wrap gap-2">
              {#each detectedIngredients as ingredient}
                <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-white/80 dark:bg-gray-800/80 border border-teal-300 dark:border-teal-700" style="color: var(--color-text-primary)">
                  {ingredient}
                  <button
                    type="button"
                    class="text-gray-400 hover:text-red-500 transition-colors"
                    on:click={() => removeIngredient(ingredient)}
                  >
                    <XIcon size={14} weight="bold" />
                  </button>
                </span>
              {/each}
              
              <!-- Add ingredient button/input -->
              {#if showIngredientInput}
                <form 
                  class="inline-flex items-center gap-1"
                  on:submit|preventDefault={addIngredient}
                >
                  <input
                    type="text"
                    bind:value={newIngredient}
                    placeholder="Add item..."
                    class="w-24 px-2 py-1 text-sm rounded-full border border-teal-300 dark:border-teal-700 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-500"
                    autofocus
                    on:blur={() => {
                      if (!newIngredient.trim()) showIngredientInput = false;
                    }}
                    on:keydown={(e) => {
                      if (e.key === 'Escape') {
                        showIngredientInput = false;
                        newIngredient = '';
                      }
                    }}
                  />
                  <button type="submit" class="text-teal-600 hover:text-teal-700">
                    <CheckIcon size={16} weight="bold" />
                  </button>
                </form>
              {:else}
                <button
                  type="button"
                  class="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium border border-dashed border-teal-400 text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors"
                  on:click={() => showIngredientInput = true}
                >
                  <PlusIcon size={14} weight="bold" />
                  Add
                </button>
              {/if}
            </div>
            
            <p class="text-xs text-caption">
              Edit ingredients above, then tap "🤖 Cook It" to generate a recipe
            </p>
          </div>
        {/if}
      </div>
      
      <!-- Error banner (separate from the card so the user can
           retry without the previous-recipe context disappearing) -->
      {#if status === 'error'}
        <div class="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20">
          <WarningIcon size={20} class="text-red-500 flex-shrink-0 mt-0.5" />
          <p class="text-sm text-red-500">{errorMessage}</p>
        </div>
      {/if}

      <!-- Output card. Hidden entirely when idle (no empty dead
           zone). Shows the Chef ₿ avatar + a "Cooking up: ..."
           echo + Skeleton shimmer during generation, then swaps
           in the parsed-markdown recipe card with action buttons
           when the response lands. -->
      {#if status === 'generating' || output}
        <article class="recipe-card">
          <header class="recipe-card-header">
            <span class="chef-avatar">
              <RobotIcon size={20} weight="fill" />
            </span>
            <div class="flex flex-col leading-tight min-w-0">
              <span class="text-xs font-semibold text-primary">Chef ₿</span>
              {#if status === 'generating'}
                <span class="text-xs text-caption truncate">Cooking up: {currentPrompt}</span>
              {:else}
                <span class="text-xs text-caption">cooked this up for you ⚡</span>
              {/if}
            </div>
          </header>

          {#if status === 'generating'}
            <!-- "Thinking" shimmer — a few skeleton lines that loosely
                 mimic recipe structure (title, summary, ingredients). -->
            <div class="flex flex-col gap-3 px-5 py-4">
              <Skeleton width="70%" height="1.5rem" borderRadius="0.5rem" />
              <Skeleton width="90%" height="0.875rem" />
              <Skeleton width="80%" height="0.875rem" />
              <div class="h-2"></div>
              <Skeleton width="40%" height="1rem" borderRadius="0.375rem" />
              <Skeleton width="60%" height="0.75rem" />
              <Skeleton width="55%" height="0.75rem" />
              <Skeleton width="65%" height="0.75rem" />
            </div>
          {:else if output}
            <!-- Rendered markdown via the same parser the recipe
                 pages use — no more raw `## Servings` leaking. -->
            <div class="recipe-card-body prose dark:prose-invert max-w-none">
              {@html parseMarkdown(output)}
            </div>

            <!-- Action bar: Save / Zap / Share. Save routes to
                 /create pre-filled via the existing draft pipeline
                 so AI recipes still get human review before
                 publishing. Share uses Web Share API where
                 available and falls back to copy. -->
            <footer class="recipe-card-actions">
              <Button
                variant="primary"
                class="flex-1 py-2 text-sm"
                disabled={isSaving}
                on:click={saveAsRecipeDraft}
              >
                <FloppyDiskIcon size={16} weight="bold" />
                {isSaving ? 'Saving…' : 'Save'}
              </Button>
              <Button
                variant="outline"
                class="flex-1 py-2 text-sm"
                on:click={openZapModal}
              >
                <LightningIcon size={16} weight="fill" />
                Zap Chef ₿
              </Button>
              <Button
                variant="outline"
                class="flex-1 py-2 text-sm"
                on:click={shareRecipe}
              >
                {#if copied}
                  <CheckIcon size={16} weight="bold" />
                  Copied
                {:else}
                  <ShareIcon size={16} weight="fill" />
                  Share
                {/if}
              </Button>
            </footer>
          {/if}
        </article>
      {/if}
    </div>
  {/if}
</div>

<!-- Zap Chef ₿ Modal -->
<Modal bind:open={zapModalOpen}>
  <h1 slot="title" class="flex items-center gap-2">
    <RobotIcon size={24} class="text-primary" weight="fill" />
    Zap Chef ₿
  </h1>
  
  <div class="flex flex-col gap-4">
    {#if zapStatus === 'success'}
      <!-- Success state -->
      <div class="flex flex-col items-center justify-center py-6 gap-4">
        <div class="relative">
          <RobotIcon size={80} class="text-primary" weight="fill" />
          <div class="absolute -top-2 -right-2 animate-bounce">
            <HeartIcon size={32} class="text-red-500" weight="fill" />
          </div>
        </div>
        <Checkmark color="#90EE90" weight="fill" class="w-20 h-20" />
        <div class="text-center">
          <p class="text-xl font-semibold" style="color: var(--color-text-primary)">Chef ₿ says thanks!</p>
          <p class="text-caption mt-1">Your {zapAmount} sats fired up Chef ₿'s kitchen! ⚡</p>
        </div>
      </div>
    {:else if zapStatus === 'error'}
      <!-- Error state -->
      <div class="flex flex-col items-center justify-center py-4 gap-3">
        <WarningIcon size={48} class="text-red-500" />
        <p class="text-center text-red-500">{zapError}</p>
        <Button on:click={() => zapStatus = 'idle'}>Try Again</Button>
      </div>
    {:else}
      <!-- Selection state -->
      <div class="flex flex-col gap-4">
        <p class="text-caption text-center">Show Chef ₿ some love! Your zaps keep the kitchen running. ⚡</p>
        
        <!-- Amount selection -->
        <div class="grid grid-cols-3 gap-2">
          {#each zapAmounts as option}
            <button
              type="button"
              on:click={() => zapAmount = option.amount}
              class="flex flex-col items-center justify-center py-3 px-2 rounded-xl transition-all duration-200 cursor-pointer
                {zapAmount === option.amount
                  ? 'bg-primary text-white shadow-md scale-105'
                  : 'bg-input hover:bg-accent-gray'}"
              style="{zapAmount !== option.amount ? 'color: var(--color-text-primary)' : ''}"
            >
              <span class="text-xl">{option.emoji}</span>
              <span class="text-sm font-semibold">{option.label}</span>
            </button>
          {/each}
        </div>
        
        <!-- Custom amount -->
        <input 
          type="number" 
          class="input text-center" 
          bind:value={zapAmount}
          min="1"
          placeholder="Custom amount"
        />
        
        <!-- Optional message -->
        <input
          type="text"
          class="input"
          bind:value={zapMessage}
          placeholder="Message for Chef ₿ (optional)"
          maxlength="140"
        />
        
        <!-- Wallet info -->
        <div class="p-3 bg-input rounded-xl">
          {#if hasInAppWallet && $activeWallet}
            <div class="flex items-center gap-2">
              <span class="text-sm text-caption">Paying with:</span>
              <span class="font-semibold" style="color: var(--color-text-primary)">{$activeWallet.name}</span>
              <span class="text-xs text-caption">({getWalletKindName($activeWallet.kind)})</span>
            </div>
          {:else}
            <div class="flex items-center gap-2">
              <span class="text-sm text-caption">Payment:</span>
              <span class="font-semibold" style="color: var(--color-text-primary)">External Wallet</span>
            </div>
            <p class="text-xs text-caption mt-1">Scan QR code or connect wallet</p>
          {/if}
        </div>
        
        <!-- Zap button -->
        <Button 
          class="w-full py-3 text-lg"
          on:click={zapZappy}
          disabled={zapStatus === 'paying' || zapAmount < 1}
        >
          {#if zapStatus === 'paying'}
            <ArrowsClockwiseIcon size={18} class="animate-spin" />
            Sending to Chef ₿...
          {:else}
            ⚡ Send {zapAmount.toLocaleString()} sats to Chef ₿
          {/if}
        </Button>
      </div>
    {/if}
  </div>
</Modal>

<!-- Floating success notification -->
{#if showZapSuccess && !zapModalOpen}
  <div class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-bounce">
    <div class="flex items-center gap-2 px-4 py-3 rounded-full bg-primary text-white font-semibold shadow-lg">
      <RobotIcon size={20} weight="fill" />
      <span>Chef ₿ loves you! ⚡</span>
      <HeartIcon size={20} weight="fill" class="text-red-300" />
    </div>
  </div>
{/if}

<style>
  /* Prompt textarea — starts compact (~2 rows of usable text plus the
     scan-pill gutter at the bottom) and grows up to ~6 rows. The JS
     `autoSizePrompt` keeps `style.height` in sync with scrollHeight;
     max-height + overflow-y here cap the growth and switch to scroll. */
  .input.auto-grow {
    min-height: 6.5rem;
    max-height: 14rem;
    overflow-y: auto;
  }

  /* Suggestion chip — orange-tint button at secondary visual weight,
     clearly tappable, focus-visible ring for keyboard users. Pattern
     kept local on this page; we'll extract a shared Chip component
     later if the detected-ingredients chips end up close enough to
     consolidate. */
  .suggestion-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 12px;
    border-radius: 999px;
    border: 0;
    background-color: color-mix(in srgb, var(--color-primary) 10%, transparent);
    color: var(--color-primary);
    font-size: 13px;
    font-weight: 500;
    line-height: 1;
    cursor: pointer;
    transition:
      background-color 140ms ease,
      transform 140ms ease,
      box-shadow 140ms ease,
      opacity 140ms ease;
  }
  .suggestion-chip:hover:not(:disabled) {
    background-color: color-mix(in srgb, var(--color-primary) 18%, transparent);
  }
  .suggestion-chip:active:not(:disabled) {
    transform: scale(0.96);
  }
  .suggestion-chip:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 55%, transparent);
  }
  .suggestion-chip:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  /* The chip currently driving a generation keeps its readability
     above the other disabled chips so the user can see WHICH one
     fired. Pairs with the inline spinner in the template. */
  .suggestion-chip.is-loading:disabled {
    opacity: 0.9;
    background-color: color-mix(in srgb, var(--color-primary) 16%, transparent);
  }

  /* Scan Fridge — labeled pill docked in the textarea's bottom-right
     corner (Slack/ChatGPT/iMessage convention). Always-visible "Scan"
     text means no hover tooltip needed on mobile. Uses the Chef ₿
     orange tint so it reads as the same surface family as the primary
     Cook It button, but at a lower visual weight. */
  .scan-pill {
    position: absolute;
    bottom: 0.5rem;
    right: 0.5rem;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px 0 8px;
    border-radius: 999px;
    background-color: color-mix(in srgb, var(--color-primary) 12%, transparent);
    color: var(--color-primary);
    border: 0;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    transition:
      background-color 140ms ease,
      transform 140ms ease,
      box-shadow 140ms ease;
  }
  .scan-pill:hover:not(:disabled) {
    background-color: color-mix(in srgb, var(--color-primary) 22%, transparent);
  }
  .scan-pill:active:not(:disabled) {
    transform: scale(0.96);
  }
  .scan-pill:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 55%, transparent);
  }
  .scan-pill:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Recipe output card — replaces the legacy terminal-output. Used
     both for the loading skeleton and the rendered-markdown recipe.
     A thin orange accent stripe on the left anchors it to the
     Chef ₿ brand without overwhelming the content. */
  .recipe-card {
    display: flex;
    flex-direction: column;
    border-radius: 14px;
    background-color: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    border-left: 3px solid var(--color-primary);
    overflow: hidden;
  }

  .recipe-card-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--color-input-border);
  }

  .chef-avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 999px;
    background-color: color-mix(in srgb, var(--color-primary) 14%, transparent);
    color: var(--color-primary);
    flex-shrink: 0;
  }

  .recipe-card-body {
    padding: 16px 20px;
    color: var(--color-text-primary);
    font-size: 0.95rem;
    line-height: 1.55;
  }
  /* Tighten the default prose spacing — recipe headings benefit
     from being denser than article prose. */
  .recipe-card-body :global(h1) {
    font-size: 1.35rem;
    margin: 0 0 0.5rem;
  }
  .recipe-card-body :global(h2) {
    font-size: 1rem;
    font-weight: 700;
    margin: 1rem 0 0.4rem;
    color: var(--color-primary);
  }
  .recipe-card-body :global(ul),
  .recipe-card-body :global(ol) {
    margin: 0.25rem 0 0.75rem;
    padding-left: 1.25rem;
  }
  .recipe-card-body :global(li) {
    margin: 0.2rem 0;
  }
  .recipe-card-body :global(p) {
    margin: 0.4rem 0;
  }

  .recipe-card-actions {
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--color-input-border);
    background-color: color-mix(in srgb, var(--color-primary) 4%, transparent);
  }
  @media (max-width: 480px) {
    .recipe-card-actions {
      flex-wrap: wrap;
    }
  }
</style>
