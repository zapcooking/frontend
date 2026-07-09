<script lang="ts">
  /**
   * Cheffy messenger — the responsive assistant surface.
   *
   *  - < 640px  : full-screen bottom sheet (rounded top, drag handle)
   *  - 640–1024 : centered modal, max ~640px
   *  - ≥ 1024px : bottom-right floating panel, page stays interactive
   *
   * Mobile / tablet are modal (backdrop + scroll lock + focus trap);
   * desktop is a non-modal panel so the page behind stays usable. The
   * software keyboard is handled with the VisualViewport API so the
   * composer is never covered.
   */
  import { onMount, onDestroy, tick } from 'svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { userPublickey } from '$lib/nostr';
  import {
    membershipStatusMap,
    queueMembershipLookup,
    type MembershipStatus
  } from '$lib/stores/membershipStatus';
  import { parseMarkdown } from '$lib/parser';
  import { PROMPT_PLACEHOLDERS, SCAN_ERROR_LINE } from '$lib/cheffy';
  import {
    cheffyOpen,
    cheffyThread,
    cheffyLoading,
    cheffyDraft,
    cheffyAnnounce,
    cheffyExperienceMode,
    cheffyExperienceUsed,
    cheffyExperienceCount,
    cheffyConversion,
    sendCheffy,
    retryCheffy,
    startOverCheffy,
    closeCheffy
  } from '$lib/stores/cheffyChat';
  import CheffyAvatar from './CheffyAvatar.svelte';
  import CheffyRecipeCard from './CheffyRecipeCard.svelte';
  import CheffySuggestionChips, {
    STARTER_SUGGESTIONS,
    CONTEXT_RECIPE,
    CONTEXT_GENERAL,
    type CheffySuggestion
  } from './CheffySuggestionChips.svelte';
  import XIcon from 'phosphor-svelte/lib/X';
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';
  import DotsThreeIcon from 'phosphor-svelte/lib/DotsThreeOutline';
  import PaperclipIcon from 'phosphor-svelte/lib/Paperclip';
  import PaperPlaneIcon from 'phosphor-svelte/lib/PaperPlaneTilt';
  import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwise';
  import CameraIcon from 'phosphor-svelte/lib/Camera';
  import ImageIcon from 'phosphor-svelte/lib/Image';
  import LinkIcon from 'phosphor-svelte/lib/LinkSimple';
  import ClipboardIcon from 'phosphor-svelte/lib/ClipboardText';
  import ScanIcon from 'phosphor-svelte/lib/Scan';

  // ── Membership / sign-in gating (mirrors the /cheffy page) ──────
  let membershipMap: Record<string, MembershipStatus> = {};
  const unsub = membershipStatusMap.subscribe((v) => (membershipMap = v));
  $: if ($userPublickey) queueMembershipLookup($userPublickey);
  $: normalizedPk = String($userPublickey || '')
    .trim()
    .toLowerCase();
  $: signedIn = $userPublickey !== '';
  $: hasMembership = Boolean(membershipMap[normalizedPk]?.active);

  // ── First-use experience (non-member preview) ───────────────────
  // A non-member (logged out OR logged-in without a membership) who
  // entered via the /explore invite, or who has any preview turns spent
  // (so a mid-chat reload keeps them in the preview rather than dropping
  // to the gate), sees the preview flow + a soft conversion card instead
  // of the hard sign-in / membership gate. Members are never affected.
  $: inExperience =
    !hasMembership &&
    ($cheffyExperienceMode || $cheffyExperienceCount > 0 || $cheffyConversion !== null);
  // Re-assert preview mode so follow-up sends stay tagged as experience
  // requests (e.g. after a mid-chat reload, where the flag would reset).
  $: if (inExperience && !$cheffyExperienceMode) cheffyExperienceMode.set(true);
  // If membership resolves true mid-session, drop the preview flags so a
  // new member never lands on a blank surface (conversion card hidden by
  // `inExperience`, composer hidden by `$cheffyConversion`) and their
  // sends are no longer tagged as a preview.
  $: if (hasMembership && ($cheffyConversion !== null || $cheffyExperienceMode)) {
    cheffyConversion.set(null);
    cheffyExperienceMode.set(false);
  }
  // Opening Cheffy again after the experience was spent (e.g. via the
  // launcher) lands on the friendly card, never a technical wall.
  $: if (
    $cheffyOpen &&
    inExperience &&
    $cheffyExperienceUsed &&
    $cheffyThread.length === 0 &&
    $cheffyConversion === null
  ) {
    cheffyConversion.set('used');
  }
  // Gates apply only outside the experience flow.
  $: showSignInGate = !inExperience && !signedIn;
  $: showMembershipGate = !inExperience && signedIn && !hasMembership;

  function convCreateKitchen() {
    closeCheffy();
    goto('/login?redirect=/explore');
  }
  function convUnlockKitchenPlus() {
    closeCheffy();
    goto('/membership');
  }
  function convKeepExploring() {
    closeCheffy();
  }

  // ── Layout mode ────────────────────────────────────────────────
  let isDesktop = false; // ≥1024px → non-modal floating panel
  $: isModal = !isDesktop;

  let dialogEl: HTMLDivElement;
  let listEl: HTMLDivElement;
  let composerEl: HTMLTextAreaElement;

  // ── Composer ───────────────────────────────────────────────────
  let placeholderIndex = 0;
  let placeholderTimer: ReturnType<typeof setInterval>;
  $: placeholder = PROMPT_PLACEHOLDERS[placeholderIndex];
  $: canSend = $cheffyDraft.trim().length > 0 && !$cheffyLoading;

  async function autoSize() {
    await tick();
    if (!composerEl) return;
    composerEl.style.height = 'auto';
    composerEl.style.height = `${Math.min(composerEl.scrollHeight, 132)}px`;
  }
  $: if (browser) {
    $cheffyDraft;
    autoSize();
  }

  function onComposerKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) sendCheffy($cheffyDraft);
    }
  }

  // Scroll only the message list (never the page) as the thread grows.
  $: if (browser && $cheffyThread) scheduleScroll();
  function scheduleScroll() {
    tick().then(() => {
      if (listEl) listEl.scrollTop = listEl.scrollHeight;
    });
  }

  // ── Suggestions ────────────────────────────────────────────────
  // `send` chips fire immediately; `populate` chips drop text into the
  // composer for the user to finish (without clobbering an existing
  // draft). Contextual chips attach only to the latest response.
  $: lastMsgId = $cheffyThread[$cheffyThread.length - 1]?.id;

  async function handleSuggestion(s: CheffySuggestion) {
    if (s.behavior === 'send') {
      sendCheffy(s.prompt);
      return;
    }
    // populate: only seed the composer when it's empty so we never
    // overwrite what the user already typed.
    if ($cheffyDraft.trim().length === 0) {
      cheffyDraft.set(s.prompt);
    }
    await tick();
    if (composerEl) {
      composerEl.focus();
      const end = composerEl.value.length;
      composerEl.setSelectionRange(end, end);
    }
  }

  // ── Header overflow menu ───────────────────────────────────────
  let menuOpen = false;
  function openFullPage() {
    menuOpen = false;
    closeCheffy();
    goto('/cheffy');
  }

  // ── Attachment action sheet ────────────────────────────────────
  let attachOpen = false;
  let cameraInput: HTMLInputElement;
  let uploadInput: HTMLInputElement;
  let isScanning = false;
  let scanError = '';

  function pickUpload() {
    attachOpen = false;
    uploadInput?.click();
  }
  function pickCamera() {
    attachOpen = false;
    cameraInput?.click();
  }
  function handoffSousChef() {
    attachOpen = false;
    closeCheffy();
    goto('/souschef');
  }

  async function handleScan(event: Event) {
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
      const resp = await fetch('/api/zappy/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, pubkey: $userPublickey })
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) throw new Error(data.error || SCAN_ERROR_LINE);
      const ingredients: string[] = data.ingredients || [];
      if (ingredients.length > 0) {
        cheffyDraft.set(`I have: ${ingredients.join(', ')}`);
        await tick();
        composerEl?.focus();
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
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ── Open / close side effects ──────────────────────────────────
  let prevFocus: HTMLElement | null = null;
  let appScroll: HTMLElement | null = null;
  let savedOverflow = '';
  let wasOpen = false;

  function lockScroll() {
    appScroll = document.getElementById('app-scroll');
    if (appScroll) {
      savedOverflow = appScroll.style.overflow;
      // Lock the actual scroll container — scrollTop is retained, so the
      // homepage position is preserved and restored on close.
      appScroll.style.overflow = 'hidden';
    }
  }
  function unlockScroll() {
    if (appScroll) appScroll.style.overflow = savedOverflow;
    appScroll = null;
  }

  function syncViewport() {
    if (!browser || !dialogEl) return;
    const vv = window.visualViewport;
    if (vv && isModal) {
      dialogEl.style.setProperty('--cheffy-vh', `${vv.height}px`);
      dialogEl.style.setProperty('--cheffy-top', `${vv.offsetTop}px`);
    } else {
      dialogEl.style.removeProperty('--cheffy-vh');
      dialogEl.style.removeProperty('--cheffy-top');
    }
  }

  async function onOpen() {
    prevFocus = (document.activeElement as HTMLElement) ?? null;
    if (isModal) lockScroll();
    window.visualViewport?.addEventListener('resize', syncViewport);
    window.visualViewport?.addEventListener('scroll', syncViewport);
    await tick();
    syncViewport();
    // Focus the dialog (not the composer) so screen-reader users land
    // inside without forcing the mobile keyboard open immediately.
    dialogEl?.focus();
    scheduleScroll();
  }

  function onClose() {
    unlockScroll();
    window.visualViewport?.removeEventListener('resize', syncViewport);
    window.visualViewport?.removeEventListener('scroll', syncViewport);
    menuOpen = false;
    attachOpen = false;
    // Return focus to whatever opened the messenger. The header
    // IntelligenceMenu unmounts on selection, so its "Ask Cheffy" item
    // (the prevFocus at open time) is detached by now and .focus() would
    // no-op, dropping focus to <body>. Fall back to the header's stable
    // Intelligence trigger in that case so keyboard focus is never lost.
    const target =
      prevFocus && prevFocus.isConnected
        ? prevFocus
        : document.querySelector<HTMLElement>('.zh-intelligence-btn');
    target?.focus?.();
  }

  $: if (browser && $cheffyOpen !== wasOpen) {
    wasOpen = $cheffyOpen;
    if ($cheffyOpen) onOpen();
    else onClose();
  }

  // ── Focus trap (modal only) + Escape ───────────────────────────
  function onDialogKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (attachOpen) attachOpen = false;
      else if (menuOpen) menuOpen = false;
      else closeCheffy();
      return;
    }
    if (e.key !== 'Tab' || !isModal || !dialogEl) return;
    const nodes = dialogEl.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select,[tabindex]:not([tabindex="-1"])'
    );
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  onMount(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    isDesktop = mq.matches;
    const onMq = (e: MediaQueryListEvent) => {
      isDesktop = e.matches;
      syncViewport();
    };
    mq.addEventListener('change', onMq);

    placeholderTimer = setInterval(() => {
      placeholderIndex = (placeholderIndex + 1) % PROMPT_PLACEHOLDERS.length;
    }, 4000);

    return () => mq.removeEventListener('change', onMq);
  });

  onDestroy(() => {
    unsub();
    if (placeholderTimer) clearInterval(placeholderTimer);
    if (browser && $cheffyOpen) onClose();
  });
</script>

{#if $cheffyOpen}
  <!-- Backdrop: modal only (hidden on desktop so the page stays usable) -->
  <button
    type="button"
    class="cheffy-backdrop"
    aria-label="Close Cheffy"
    tabindex="-1"
    on:click={() => closeCheffy()}
  ></button>

  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <!-- The dialog handles Escape + Tab focus-trap; keydown here is correct. -->
  <div
    class="cheffy-dialog"
    bind:this={dialogEl}
    role="dialog"
    aria-modal={isModal}
    aria-labelledby="cheffy-dialog-title"
    tabindex="-1"
    on:keydown={onDialogKeydown}
  >
    <!-- sr-only live region for status -->
    <div class="sr-only" aria-live="polite" aria-atomic="true">{$cheffyAnnounce}</div>

    <!-- Drag handle (visual affordance for the mobile sheet) -->
    <div class="drag-handle" aria-hidden="true"><span></span></div>

    <!-- Fixed header -->
    <header class="cheffy-head">
      <div class="head-id">
        <CheffyAvatar size={30} expression="happy" />
        <div class="head-text">
          <span id="cheffy-dialog-title" class="head-title">Cheffy</span>
          <span class="head-sub">Kitchen companion</span>
        </div>
      </div>
      <div class="head-actions">
        <div class="menu-wrap">
          <button
            type="button"
            class="icon-btn"
            aria-label="Cheffy options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            on:click|stopPropagation={() => (menuOpen = !menuOpen)}
          >
            <DotsThreeIcon size={20} weight="bold" />
          </button>
          {#if menuOpen}
            <button
              class="menu-scrim"
              type="button"
              aria-label="Close menu"
              on:click={() => (menuOpen = false)}
            ></button>
            <div class="menu" role="menu">
              <button
                type="button"
                role="menuitem"
                class="menu-item"
                on:click={() => {
                  menuOpen = false;
                  startOverCheffy();
                }}
                disabled={$cheffyLoading || $cheffyThread.length === 0}
              >
                Start over
              </button>
              <button type="button" role="menuitem" class="menu-item" on:click={openFullPage}>
                Open full Cheffy
              </button>
            </div>
          {/if}
        </div>
        <button
          type="button"
          class="icon-btn"
          aria-label="Minimize Cheffy"
          on:click={() => closeCheffy()}
        >
          <CaretDownIcon size={20} weight="bold" />
        </button>
        <button
          type="button"
          class="icon-btn"
          aria-label="Close Cheffy"
          on:click={() => closeCheffy()}
        >
          <XIcon size={20} weight="bold" />
        </button>
      </div>
    </header>

    {#if showSignInGate}
      <!-- Sign-in gate -->
      <div class="cheffy-gate">
        <CheffyAvatar size={72} expression="neutral" variant="character" />
        <h2>Sign in to cook with Cheffy</h2>
        <p>Cheffy is your kitchen companion. Sign in to start a conversation.</p>
        <button
          type="button"
          class="primary-btn"
          on:click={() => {
            closeCheffy();
            goto('/login?redirect=/explore');
          }}
        >
          Sign in
        </button>
      </div>
    {:else if showMembershipGate}
      <!-- Membership gate -->
      <div class="cheffy-gate">
        <CheffyAvatar size={72} expression="neutral" variant="character" />
        <h2>Cheffy is a Pro Kitchen feature</h2>
        <p>Ask cooking questions, use what you have, fix a mistake, or turn an idea into dinner.</p>
        <button
          type="button"
          class="primary-btn"
          on:click={() => {
            closeCheffy();
            goto('/membership');
          }}
        >
          View membership
        </button>
      </div>
    {:else}
      <!-- Conversation -->
      <div class="cheffy-list" bind:this={listEl}>
        {#if $cheffyThread.length === 0 && !$cheffyConversion}
          <!-- Minimal welcome — the starter chips live above the
               composer, not here, so users can also just start typing. -->
          <div class="welcome">
            <CheffyAvatar size={64} expression="happy" variant="character" />
            <p class="welcome-q">What are we cooking?</p>
            <p class="welcome-sub">Ask anything, or pick a place to start.</p>
          </div>
        {:else}
          {#each $cheffyThread as m (m.id)}
            {#if m.role === 'user'}
              <div class="msg msg-user"><div class="bubble-user">{m.content}</div></div>
            {:else}
              <div class="msg msg-cheffy">
                <CheffyAvatar
                  size={28}
                  expression={m.expression ?? 'neutral'}
                  animate={m.kind === 'pending'}
                />
                <div class="cheffy-side">
                  {#if m.kind === 'pending'}
                    <div class="pending">
                      <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
                      <span class="status">{m.statusLine}</span>
                    </div>
                  {:else if m.kind === 'error'}
                    <div class="err">
                      <p class="err-line">{m.statusLine}</p>
                      <p class="err-detail">{m.content}</p>
                      <button
                        type="button"
                        class="retry"
                        on:click={() => retryCheffy()}
                        disabled={$cheffyLoading}
                      >
                        <ArrowsClockwiseIcon size={13} /> Try again
                      </button>
                    </div>
                  {:else if m.kind === 'recipe'}
                    <CheffyRecipeCard content={m.content} />
                  {:else}
                    <div class="cheffy-text prose dark:prose-invert max-w-none">
                      <!-- Sanitized via parseMarkdown → sanitizeHTML. -->
                      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                      {@html parseMarkdown(m.content)}
                    </div>
                  {/if}

                  <!-- Context-aware follow-ups: only under the latest
                       response, never while a turn is in flight, and not
                       during the non-member preview (the composer carries
                       the preview turns). -->
                  {#if m.id === lastMsgId && !$cheffyLoading && !inExperience && (m.kind === 'text' || m.kind === 'recipe')}
                    <div class="context-row">
                      <CheffySuggestionChips
                        compact
                        suggestions={m.kind === 'recipe' ? CONTEXT_RECIPE : CONTEXT_GENERAL}
                        ariaLabel="Follow-up suggestions"
                        onSelect={handleSuggestion}
                      />
                    </div>
                  {/if}
                </div>
              </div>
            {/if}
          {/each}
        {/if}

        {#if inExperience && $cheffyConversion}
          <!-- Soft conversion card — shown once the preview turns are
               spent (or when the experience was already used): invites the
               visitor to create a free kitchen or unlock Kitchen+. Never a
               paywall — this is the gentle next step. -->
          <div class="conversion" role="group" aria-label="Keep cooking with Cheffy">
            <CheffyAvatar size={44} expression="happy" variant="character" />
            {#if $cheffyConversion === 'used'}
              <h3 class="conv-title">Cheffy already helped you get started</h3>
              <p class="conv-body">
                Create your free kitchen to save ideas, or unlock Kitchen+ to keep cooking with
                Cheffy.
              </p>
            {:else if signedIn}
              <h3 class="conv-title">Keep cooking with Cheffy</h3>
              <p class="conv-body">
                Kitchen+ gives you Cheffy, Nourish, saved drafts, recipe tools, and more ways to
                build your kitchen.
              </p>
            {:else}
              <h3 class="conv-title">Save this to your kitchen</h3>
              <p class="conv-body">
                Create a free Zap Cooking account to save meals, follow cooks, and come back to what
                Cheffy helped you make.
              </p>
            {/if}
            <div class="conv-actions">
              {#if !signedIn}
                <button type="button" class="conv-primary" on:click={convCreateKitchen}>
                  Create your free kitchen
                </button>
                <button type="button" class="conv-secondary" on:click={convUnlockKitchenPlus}>
                  Unlock Kitchen+
                </button>
              {:else}
                <button type="button" class="conv-primary" on:click={convUnlockKitchenPlus}>
                  Unlock Kitchen+
                </button>
              {/if}
              <button type="button" class="conv-ghost" on:click={convKeepExploring}>
                Keep exploring
              </button>
            </div>
          </div>
        {/if}
      </div>

      <!-- Starter suggestions — a single scrollable row directly above
           the composer; removed once the conversation begins or the
           conversion card takes over. -->
      {#if $cheffyThread.length === 0 && !$cheffyConversion}
        <div class="starter-row">
          <CheffySuggestionChips
            suggestions={STARTER_SUGGESTIONS}
            ariaLabel="Cheffy conversation suggestions"
            onSelect={handleSuggestion}
          />
        </div>
      {/if}

      <!-- Composer — usable during a member chat and during the preview
           turns; replaced by the conversion card once they're spent. -->
      {#if !$cheffyConversion}
        <!-- Fixed composer -->
        <div class="cheffy-composer">
          {#if scanError}
            <p class="scan-error" role="alert">{scanError}</p>
          {/if}
          <div class="composer-row">
            {#if !inExperience}
              <!-- Attach (scan / photo / paste) is a member-only tool. -->
              <button
                type="button"
                class="composer-icon"
                aria-label="Add ingredients, photo, or recipe"
                aria-haspopup="menu"
                aria-expanded={attachOpen}
                on:click|stopPropagation={() => (attachOpen = !attachOpen)}
                disabled={isScanning}
              >
                {#if isScanning}
                  <ArrowsClockwiseIcon size={20} class="animate-spin" />
                {:else}
                  <PaperclipIcon size={20} />
                {/if}
              </button>
            {/if}
            <label class="sr-only" for="cheffy-composer-input">Message Cheffy</label>
            <textarea
              id="cheffy-composer-input"
              bind:this={composerEl}
              bind:value={$cheffyDraft}
              rows="1"
              class="composer-input"
              {placeholder}
              disabled={$cheffyLoading}
              on:keydown={onComposerKeydown}
            ></textarea>
            <button
              type="button"
              class="composer-send"
              aria-label="Send message"
              disabled={!canSend}
              on:click={() => sendCheffy($cheffyDraft)}
            >
              {#if $cheffyLoading}
                <ArrowsClockwiseIcon size={18} class="animate-spin" />
              {:else}
                <PaperPlaneIcon size={18} weight="fill" />
              {/if}
            </button>
          </div>
        </div>

        {#if !inExperience}
          <!-- Hidden file inputs for scan/photo/upload -->
          <input
            bind:this={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            class="hidden"
            on:change={handleScan}
          />
          <input
            bind:this={uploadInput}
            type="file"
            accept="image/*"
            class="hidden"
            on:change={handleScan}
          />

          <!-- Attachment action sheet -->
          {#if attachOpen}
            <button
              class="attach-scrim"
              aria-label="Close attachment menu"
              on:click={() => (attachOpen = false)}
            ></button>
            <div class="attach-sheet" role="menu" aria-label="Add to Cheffy">
              <button type="button" role="menuitem" class="attach-item" on:click={pickUpload}>
                <ScanIcon size={20} /> Scan ingredients
              </button>
              <button type="button" role="menuitem" class="attach-item" on:click={pickCamera}>
                <CameraIcon size={20} /> Take a photo
              </button>
              <button type="button" role="menuitem" class="attach-item" on:click={pickUpload}>
                <ImageIcon size={20} /> Upload an image
              </button>
              <button type="button" role="menuitem" class="attach-item" on:click={handoffSousChef}>
                <ClipboardIcon size={20} /> Paste a recipe
              </button>
              <button type="button" role="menuitem" class="attach-item" on:click={handoffSousChef}>
                <LinkIcon size={20} /> Import a link
              </button>
            </div>
          {/if}
        {/if}
      {/if}
    {/if}
  </div>
{/if}

<style>
  .cheffy-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 9989;
    animation: cheffy-fade 160ms ease-out;
  }

  .cheffy-dialog {
    position: fixed;
    z-index: 9990;
    display: flex;
    flex-direction: column;
    background-color: var(--color-bg-primary);
    color: var(--color-text-primary);
    overflow: hidden;
    outline: none;

    /* Mobile (default): full-screen bottom sheet. Height tracks the
       visual viewport so the composer rides above the keyboard. */
    left: 0;
    right: 0;
    top: var(--cheffy-top, 0px);
    height: var(--cheffy-vh, 100dvh);
    width: 100%;
    border-radius: 18px 18px 0 0;
    animation: cheffy-slide-up 220ms ease-out;
  }

  /* Tablet: centered modal, capped width/height. */
  @media (min-width: 640px) {
    .cheffy-dialog {
      left: 50%;
      right: auto;
      top: 50%;
      transform: translate(-50%, -50%);
      width: min(640px, 92vw);
      height: min(var(--cheffy-vh, 86dvh), 720px);
      border-radius: 18px;
      animation: cheffy-pop 180ms ease-out;
    }
  }

  /* Desktop: bottom-right floating panel; page behind stays usable. */
  @media (min-width: 1024px) {
    .cheffy-backdrop {
      display: none;
    }
    .cheffy-dialog {
      left: auto;
      top: auto;
      transform: none;
      right: 1.5rem;
      bottom: 1.5rem;
      width: 400px;
      height: min(620px, 82vh);
      border-radius: 18px;
      box-shadow:
        0 18px 48px rgba(0, 0, 0, 0.3),
        0 4px 12px rgba(0, 0, 0, 0.18);
      animation: cheffy-pop 180ms ease-out;
    }
  }

  .drag-handle {
    display: flex;
    justify-content: center;
    padding-top: calc(env(safe-area-inset-top, 0px) + 8px);
    padding-bottom: 2px;
    flex-shrink: 0;
  }
  .drag-handle span {
    width: 38px;
    height: 4px;
    border-radius: 999px;
    background: var(--color-accent-gray);
  }
  /* The handle reads as a sheet affordance on mobile; on the centered
     modal / desktop panel it just disappears (no top safe-area inset). */
  @media (min-width: 640px) {
    .drag-handle {
      padding-top: 8px;
    }
    .drag-handle span {
      display: none;
    }
  }

  .cheffy-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 12px 10px;
    border-bottom: 1px solid var(--color-input-border);
    flex-shrink: 0;
  }
  .head-id {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }
  .head-text {
    display: flex;
    flex-direction: column;
    line-height: 1.15;
    min-width: 0;
  }
  .head-title {
    font-size: 0.95rem;
    font-weight: 700;
  }
  .head-sub {
    font-size: 0.72rem;
    color: var(--color-text-secondary);
  }
  .head-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 999px;
    background: transparent;
    border: 0;
    color: var(--color-text-primary);
    cursor: pointer;
    transition: background-color 140ms ease;
  }
  .icon-btn:hover {
    background-color: var(--color-input-bg);
  }
  .menu-wrap {
    position: relative;
  }
  .menu-scrim {
    position: fixed;
    inset: 0;
    z-index: 4;
    background: transparent;
    border: 0;
    cursor: default;
  }
  .menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 168px;
    padding: 5px;
    border-radius: 12px;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.3);
    z-index: 5;
  }
  .menu-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 9px 10px;
    border-radius: 8px;
    background: transparent;
    border: 0;
    color: var(--color-text-primary);
    font-size: 0.875rem;
    cursor: pointer;
  }
  .menu-item:hover:not(:disabled) {
    background-color: var(--color-input-bg);
  }
  .menu-item:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ── Gates ─────────────────────────────────────────────────── */
  .cheffy-gate {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    text-align: center;
    padding: 24px;
  }
  .cheffy-gate h2 {
    font-size: 1.1rem;
    font-weight: 700;
    margin: 0;
  }
  .cheffy-gate p {
    font-size: 0.9rem;
    color: var(--color-text-secondary);
    margin: 0;
    max-width: 30ch;
  }

  /* ── Message list (the only scroll area) ───────────────────── */
  .cheffy-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
  }

  .welcome {
    margin: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    text-align: center;
    padding: 8px 0;
  }
  .welcome-q {
    font-size: 1.25rem;
    font-weight: 700;
    margin: 0;
  }
  .welcome-sub {
    font-size: 0.9rem;
    color: var(--color-text-secondary);
    margin: 0;
    max-width: 28ch;
  }

  /* Starter chip row — sits directly above the composer, secondary to
     it. The chips component handles the horizontal scroll + edge fade. */
  .starter-row {
    flex-shrink: 0;
    padding: 6px 0 2px;
  }
  /* Contextual follow-ups under the latest response. Negative inset
     lets the row use the message column's full width for scrolling. */
  .context-row {
    margin: 8px -4px 0;
  }

  .msg {
    display: flex;
    min-width: 0;
  }
  .msg-user {
    justify-content: flex-end;
  }
  .bubble-user {
    max-width: 85%;
    padding: 9px 13px;
    border-radius: 15px 15px 4px 15px;
    background-color: var(--color-primary);
    color: #fff;
    font-size: 0.92rem;
    line-height: 1.4;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .msg-cheffy {
    gap: 8px;
    align-items: flex-start;
  }
  .cheffy-side {
    min-width: 0;
    flex: 1;
  }
  .pending {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    padding: 9px 13px;
    border-radius: 15px 15px 15px 4px;
    background-color: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    color: var(--color-text-secondary);
    font-size: 0.88rem;
  }
  .dots {
    display: inline-flex;
    gap: 3px;
  }
  .dots i {
    width: 5px;
    height: 5px;
    border-radius: 999px;
    background-color: var(--color-primary);
    animation: cheffy-typing 1.2s ease-in-out infinite;
  }
  .dots i:nth-child(2) {
    animation-delay: 0.2s;
  }
  .dots i:nth-child(3) {
    animation-delay: 0.4s;
  }
  .cheffy-text {
    padding: 9px 13px;
    border-radius: 15px 15px 15px 4px;
    background-color: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    color: var(--color-text-primary);
    font-size: 0.92rem;
    line-height: 1.5;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .cheffy-text :global(p) {
    margin: 0.3rem 0;
  }
  .cheffy-text :global(p:first-child) {
    margin-top: 0;
  }
  .cheffy-text :global(p:last-child) {
    margin-bottom: 0;
  }
  .cheffy-text :global(ul),
  .cheffy-text :global(ol) {
    margin: 0.3rem 0;
    padding-left: 1.2rem;
  }
  .cheffy-text :global(pre) {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .err {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 11px 13px;
    border-radius: 15px 15px 15px 4px;
    background-color: color-mix(in srgb, #ef4444 8%, var(--color-bg-secondary));
    border: 1px solid color-mix(in srgb, #ef4444 30%, transparent);
  }
  .err-line {
    font-size: 0.9rem;
    font-weight: 600;
    margin: 0;
  }
  .err-detail {
    font-size: 0.78rem;
    color: var(--color-text-secondary);
    margin: 0;
    overflow-wrap: anywhere;
  }
  .retry {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-top: 2px;
    padding: 5px 11px;
    border-radius: 999px;
    border: 1px solid var(--color-input-border);
    background: transparent;
    color: var(--color-primary);
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
  }
  .retry:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ── Composer (fixed above the keyboard) ───────────────────── */
  .cheffy-composer {
    flex-shrink: 0;
    border-top: 1px solid var(--color-input-border);
    padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px));
    background-color: var(--color-bg-primary);
  }
  .scan-error {
    margin: 0 0 8px;
    font-size: 0.8rem;
    color: #ef4444;
  }
  .composer-row {
    display: flex;
    align-items: flex-end;
    gap: 6px;
  }
  .composer-icon,
  .composer-send {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    border-radius: 999px;
    border: 0;
    cursor: pointer;
  }
  .composer-icon {
    background: transparent;
    color: var(--color-text-secondary);
  }
  .composer-icon:hover:not(:disabled) {
    background-color: var(--color-input-bg);
  }
  .composer-send {
    background-color: var(--color-primary);
    color: #fff;
    transition: filter 140ms ease;
  }
  .composer-send:hover:not(:disabled) {
    filter: brightness(1.06);
  }
  .composer-icon:disabled,
  .composer-send:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .composer-input {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    max-height: 132px;
    padding: 11px 14px;
    border-radius: 18px;
    border: 1px solid var(--color-input-border);
    background-color: var(--color-input-bg);
    color: var(--color-text-primary);
    font-size: 16px; /* ≥16px stops iOS zoom-on-focus */
    line-height: 1.35;
    resize: none;
    overflow-y: auto;
  }
  .composer-input:focus {
    outline: none;
    border-color: var(--color-primary);
  }

  /* ── Attachment action sheet ───────────────────────────────── */
  .attach-scrim {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.25);
    border: 0;
    z-index: 6;
    cursor: default;
  }
  .attach-sheet {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 7;
    display: flex;
    flex-direction: column;
    padding: 8px 8px calc(12px + env(safe-area-inset-bottom, 0px));
    background-color: var(--color-bg-secondary);
    border-top: 1px solid var(--color-input-border);
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -8px 28px rgba(0, 0, 0, 0.25);
    animation: cheffy-slide-up 180ms ease-out;
  }
  .attach-item {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 48px;
    padding: 0 14px;
    border-radius: 12px;
    background: transparent;
    border: 0;
    color: var(--color-text-primary);
    font-size: 0.95rem;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
  }
  .attach-item:hover {
    background-color: var(--color-input-bg);
  }

  .primary-btn {
    min-height: 44px;
    padding: 0 20px;
    border-radius: 999px;
    border: 0;
    background-color: var(--color-primary);
    color: #fff;
    font-weight: 600;
    font-size: 0.95rem;
    cursor: pointer;
  }

  /* ── Soft conversion card (post-experience) ────────────────── */
  .conversion {
    margin: 6px auto 4px;
    width: 100%;
    max-width: 30ch;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    text-align: center;
    padding: 18px 16px;
    border-radius: 16px;
    background-color: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
  }
  .conv-title {
    font-size: 1.05rem;
    font-weight: 700;
    margin: 0;
    color: var(--color-text-primary);
  }
  .conv-body {
    font-size: 0.88rem;
    line-height: 1.45;
    color: var(--color-text-secondary);
    margin: 0;
  }
  .conv-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    margin-top: 4px;
  }
  .conv-primary,
  .conv-secondary,
  .conv-ghost {
    min-height: 44px;
    padding: 0 18px;
    border-radius: 999px;
    font-weight: 600;
    font-size: 0.9rem;
    cursor: pointer;
  }
  .conv-primary {
    border: 0;
    background-color: var(--color-primary);
    color: #fff;
    transition: filter 140ms ease;
  }
  .conv-primary:hover {
    filter: brightness(1.06);
  }
  .conv-secondary {
    background: transparent;
    border: 1px solid var(--color-primary);
    color: var(--color-primary);
    transition: background-color 140ms ease;
  }
  .conv-secondary:hover {
    background-color: color-mix(in srgb, var(--color-primary) 10%, transparent);
  }
  .conv-ghost {
    background: transparent;
    border: 0;
    color: var(--color-text-secondary);
  }
  .conv-ghost:hover {
    color: var(--color-text-primary);
  }

  @keyframes cheffy-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes cheffy-slide-up {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
  @keyframes cheffy-pop {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes cheffy-typing {
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
    .cheffy-dialog,
    .cheffy-backdrop,
    .attach-sheet {
      animation: none;
    }
    .dots i {
      animation: none;
      opacity: 0.6;
    }
  }
</style>
