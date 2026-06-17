<script lang="ts">
  /**
   * First-use Cheffy experience invite — Explore page only.
   *
   * Product principle: do NOT sell Cheffy before the visitor experiences
   * Cheffy. This is a gentle, dismissible nudge that lets a logged-out
   * visitor or a logged-in non-member feel one helpful Cheffy interaction
   * first; the membership pitch only appears AFTER Cheffy responds (the
   * conversion card lives in the messenger). It deliberately never says
   * "free question", "trial", or "limited access".
   *
   *  - Desktop (≥1024px): small floating card, bottom-right.
   *  - Mobile/tablet: bottom sheet.
   * Non-blocking, keyboard accessible, respects reduced motion. Shown
   * after a short delay or when the visitor scrolls near the
   * "What are you cooking?" area, and never again once dismissed/used.
   */
  import { onMount, onDestroy, tick } from 'svelte';
  import { browser } from '$app/environment';
  import { userPublickey } from '$lib/nostr';
  import {
    membershipStatusMap,
    queueMembershipLookup,
    type MembershipStatus
  } from '$lib/stores/membershipStatus';
  import { startCheffyExperience, cheffyExperienceUsed } from '$lib/stores/cheffyChat';
  import CheffyAvatar from './CheffyAvatar.svelte';
  import XIcon from 'phosphor-svelte/lib/X';

  const DISMISS_KEY = 'zapcooking:cheffy-experience-dismissed:v1';
  const REVEAL_DELAY_MS = 6500;

  // Quick chips — each opens Cheffy and sends one actionable prompt that
  // returns something useful (a real recipe), not just a conversation.
  const CHIPS: { label: string; prompt: string; mode: 'chat' | 'hungry' }[] = [
    { label: 'Recipe for chicken', prompt: 'Give me a recipe for chicken.', mode: 'chat' },
    {
      label: 'Quick weeknight dinner',
      prompt: 'Give me a quick weeknight dinner recipe I can make in about 30 minutes.',
      mode: 'chat'
    },
    { label: 'Surprise me', prompt: '', mode: 'hungry' }
  ];

  let dismissed = browser ? localStorage.getItem(DISMISS_KEY) === '1' : true;
  let engaged = false; // started the experience this session → hide
  let revealed = false; // delay/scroll trigger has fired
  let draft = '';
  let inputEl: HTMLInputElement;

  // ── Membership: only non-members are eligible ───────────────────
  let membershipMap: Record<string, MembershipStatus> = {};
  const unsub = membershipStatusMap.subscribe((v) => (membershipMap = v));
  $: if ($userPublickey) queueMembershipLookup($userPublickey);
  $: normalizedPk = String($userPublickey || '')
    .trim()
    .toLowerCase();
  $: isMember = Boolean($userPublickey && membershipMap[normalizedPk]?.active);

  // Logged-out OR logged-in non-member, not dismissed, not already used.
  $: eligible = !isMember && !dismissed && !engaged && !$cheffyExperienceUsed;
  $: visible = revealed && eligible;

  let revealTimer: ReturnType<typeof setTimeout>;
  let io: IntersectionObserver | undefined;

  function reveal() {
    revealed = true;
  }

  function persistDismiss() {
    if (!browser) return;
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // storage blocked — invite simply reappears next session
    }
  }

  function dismiss() {
    dismissed = true;
    persistDismiss();
  }

  async function start(prompt: string, mode: 'chat' | 'hungry') {
    engaged = true; // hide the invite; the messenger takes over
    persistDismiss(); // don't re-nudge after they've engaged
    await tick();
    startCheffyExperience(prompt, mode);
  }

  function helpMeCook() {
    const text = draft.trim();
    // Empty input → a "surprise me" recipe still gives a useful answer.
    if (text) start(text, 'chat');
    else start('', 'hungry');
  }

  function onInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      helpMeCook();
    }
  }

  function onCardKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
    }
  }

  onMount(() => {
    if (!browser) return;
    revealTimer = setTimeout(reveal, REVEAL_DELAY_MS);

    // Reveal early if the visitor scrolls near the "What are you cooking?"
    // area (anchored on the Explore page).
    const anchor = document.querySelector('[data-cheffy-invite-anchor]');
    if (anchor && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) reveal();
        },
        { root: document.getElementById('app-scroll'), threshold: 0.15 }
      );
      io.observe(anchor);
    }
  });

  onDestroy(() => {
    unsub();
    if (revealTimer) clearTimeout(revealTimer);
    io?.disconnect();
  });
</script>

{#if visible}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <aside class="invite" aria-labelledby="cheffy-invite-title" on:keydown={onCardKeydown}>
    <button type="button" class="invite-close" aria-label="Dismiss" on:click={dismiss}>
      <XIcon size={16} weight="bold" />
    </button>

    <div class="invite-head">
      <CheffyAvatar size={30} expression="happy" />
      <h2 id="cheffy-invite-title" class="invite-title">Need dinner ideas?</h2>
    </div>
    <p class="invite-body">Cheffy can help you find something worth cooking.</p>

    <div class="invite-input-row">
      <label class="sr-only" for="cheffy-invite-input">What are you hungry for?</label>
      <input
        id="cheffy-invite-input"
        bind:this={inputEl}
        bind:value={draft}
        type="text"
        class="invite-input"
        placeholder="What are you hungry for?"
        on:keydown={onInputKeydown}
        maxlength="200"
      />
    </div>

    <div class="invite-chips" role="group" aria-label="Quick ideas">
      {#each CHIPS as chip}
        <button type="button" class="invite-chip" on:click={() => start(chip.prompt, chip.mode)}>
          {chip.label}
        </button>
      {/each}
    </div>

    <div class="invite-actions">
      <button type="button" class="invite-primary" on:click={helpMeCook}>Help me cook</button>
      <button type="button" class="invite-ghost" on:click={dismiss}>Keep exploring</button>
    </div>
  </aside>
{/if}

<style>
  .invite {
    position: fixed;
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background-color: var(--color-bg-secondary);
    color: var(--color-text-primary);
    border: 1px solid var(--color-input-border);

    /* Mobile/tablet: bottom sheet. */
    left: 0;
    right: 0;
    bottom: 0;
    padding: 18px 18px calc(18px + env(safe-area-inset-bottom, 0px));
    border-radius: 18px 18px 0 0;
    box-shadow: 0 -10px 32px rgba(0, 0, 0, 0.22);
    animation: invite-slide-up 240ms ease-out;
  }

  /* Desktop: compact floating card, bottom-right. */
  @media (min-width: 1024px) {
    .invite {
      left: auto;
      right: 1.5rem;
      bottom: 1.5rem;
      width: 340px;
      padding: 18px;
      border-radius: 18px;
      box-shadow:
        0 18px 48px rgba(0, 0, 0, 0.28),
        0 4px 12px rgba(0, 0, 0, 0.16);
      animation: invite-pop 180ms ease-out;
    }
  }

  .invite-close {
    position: absolute;
    top: 10px;
    right: 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 999px;
    border: 0;
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: background-color 140ms ease;
  }
  .invite-close:hover {
    background-color: var(--color-input-bg);
  }

  .invite-head {
    display: flex;
    align-items: center;
    gap: 9px;
    padding-right: 32px;
  }
  .invite-title {
    font-size: 1.05rem;
    font-weight: 700;
    margin: 0;
  }
  .invite-body {
    font-size: 0.9rem;
    line-height: 1.4;
    color: var(--color-text-secondary);
    margin: 0;
  }

  .invite-input {
    width: 100%;
    min-height: 44px;
    padding: 11px 14px;
    border-radius: 12px;
    border: 1px solid var(--color-input-border);
    background-color: var(--color-input-bg);
    color: var(--color-text-primary);
    font-size: 16px; /* ≥16px avoids iOS zoom-on-focus */
    line-height: 1.35;
  }
  .invite-input:focus {
    outline: none;
    border-color: var(--color-primary);
  }

  .invite-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
  }
  .invite-chip {
    min-height: 36px;
    padding: 0 13px;
    border-radius: 999px;
    border: 1px solid var(--color-input-border);
    background-color: var(--color-bg-primary);
    color: var(--color-text-primary);
    font-size: 0.84rem;
    font-weight: 500;
    cursor: pointer;
    transition:
      border-color 140ms ease,
      background-color 140ms ease;
  }
  .invite-chip:hover {
    border-color: var(--color-primary);
    background-color: color-mix(in srgb, var(--color-primary) 8%, transparent);
  }

  .invite-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 2px;
  }
  .invite-primary {
    flex: 1;
    min-height: 44px;
    padding: 0 18px;
    border-radius: 999px;
    border: 0;
    background-color: var(--color-primary);
    color: #fff;
    font-weight: 600;
    font-size: 0.92rem;
    cursor: pointer;
    transition: filter 140ms ease;
  }
  .invite-primary:hover {
    filter: brightness(1.06);
  }
  .invite-ghost {
    min-height: 44px;
    padding: 0 14px;
    border-radius: 999px;
    border: 0;
    background: transparent;
    color: var(--color-text-secondary);
    font-weight: 600;
    font-size: 0.9rem;
    cursor: pointer;
  }
  .invite-ghost:hover {
    color: var(--color-text-primary);
  }

  .invite-close:focus-visible,
  .invite-chip:focus-visible,
  .invite-primary:focus-visible,
  .invite-ghost:focus-visible,
  .invite-input:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 45%, transparent);
  }

  @keyframes invite-slide-up {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
  @keyframes invite-pop {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .invite {
      animation: none;
    }
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
