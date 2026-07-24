<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { userPublickey } from '$lib/nostr';
  import {
    membershipStatusMap,
    queueMembershipLookup,
    type MembershipStatus
  } from '$lib/stores/membershipStatus';
  import { activeWallet, getWalletKindName } from '$lib/wallet';
  import { sendPayment } from '$lib/wallet/walletManager';
  import { lightningService } from '$lib/lightningService';
  import Button from '../../components/Button.svelte';
  import Modal from '../../components/Modal.svelte';
  import CheffyIcon, { type CheffyExpression } from '../../components/icons/CheffyIcon.svelte';
  import CheffyAvatar from '../../components/CheffyAvatar.svelte';
  import CheffyStarterPrompts, {
    type StarterPrompt
  } from '../../components/CheffyStarterPrompts.svelte';
  import { parseMarkdown, parseMarkdownForEditing } from '$lib/parser';
  import { saveDraft } from '$lib/draftStore';
  import {
    PROMPT_PLACEHOLDERS,
    THINKING_LINES,
    COOKING_LINES,
    ZAP_THANKS_TITLES,
    ZAP_THANKS_SUBTITLES,
    ZAP_TOAST_LINES,
    ERROR_LINES,
    SCAN_ERROR_LINE,
    pickLine,
    looksLikeStructuredRecipe,
    consumeCheffyPrompt
  } from '$lib/cheffy';
  import ShareIcon from 'phosphor-svelte/lib/Share';
  import FloppyDiskIcon from 'phosphor-svelte/lib/FloppyDisk';
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
  import CheckIcon from 'phosphor-svelte/lib/Check';
  import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwise';
  import WarningIcon from 'phosphor-svelte/lib/Warning';
  import HeartIcon from 'phosphor-svelte/lib/Heart';
  import Checkmark from 'phosphor-svelte/lib/CheckFat';
  import CameraIcon from 'phosphor-svelte/lib/Camera';
  import ShuffleIcon from 'phosphor-svelte/lib/Shuffle';
  import PaperPlaneIcon from 'phosphor-svelte/lib/PaperPlaneTilt';
  import XIcon from 'phosphor-svelte/lib/X';
  import PlusIcon from 'phosphor-svelte/lib/Plus';
  import TrashIcon from 'phosphor-svelte/lib/ArrowCounterClockwise';

  // Cheffy's lightning address — UNCHANGED recipient. A branding pass
  // must never move where the sats go.
  const CHEFFY_LIGHTNING_ADDRESS = 'ZapCooking@getalby.com';

  // ── Membership gate ──────────────────────────────────────────
  let membershipMap: Record<string, MembershipStatus> = {};
  const unsubMembership = membershipStatusMap.subscribe((v) => {
    membershipMap = v;
  });
  $: if ($userPublickey) queueMembershipLookup($userPublickey);
  $: normalizedPk = String($userPublickey || '')
    .trim()
    .toLowerCase();
  $: hasMembership = Boolean(membershipMap[normalizedPk]?.active);

  let isLoading = true;

  // ── Conversation state ───────────────────────────────────────
  type ChatRole = 'user' | 'cheffy';
  type ChatKind = 'text' | 'recipe' | 'pending' | 'error';
  interface ChatMessage {
    id: string;
    role: ChatRole;
    content: string; // for 'error' this is the technical detail
    kind: ChatKind;
    expression?: CheffyExpression;
    statusLine?: string; // pending loading line / friendly error line
  }

  let thread: ChatMessage[] = [];
  let threadEl: HTMLDivElement;
  let loading = false; // a request is in flight
  let announce = ''; // sr-only live-region status
  let lastTurn: { prompt: string; mode: 'chat' | 'hungry' } | null = null;
  let lastStatusLine = '';

  let msgSeq = 0;
  const nextId = () => `m${++msgSeq}`;

  // ── Composer state ───────────────────────────────────────────
  let input = '';
  let promptEl: HTMLTextAreaElement;

  async function autoSizePrompt() {
    await tick();
    if (!promptEl) return;
    promptEl.style.height = 'auto';
    promptEl.style.height = `${Math.min(promptEl.scrollHeight, 224)}px`;
  }
  $: if (browser) {
    input;
    autoSizePrompt();
  }

  // Rotating placeholder examples
  let currentPlaceholderIndex = 0;
  let placeholderInterval: ReturnType<typeof setInterval>;
  $: currentPlaceholder = PROMPT_PLACEHOLDERS[currentPlaceholderIndex];

  // ── Scan ("show Cheffy your fridge") state ───────────────────
  let fileInput: HTMLInputElement;
  let isScanning = false;
  let scanError = '';
  let detectedIngredients: string[] = [];
  let newIngredient = '';
  let showIngredientInput = false;

  // ── Save / Share state ───────────────────────────────────────
  let isSaving = false;
  let copiedId: string | null = null;
  let copyTimeout: ReturnType<typeof setTimeout>;

  // ── Zap state ────────────────────────────────────────────────
  let zapModalOpen = false;
  let zapAmount = 21;
  let zapMessage = '';
  type ZapStatus = 'idle' | 'paying' | 'success' | 'error';
  let zapStatus: ZapStatus = 'idle';
  let zapError = '';
  let showZapSuccess = false;
  let zapSuccessTimeout: ReturnType<typeof setTimeout>;
  let zapThanksTitle = ZAP_THANKS_TITLES[0];
  let zapThanksSubtitle = ZAP_THANKS_SUBTITLES[0];
  let zapToastLine = ZAP_TOAST_LINES[0];

  const zapAmounts = [
    { amount: 21, emoji: '🧑‍🍳', label: '21' },
    { amount: 100, emoji: '⚡', label: '100' },
    { amount: 500, emoji: '🍳', label: '500' },
    { amount: 1000, emoji: '🔥', label: '1K' },
    { amount: 2100, emoji: '🍽️', label: '2.1K' },
    { amount: 10000, emoji: '🚀', label: '10K' }
  ];

  $: hasInAppWallet = $activeWallet && ($activeWallet.kind === 3 || $activeWallet.kind === 4);

  $: canSend = (input.trim().length > 0 || detectedIngredients.length > 0) && !loading;

  let unsubMembershipReady: (() => void) | null = null;

  onMount(() => {
    if (!$userPublickey) {
      goto('/login?redirect=/cheffy');
      return;
    }

    // Wait for membershipStatusMap to resolve this pubkey to avoid briefly showing
    // the upsell UI for active members.
    const pk = normalizedPk;
    if (!/^[a-f0-9]{64}$/.test(pk) || membershipMap[pk] !== undefined) {
      isLoading = false;
    } else {
      isLoading = true;
      unsubMembershipReady = membershipStatusMap.subscribe((v) => {
        if (v[pk] !== undefined) {
          isLoading = false;
          unsubMembershipReady?.();
          unsubMembershipReady = null;
        }
      });
    }

    // Pull a prompt handed off from Explore (single-use, session-only).
    const handoff = consumeCheffyPrompt();
    if (handoff) {
      input = handoff;
      tick().then(() => promptEl?.focus());
    }

    placeholderInterval = setInterval(() => {
      currentPlaceholderIndex = (currentPlaceholderIndex + 1) % PROMPT_PLACEHOLDERS.length;
    }, 4000);
  });

  onDestroy(() => {
    unsubMembershipReady?.();
    unsubMembership();
    if (placeholderInterval) clearInterval(placeholderInterval);
    if (copyTimeout) clearTimeout(copyTimeout);
    if (zapSuccessTimeout) clearTimeout(zapSuccessTimeout);
  });

  // ── Conversation engine ──────────────────────────────────────
  // Map the visible thread to the API's history shape. Excludes
  // pending/error placeholders; optionally drops the trailing user turn
  // (used by retry, which re-sends that turn as the fresh prompt).
  function buildHistory(excludeTrailingUser = false) {
    const api = thread
      .filter((m) => (m.kind === 'text' || m.kind === 'recipe') && m.content.trim())
      .map((m) => ({
        role: m.role === 'cheffy' ? ('assistant' as const) : ('user' as const),
        content: m.content
      }));
    if (excludeTrailingUser && api.length && api[api.length - 1].role === 'user') {
      api.pop();
    }
    return api;
  }

  async function scrollAfterTurn() {
    await tick();
    if (!browser || !threadEl) return;
    threadEl.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Cosmetic only: decides whether the pending bubble shows the
  // "cooking" or "thinking" expression/line.
  function looksLikeRecipeRequest(text: string): boolean {
    return (
      /\b(recipe|cook|dinner|lunch|breakfast|dessert|make me)\b/i.test(text) ||
      /\bi have:?\s/i.test(text)
    );
  }

  async function dispatchTurn(
    promptForApi: string,
    mode: 'chat' | 'hungry',
    apiHistory: { role: 'user' | 'assistant'; content: string }[],
    expectRecipe: boolean
  ) {
    loading = true;
    const statusLine = pickLine(expectRecipe ? COOKING_LINES : THINKING_LINES, lastStatusLine);
    lastStatusLine = statusLine;
    const pending: ChatMessage = {
      id: nextId(),
      role: 'cheffy',
      content: '',
      kind: 'pending',
      expression: expectRecipe ? 'cooking' : 'thinking',
      statusLine
    };
    thread = [...thread, pending];
    await scrollAfterTurn();

    try {
      const resp = await fetch('/api/zappy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptForApi,
          mode,
          pubkey: $userPublickey,
          messages: apiHistory
        })
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        throw new Error(data.error || 'Cheffy could not respond.');
      }
      const isRecipe = looksLikeStructuredRecipe(data.output);
      thread = thread.map((m) =>
        m.id === pending.id
          ? {
              ...m,
              kind: isRecipe ? 'recipe' : 'text',
              content: data.output,
              expression: isRecipe ? 'happy' : 'neutral'
            }
          : m
      );
      announce = isRecipe ? 'Cheffy shared a recipe.' : 'Cheffy replied.';
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Cheffy could not respond.';
      thread = thread.map((m) =>
        m.id === pending.id
          ? {
              ...m,
              kind: 'error',
              content: detail,
              expression: 'concerned',
              statusLine: pickLine(ERROR_LINES, m.statusLine)
            }
          : m
      );
      announce = 'Cheffy hit a snag.';
    } finally {
      loading = false;
      await scrollAfterTurn();
    }
  }

  async function send(content: string, mode: 'chat' | 'hungry' = 'chat') {
    if (loading) return;
    let text = content.trim();
    if (mode !== 'hungry' && !text && detectedIngredients.length > 0) {
      text = `I have: ${detectedIngredients.join(', ')}`;
    }
    if (mode !== 'hungry' && !text) return;
    scanError = '';

    const apiHistory = buildHistory();
    const display = mode === 'hungry' ? 'Surprise me 🎲' : text;
    thread = [...thread, { id: nextId(), role: 'user', content: display, kind: 'text' }];
    lastTurn = { prompt: mode === 'hungry' ? '' : text, mode };

    if (mode !== 'hungry') {
      input = '';
      detectedIngredients = [];
      showIngredientInput = false;
    }
    await scrollAfterTurn();
    await dispatchTurn(
      mode === 'hungry' ? '' : text,
      mode,
      apiHistory,
      mode === 'hungry' || looksLikeRecipeRequest(text)
    );
  }

  async function retryLast() {
    if (loading || !lastTurn) return;
    // Drop any error bubbles, then re-issue the same turn.
    thread = thread.filter((m) => m.kind !== 'error');
    const apiHistory = buildHistory(true);
    await dispatchTurn(
      lastTurn.prompt,
      lastTurn.mode,
      apiHistory,
      lastTurn.mode === 'hungry' || looksLikeRecipeRequest(lastTurn.prompt)
    );
  }

  function startOver() {
    if (loading) return;
    thread = [];
    input = '';
    detectedIngredients = [];
    scanError = '';
    lastTurn = null;
    announce = 'Conversation cleared.';
  }

  function onStarter(e: CustomEvent<StarterPrompt>) {
    const p = e.detail;
    send(p.prompt, p.mode === 'hungry' ? 'hungry' : 'chat');
  }

  function onComposerKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) send(input);
    }
  }

  // ── Recipe-card actions (operate on a specific recipe message) ──
  function extractRecipeTitle(md: string): string {
    const match = md.match(/^#{1,2}\s+(.+?)\s*$/m);
    return match ? match[1].trim() : 'Untitled';
  }

  async function saveAsRecipeDraft(content: string) {
    if (!content || isSaving) return;
    isSaving = true;
    try {
      const title = extractRecipeTitle(content);
      const parsed = parseMarkdownForEditing(content);
      const parseLooksGood = parsed.ingredients.length > 0 && parsed.directions.length > 0;

      let draftData: Parameters<typeof saveDraft>[0];
      if (parseLooksGood) {
        draftData = {
          title,
          images: [],
          tags: [],
          summary: '',
          chefsnotes: parsed.chefNotes || '',
          preptime: parsed.information?.prepTime || '',
          cooktime: parsed.information?.cookTime || '',
          servings: parsed.information?.servings || '',
          ingredients: parsed.ingredients,
          directions: parsed.directions,
          additionalMarkdown: parsed.additionalMarkdown || ''
        };
      } else {
        console.warn(
          '[Cheffy] Recipe parse produced empty ingredients/directions, salvaging raw text.',
          parsed
        );
        announce = "Couldn't parse that recipe cleanly — opening the editor with the raw text.";
        draftData = {
          title,
          images: [],
          tags: [],
          summary: '',
          chefsnotes: '',
          preptime: '',
          cooktime: '',
          servings: '',
          ingredients: [],
          directions: [],
          additionalMarkdown: content
        };
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      const { draftId } = saveDraft(draftData, undefined, false);
      await goto(`/create?draft=${draftId}`);
    } catch (e) {
      console.error('[Cheffy] Save-as-draft failed:', e);
      announce = 'Cheffy could not save that draft. Please try again.';
    } finally {
      isSaving = false;
    }
  }

  async function shareRecipe(content: string, id: string) {
    if (!content || !browser) return;
    const shareTitle = `${extractRecipeTitle(content)} — a Cheffy recipe`;
    const url = 'https://zap.cooking';

    if (navigator.share) {
      try {
        await navigator.share({ title: shareTitle, text: content, url });
        return;
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${shareTitle}\n\n${content}\n\n${url}`);
      copiedId = id;
      if (copyTimeout) clearTimeout(copyTimeout);
      copyTimeout = setTimeout(() => {
        copiedId = null;
      }, 2000);
    } catch (err) {
      console.error('[Cheffy] Share clipboard fallback failed:', err);
    }
  }

  // ── Zap (recipient + wallet logic UNCHANGED — copy only) ──────
  function openZapModal() {
    zapModalOpen = true;
    zapStatus = 'idle';
    zapError = '';
  }

  async function zapCheffy() {
    if (zapStatus === 'paying') return;
    zapStatus = 'paying';
    zapError = '';
    try {
      if (hasInAppWallet) {
        const result = await sendPayment(CHEFFY_LIGHTNING_ADDRESS, {
          amount: zapAmount,
          description: zapMessage || `Zap to Cheffy from ${$userPublickey?.substring(0, 8)}...`,
          comment: zapMessage
        });
        if (!result.success) throw new Error(result.error || 'Payment failed');
        zapStatus = 'success';
        triggerZapSuccess();
      } else {
        const invoice = await fetchLightningAddressInvoice(
          CHEFFY_LIGHTNING_ADDRESS,
          zapAmount * 1000,
          zapMessage
        );
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

  async function fetchLightningAddressInvoice(
    address: string,
    amountMsats: number,
    comment?: string
  ): Promise<string> {
    const [username, domain] = address.split('@');
    const lnurlEndpoint = `https://${domain}/.well-known/lnurlp/${username}`;
    const lnurlResponse = await fetch(lnurlEndpoint);
    if (!lnurlResponse.ok) throw new Error('Failed to resolve lightning address');
    const lnurlData = await lnurlResponse.json();
    if (lnurlData.status === 'ERROR')
      throw new Error(lnurlData.reason || 'Lightning address error');
    const callbackUrl = new URL(lnurlData.callback);
    callbackUrl.searchParams.set('amount', amountMsats.toString());
    if (comment && lnurlData.commentAllowed) {
      callbackUrl.searchParams.set('comment', comment.substring(0, lnurlData.commentAllowed));
    }
    const invoiceResponse = await fetch(callbackUrl.toString());
    if (!invoiceResponse.ok) throw new Error('Failed to get invoice');
    const invoiceData = await invoiceResponse.json();
    if (invoiceData.status === 'ERROR')
      throw new Error(invoiceData.reason || 'Failed to get invoice');
    if (!invoiceData.pr) throw new Error('No invoice returned');
    return invoiceData.pr;
  }

  function triggerZapSuccess() {
    // Fresh, non-repeating Cheffy lines each time.
    zapThanksTitle = pickLine(ZAP_THANKS_TITLES, zapThanksTitle);
    zapThanksSubtitle = pickLine(ZAP_THANKS_SUBTITLES, zapThanksSubtitle);
    zapToastLine = pickLine(ZAP_TOAST_LINES, zapToastLine);
    showZapSuccess = true;
    if (zapSuccessTimeout) clearTimeout(zapSuccessTimeout);
    zapSuccessTimeout = setTimeout(() => {
      showZapSuccess = false;
      zapModalOpen = false;
      zapStatus = 'idle';
    }, 3000);
  }

  $: if (!zapModalOpen && zapStatus !== 'success') {
    zapStatus = 'idle';
    zapError = '';
  }

  // ── Scan ─────────────────────────────────────────────────────
  function triggerScan() {
    fileInput?.click();
  }

  async function handleFileSelect(event: Event) {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      scanError = 'Please choose an image file.';
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      scanError = 'That image is a little big — try one under 10MB.';
      return;
    }
    isScanning = true;
    scanError = '';
    try {
      const base64 = await fileToBase64(file);
      const response = await fetch('/api/zappy/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, pubkey: $userPublickey })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || SCAN_ERROR_LINE);
      }
      detectedIngredients = data.ingredients || [];
      if (detectedIngredients.length > 0) {
        input = `I have: ${detectedIngredients.join(', ')}`;
      } else {
        scanError = SCAN_ERROR_LINE;
      }
    } catch (err) {
      scanError = err instanceof Error ? err.message : SCAN_ERROR_LINE;
    } finally {
      isScanning = false;
      if (inputEl) inputEl.value = '';
    }
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function removeIngredient(ingredient: string) {
    detectedIngredients = detectedIngredients.filter((i) => i !== ingredient);
    input = detectedIngredients.length > 0 ? `I have: ${detectedIngredients.join(', ')}` : '';
  }

  function addIngredient() {
    const trimmed = newIngredient.trim();
    if (trimmed && !detectedIngredients.includes(trimmed)) {
      detectedIngredients = [...detectedIngredients, trimmed];
      input = `I have: ${detectedIngredients.join(', ')}`;
    }
    newIngredient = '';
    showIngredientInput = false;
  }

  function clearIngredients() {
    detectedIngredients = [];
    input = '';
  }
</script>

<svelte:head>
  <title>Cheffy - Zap Cooking</title>
  <meta
    name="description"
    content="Cheffy is your Zap Cooking kitchen companion. Ask cooking questions, use what you have, fix a mistake, or turn an idea into dinner."
  />
</svelte:head>

<!-- sr-only status region for screen readers -->
<div class="sr-only" aria-live="polite" aria-atomic="true">{announce}</div>

<div class="flex flex-col max-w-[760px] mx-auto gap-6 pb-8">
  <!-- Header -->
  <div class="flex items-center gap-3 flex-wrap">
    <CheffyAvatar size={46} expression="happy" />
    <div class="flex flex-col min-w-0">
      <div class="flex items-center gap-2 flex-wrap">
        <h1>Cheffy</h1>
        <span class="pro-chip">Cook+</span>
      </div>
      <p class="text-caption">Your kitchen companion</p>
    </div>
  </div>

  {#if isLoading}
    <div class="flex flex-col items-center justify-center py-16 gap-4">
      <ArrowsClockwiseIcon size={40} class="animate-spin text-primary" />
      <p class="text-caption">Warming up the kitchen…</p>
    </div>
  {:else if !hasMembership}
    <!-- Membership gate -->
    <div class="flex flex-col items-center justify-center py-16 gap-6">
      <CheffyAvatar size={84} expression="neutral" variant="character" />
      <div class="text-center max-w-md">
        <h2 class="mb-2">Cheffy comes with Cook+</h2>
        <p class="text-caption mb-6">
          Cheffy is your kitchen companion — ask cooking questions, use what you have, fix a
          mistake, or turn an idea into dinner. Unlock him with a Cook+ membership.
        </p>
        <Button on:click={() => goto('/membership')}>View Membership Options</Button>
      </div>
    </div>
  {:else}
    <!-- Member experience -->
    <p class="text-caption -mt-2">
      Ask a question, bounce around an idea, or tell Cheffy what you have.
    </p>

    <!-- Conversation / empty intro -->
    {#if thread.length === 0}
      <div class="intro-block">
        <p class="intro-line">New here? Tap a starter, or just tell me what you're working with.</p>
        <CheffyStarterPrompts on:select={onStarter} disabled={loading} />
      </div>
    {:else}
      <div class="thread" bind:this={threadEl}>
        {#each thread as m (m.id)}
          {#if m.role === 'user'}
            <div class="msg msg-user">
              <div class="bubble-user">{m.content}</div>
            </div>
          {:else}
            <div class="msg msg-cheffy">
              <CheffyAvatar
                size={32}
                expression={m.expression ?? 'neutral'}
                animate={m.kind === 'pending'}
              />
              <div class="cheffy-side">
                {#if m.kind === 'pending'}
                  <div class="pending-bubble">
                    <span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>
                    <span class="status-line">{m.statusLine}</span>
                  </div>
                {:else if m.kind === 'error'}
                  <div class="error-bubble">
                    <p class="error-line">{m.statusLine}</p>
                    <p class="error-detail">{m.content}</p>
                    <button type="button" class="retry-btn" on:click={retryLast} disabled={loading}>
                      <ArrowsClockwiseIcon size={14} />
                      Try again
                    </button>
                  </div>
                {:else if m.kind === 'recipe'}
                  <article class="recipe-card">
                    <div class="recipe-card-body prose dark:prose-invert max-w-none">
                      <!-- parseMarkdown runs the output through sanitizeHTML; same
                           trusted pipeline the recipe pages use. -->
                      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                      {@html parseMarkdown(m.content)}
                    </div>
                    <footer class="recipe-card-actions">
                      <Button
                        variant="primary"
                        class="flex-1 py-2 text-sm"
                        disabled={isSaving}
                        on:click={() => saveAsRecipeDraft(m.content)}
                      >
                        <FloppyDiskIcon size={16} weight="bold" />
                        {isSaving ? 'Saving…' : 'Save'}
                      </Button>
                      <Button
                        variant="outline"
                        class="flex-1 py-2 text-sm"
                        title="Zap Cheffy"
                        aria-label="Zap Cheffy"
                        on:click={openZapModal}
                      >
                        <LightningIcon size={16} weight="fill" />
                        Zap
                      </Button>
                      <Button
                        variant="outline"
                        class="flex-1 py-2 text-sm"
                        on:click={() => shareRecipe(m.content, m.id)}
                      >
                        {#if copiedId === m.id}
                          <CheckIcon size={16} weight="bold" />
                          Copied
                        {:else}
                          <ShareIcon size={16} weight="fill" />
                          Share
                        {/if}
                      </Button>
                    </footer>
                  </article>
                {:else}
                  <div class="cheffy-text prose dark:prose-invert max-w-none">
                    <!-- Sanitized via parseMarkdown → sanitizeHTML. -->
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    {@html parseMarkdown(m.content)}
                  </div>
                {/if}
              </div>
            </div>
          {/if}
        {/each}
      </div>
    {/if}

    <!-- Composer -->
    <div class="composer">
      <!-- Detected ingredients -->
      {#if detectedIngredients.length > 0}
        <div class="flex flex-col gap-3 p-4 rounded-xl bg-teal-500/10 border border-teal-500/20">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium" style="color: var(--color-text-primary)">
              🥬 Cheffy spotted {detectedIngredients.length}
              {detectedIngredients.length === 1 ? 'item' : 'items'}
            </span>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="text-xs text-teal-600 hover:text-teal-700 font-medium"
                on:click={triggerScan}
              >
                Rescan
              </button>
              <button
                type="button"
                class="text-xs text-caption hover:text-red-500"
                on:click={clearIngredients}
              >
                Clear
              </button>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            {#each detectedIngredients as ingredient}
              <span
                class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-white/80 dark:bg-gray-800/80 border border-teal-300 dark:border-teal-700"
                style="color: var(--color-text-primary)"
              >
                {ingredient}
                <button
                  type="button"
                  class="text-gray-400 hover:text-red-500 transition-colors"
                  aria-label={`Remove ${ingredient}`}
                  on:click={() => removeIngredient(ingredient)}
                >
                  <XIcon size={14} weight="bold" />
                </button>
              </span>
            {/each}
            {#if showIngredientInput}
              <form class="inline-flex items-center gap-1" on:submit|preventDefault={addIngredient}>
                <input
                  type="text"
                  bind:value={newIngredient}
                  placeholder="Add item…"
                  class="w-24 px-2 py-1 text-sm rounded-full border border-teal-300 dark:border-teal-700 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-500"
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
                <button
                  type="submit"
                  class="text-teal-600 hover:text-teal-700"
                  aria-label="Add ingredient"
                >
                  <CheckIcon size={16} weight="bold" />
                </button>
              </form>
            {:else}
              <button
                type="button"
                class="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium border border-dashed border-teal-400 text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors"
                on:click={() => (showIngredientInput = true)}
              >
                <PlusIcon size={14} weight="bold" />
                Add
              </button>
            {/if}
          </div>
        </div>
      {/if}

      {#if scanError}
        <div class="flex items-start gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
          <WarningIcon size={18} class="text-red-500 flex-shrink-0 mt-0.5" />
          <p class="text-sm text-red-500">{scanError}</p>
        </div>
      {/if}

      <!-- Input -->
      <div class="relative">
        <label for="cheffy-input" class="sr-only">Message Cheffy</label>
        <textarea
          id="cheffy-input"
          bind:this={promptEl}
          bind:value={input}
          placeholder={currentPlaceholder}
          rows="2"
          class="input auto-grow resize-none text-base w-full pb-12"
          disabled={loading}
          on:keydown={onComposerKeydown}
        ></textarea>
        <button
          type="button"
          class="scan-pill"
          on:click={triggerScan}
          disabled={isScanning || loading}
          title="Show Cheffy your fridge"
          aria-label="Show Cheffy your fridge"
        >
          {#if isScanning}
            <ArrowsClockwiseIcon size={14} class="animate-spin" />
            <span>Scanning</span>
          {:else}
            <CameraIcon size={14} weight="fill" />
            <span>Show Cheffy your fridge</span>
          {/if}
        </button>
      </div>

      <input
        bind:this={fileInput}
        type="file"
        accept="image/*"
        capture="environment"
        class="hidden"
        on:change={handleFileSelect}
      />

      <!-- Actions -->
      <div class="flex flex-col-reverse sm:flex-row gap-3">
        <Button
          variant="outline"
          class="w-full sm:flex-[2] py-3"
          disabled={loading}
          on:click={() => send('', 'hungry')}
        >
          <ShuffleIcon size={18} weight="fill" />
          Surprise me
        </Button>
        <Button
          variant="primary"
          class="w-full sm:flex-[3] py-3"
          disabled={!canSend}
          on:click={() => send(input)}
        >
          {#if loading}
            <ArrowsClockwiseIcon size={18} class="animate-spin" />
            Cooking…
          {:else}
            <PaperPlaneIcon size={18} weight="fill" />
            Ask Cheffy
          {/if}
        </Button>
      </div>

      <div class="flex items-center justify-between gap-2 min-h-[1.25rem]">
        {#if thread.length === 0 && !input.trim()}
          <p class="text-xs text-caption">Ask anything, or try Surprise me.</p>
        {:else}
          <span></span>
        {/if}
        {#if thread.length > 0}
          <button type="button" class="start-over-btn" on:click={startOver} disabled={loading}>
            <TrashIcon size={13} />
            Start over
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<!-- Zap Cheffy Modal -->
<Modal bind:open={zapModalOpen}>
  <h1 slot="title" class="flex items-center gap-2">
    <CheffyIcon size={24} expression="excited" />
    Zap Cheffy
  </h1>

  <div class="flex flex-col gap-4">
    {#if zapStatus === 'success'}
      <div class="flex flex-col items-center justify-center py-6 gap-4">
        <div class="relative">
          <CheffyAvatar size={72} expression="excited" animate variant="character" />
          <div class="absolute -top-2 -right-2 animate-bounce">
            <HeartIcon size={30} class="text-red-500" weight="fill" />
          </div>
        </div>
        <Checkmark color="#90EE90" weight="fill" class="w-16 h-16" />
        <div class="text-center">
          <p class="text-xl font-semibold" style="color: var(--color-text-primary)">
            {zapThanksTitle}
          </p>
          <p class="text-caption mt-1">{zapThanksSubtitle}</p>
        </div>
      </div>
    {:else if zapStatus === 'error'}
      <div class="flex flex-col items-center justify-center py-4 gap-3">
        <WarningIcon size={48} class="text-red-500" />
        <p class="text-center text-red-500">{zapError}</p>
        <Button on:click={() => (zapStatus = 'idle')}>Try Again</Button>
      </div>
    {:else}
      <div class="flex flex-col gap-4">
        <p class="text-caption text-center">
          Cheffy runs on zaps. A little fuel keeps the burners lit. ⚡
        </p>
        <div class="grid grid-cols-3 gap-2">
          {#each zapAmounts as option}
            <button
              type="button"
              on:click={() => (zapAmount = option.amount)}
              class="flex flex-col items-center justify-center py-3 px-2 rounded-xl transition-all duration-200 cursor-pointer
                {zapAmount === option.amount
                ? 'bg-primary text-white shadow-md scale-105'
                : 'bg-input hover:bg-accent-gray'}"
              style={zapAmount !== option.amount ? 'color: var(--color-text-primary)' : ''}
            >
              <span class="text-xl">{option.emoji}</span>
              <span class="text-sm font-semibold">{option.label}</span>
            </button>
          {/each}
        </div>
        <input
          type="number"
          class="input text-center"
          bind:value={zapAmount}
          min="1"
          placeholder="Custom amount"
        />
        <input
          type="text"
          class="input"
          bind:value={zapMessage}
          placeholder="Message for Cheffy (optional)"
          maxlength="140"
        />
        <div class="p-3 bg-input rounded-xl">
          {#if hasInAppWallet && $activeWallet}
            <div class="flex items-center gap-2">
              <span class="text-sm text-caption">Paying with:</span>
              <span class="font-semibold" style="color: var(--color-text-primary)"
                >{$activeWallet.name}</span
              >
              <span class="text-xs text-caption">({getWalletKindName($activeWallet.kind)})</span>
            </div>
          {:else}
            <div class="flex items-center gap-2">
              <span class="text-sm text-caption">Payment:</span>
              <span class="font-semibold" style="color: var(--color-text-primary)"
                >External Wallet</span
              >
            </div>
            <p class="text-xs text-caption mt-1">Scan QR code or connect wallet</p>
          {/if}
        </div>
        <Button
          class="w-full py-3 text-lg"
          on:click={zapCheffy}
          disabled={zapStatus === 'paying' || zapAmount < 1}
        >
          {#if zapStatus === 'paying'}
            <ArrowsClockwiseIcon size={18} class="animate-spin" />
            Sending to Cheffy…
          {:else}
            ⚡ Send {zapAmount.toLocaleString()} sats to Cheffy
          {/if}
        </Button>
      </div>
    {/if}
  </div>
</Modal>

<!-- Floating success toast -->
{#if showZapSuccess && !zapModalOpen}
  <div class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 toast-pop">
    <div
      class="flex items-center gap-2 px-4 py-3 rounded-full bg-primary text-white font-semibold shadow-lg"
    >
      <CheffyIcon size={20} expression="excited" />
      <span>{zapToastLine}</span>
      <HeartIcon size={18} weight="fill" class="text-red-300" />
    </div>
  </div>
{/if}

<style>
  /* Pro Kitchen — intentionally secondary to the Cheffy wordmark. */
  .pro-chip {
    display: inline-flex;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.03em;
    color: var(--color-text-caption, #9ca3af);
    background-color: color-mix(in srgb, var(--color-primary) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-primary) 18%, transparent);
  }

  .intro-block {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .intro-line {
    font-size: 0.95rem;
    color: var(--color-text-primary);
  }

  /* ── Conversation thread ─────────────────────────────────── */
  .thread {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .msg {
    display: flex;
  }
  .msg-user {
    justify-content: flex-end;
  }
  .bubble-user {
    max-width: 85%;
    padding: 10px 14px;
    border-radius: 16px 16px 4px 16px;
    background-color: var(--color-primary);
    color: #fff;
    font-size: 0.95rem;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .msg-cheffy {
    gap: 10px;
    align-items: flex-start;
  }
  .cheffy-side {
    min-width: 0;
    flex: 1;
  }

  .pending-bubble {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-radius: 16px 16px 16px 4px;
    background-color: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    color: var(--color-text-secondary);
    font-size: 0.9rem;
  }
  .typing-dots {
    display: inline-flex;
    gap: 3px;
  }
  .typing-dots i {
    width: 5px;
    height: 5px;
    border-radius: 999px;
    background-color: var(--color-primary);
    animation: typing 1.2s ease-in-out infinite;
  }
  .typing-dots i:nth-child(2) {
    animation-delay: 0.2s;
  }
  .typing-dots i:nth-child(3) {
    animation-delay: 0.4s;
  }
  @keyframes typing {
    0%,
    60%,
    100% {
      opacity: 0.3;
      transform: translateY(0);
    }
    30% {
      opacity: 1;
      transform: translateY(-3px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .typing-dots i {
      animation: none;
      opacity: 0.6;
    }
  }

  .cheffy-text {
    padding: 10px 14px;
    border-radius: 16px 16px 16px 4px;
    background-color: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    color: var(--color-text-primary);
    font-size: 0.95rem;
    line-height: 1.55;
  }
  .cheffy-text :global(p) {
    margin: 0.35rem 0;
  }
  .cheffy-text :global(p:first-child) {
    margin-top: 0;
  }
  .cheffy-text :global(p:last-child) {
    margin-bottom: 0;
  }
  .cheffy-text :global(ul),
  .cheffy-text :global(ol) {
    margin: 0.35rem 0;
    padding-left: 1.25rem;
  }
  .cheffy-text :global(li) {
    margin: 0.15rem 0;
  }

  .error-bubble {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 14px;
    border-radius: 16px 16px 16px 4px;
    background-color: color-mix(in srgb, #ef4444 8%, var(--color-bg-secondary));
    border: 1px solid color-mix(in srgb, #ef4444 30%, transparent);
  }
  .error-line {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .error-detail {
    font-size: 0.8rem;
    color: var(--color-text-secondary);
    word-break: break-word;
  }
  .retry-btn {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-top: 2px;
    padding: 5px 12px;
    border-radius: 999px;
    border: 1px solid var(--color-input-border);
    background: transparent;
    color: var(--color-primary);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }
  .retry-btn:hover:not(:disabled) {
    background-color: color-mix(in srgb, var(--color-primary) 10%, transparent);
  }
  .retry-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ── Composer ────────────────────────────────────────────── */
  .composer {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .input.auto-grow {
    min-height: 6.5rem;
    max-height: 14rem;
    overflow-y: auto;
  }

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
    max-width: calc(100% - 1rem);
    transition:
      background-color 140ms ease,
      transform 140ms ease;
  }
  .scan-pill span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  .start-over-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border-radius: 999px;
    background: transparent;
    border: 0;
    color: var(--color-text-caption, #9ca3af);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition:
      color 120ms ease,
      background-color 120ms ease;
  }
  .start-over-btn:hover:not(:disabled) {
    color: var(--color-primary);
    background-color: color-mix(in srgb, var(--color-primary) 8%, transparent);
  }
  .start-over-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ── Recipe card (within a Cheffy message) ───────────────── */
  .recipe-card {
    display: flex;
    flex-direction: column;
    border-radius: 14px;
    background-color: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    border-left: 3px solid var(--color-primary);
    overflow: hidden;
  }
  .recipe-card-body {
    padding: 16px 20px;
    color: var(--color-text-primary);
    font-size: 0.95rem;
    line-height: 1.55;
  }
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

  .toast-pop {
    animation: toast-in 240ms ease-out;
  }
  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translate(-50%, 10px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .toast-pop {
      animation: none;
    }
  }
</style>
