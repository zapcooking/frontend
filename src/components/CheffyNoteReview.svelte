<script lang="ts">
  /**
   * Cheffy Note Photo Review modal (Phase 2).
   *
   * Draft-only in this phase: the member picks a mode, Cheffy drafts a
   * comment or recipe from the note's photo, and the member edits it in
   * place. Posting is Phase 3 — the Post button ships dark behind
   * NOTE_REVIEW_POST_ENABLED. Multi-image notes use the first image;
   * the picker strip is Phase 4.
   *
   * All branching logic (phase transitions, error mapping, hedged
   * copy) lives in $lib/noteReview so it stays unit-testable.
   */
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { goto } from '$app/navigation';
  import Modal from './Modal.svelte';
  import CheffyAvatar from './CheffyAvatar.svelte';
  import { ndk, userPublickey } from '$lib/nostr';
  import { membershipStatusMap, queueMembershipLookup } from '$lib/stores/membershipStatus';
  import { THINKING_LINES, COOKING_LINES, ERROR_LINES, pickLine } from '$lib/cheffy';
  import {
    requestNoteReview,
    phaseForResult,
    NOTE_REVIEW_POST_ENABLED,
    type NoteReviewMode,
    type NoteReviewPhase
  } from '$lib/noteReview';

  export let open = false;
  export let event: NDKEvent;
  export let imageUrls: string[] = [];

  // Multi-image notes default to the first image (picker strip: Phase 4).
  $: imageUrl = imageUrls[0] ?? '';

  let phase: NoteReviewPhase = 'choose';
  let mode: NoteReviewMode = 'comment';
  let draft = '';
  let message = '';
  let loadingLine = '';
  let errorLine = '';

  $: signedIn = $userPublickey !== '';
  $: normalizedPk = $userPublickey.trim().toLowerCase();
  $: if ($userPublickey) queueMembershipLookup($userPublickey);
  $: hasMembership = Boolean($membershipStatusMap[normalizedPk]?.active);

  async function run(selected: NoteReviewMode) {
    mode = selected;
    phase = 'signing';
    loadingLine = pickLine(selected === 'recipe' ? COOKING_LINES : THINKING_LINES, loadingLine);
    const result = await requestNoteReview({
      ndk: $ndk,
      imageUrl,
      noteText: event?.content,
      mode: selected,
      noteId: event?.id,
      // Non-members go through the server-enforced preview budget.
      experience: signedIn && !hasMembership,
      onSigned: () => (phase = 'loading')
    });
    if (result.ok) draft = result.output;
    const next = phaseForResult(result);
    phase = next.phase;
    message = next.message;
    if (phase === 'error') errorLine = pickLine(ERROR_LINES, errorLine);
  }

  function reset() {
    phase = 'choose';
    draft = '';
    message = '';
  }

  function signIn() {
    open = false;
    goto('/login?redirect=' + encodeURIComponent(window.location.pathname));
  }

  function viewMembership() {
    open = false;
    goto('/membership');
  }
</script>

<Modal bind:open cleanup={reset}>
  <div slot="title" class="nr-title">
    <CheffyAvatar
      size={28}
      expression={phase === 'signing' || phase === 'loading' ? 'cooking' : 'happy'}
      animate={phase === 'signing' || phase === 'loading'}
    />
    <span>Ask Cheffy about this dish</span>
  </div>

  <div class="nr-body">
    {#if !signedIn}
      <div class="nr-gate">
        <CheffyAvatar size={72} expression="neutral" variant="character" />
        <h2>Sign in to ask Cheffy</h2>
        <p>Cheffy can draft a friendly reply or guess the recipe — you edit and sign it.</p>
        <button type="button" class="nr-primary" on:click={signIn}>Sign in</button>
      </div>
    {:else if phase === 'choose'}
      {#if imageUrl}
        <img class="nr-thumb" src={imageUrl} alt="Dish from the note" loading="lazy" />
      {/if}
      <p class="nr-hint">What should Cheffy draft? You'll edit it before anything is posted.</p>
      <div class="nr-choices">
        <button type="button" class="nr-choice" on:click={() => run('comment')}>
          <span class="nr-choice-title">Say something nice</span>
          <span class="nr-choice-sub">A short, warm reply about the dish</span>
        </button>
        <button type="button" class="nr-choice" on:click={() => run('recipe')}>
          <span class="nr-choice-title">Guess the recipe</span>
          <span class="nr-choice-sub">Reverse-engineer it from the photo</span>
        </button>
      </div>
    {:else if phase === 'signing'}
      <div class="nr-wait">
        <CheffyAvatar size={64} expression="thinking" variant="character" animate />
        <p>Waiting for your signer to approve…</p>
        <p class="nr-sub">Using a remote signer? This can take a few seconds.</p>
      </div>
    {:else if phase === 'loading'}
      <div class="nr-wait">
        <CheffyAvatar size={64} expression="cooking" variant="character" animate />
        <p>{loadingLine}</p>
      </div>
    {:else if phase === 'draft'}
      <p class="nr-hint">
        Cheffy's draft — make it yours. {#if !NOTE_REVIEW_POST_ENABLED}Copy it into a reply for now;
          one-tap posting is coming soon.{/if}
      </p>
      <textarea
        class="nr-draft"
        class:nr-draft-recipe={mode === 'recipe'}
        bind:value={draft}
        rows={mode === 'recipe' ? 16 : 5}
        aria-label="Cheffy's draft"
      ></textarea>
      <div class="nr-actions">
        <button type="button" class="nr-secondary" on:click={() => run(mode)}>Regenerate</button>
        <button type="button" class="nr-ghost" on:click={reset}>Start over</button>
        {#if NOTE_REVIEW_POST_ENABLED}
          <!-- Phase 3 wires this to postComment(); flag-guarded until then. -->
          <button type="button" class="nr-primary" disabled>Post reply</button>
        {/if}
      </div>
    {:else if phase === 'dead-end'}
      <div class="nr-wait">
        <CheffyAvatar size={64} expression="concerned" variant="character" />
        <p>{message}</p>
        <button type="button" class="nr-ghost" on:click={reset}>Back</button>
      </div>
    {:else if phase === 'upsell'}
      <div class="nr-gate">
        <CheffyAvatar size={72} expression="neutral" variant="character" />
        <h2>Cheffy photo review is a Pro Kitchen feature</h2>
        <p>Get a drafted reply or a recipe guess for any dish photo on the feed.</p>
        <button type="button" class="nr-primary" on:click={viewMembership}>View membership</button>
      </div>
    {:else if phase === 'preview-used'}
      <div class="nr-gate">
        <CheffyAvatar size={72} expression="happy" variant="character" />
        <h2>Cheffy already gave your previews a look</h2>
        <p>Unlock Pro Kitchen to keep asking Cheffy about dishes on the feed.</p>
        <button type="button" class="nr-primary" on:click={viewMembership}>View membership</button>
        <button type="button" class="nr-ghost" on:click={() => (open = false)}
          >Keep exploring</button
        >
      </div>
    {:else}
      <div class="nr-wait">
        <CheffyAvatar size={64} expression="concerned" variant="character" />
        <p>{errorLine}</p>
        {#if message}<p class="nr-sub">{message}</p>{/if}
        <div class="nr-actions">
          <button type="button" class="nr-secondary" on:click={() => run(mode)}>Try again</button>
          <button type="button" class="nr-ghost" on:click={reset}>Back</button>
        </div>
      </div>
    {/if}
  </div>
</Modal>

<style>
  .nr-title {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .nr-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 4px 0;
    max-width: 560px;
  }

  .nr-thumb {
    width: 100%;
    max-height: 220px;
    object-fit: cover;
    border-radius: 12px;
  }

  .nr-hint {
    color: var(--color-text-secondary);
    font-size: 0.9rem;
  }

  .nr-choices {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .nr-choice {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 12px 16px;
    min-height: 44px;
    border: 1px solid var(--color-input-border);
    border-radius: 12px;
    background: transparent;
    color: var(--color-text-primary);
    text-align: left;
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      background-color 0.15s ease;
  }

  .nr-choice:hover {
    border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 6%, transparent);
  }

  .nr-choice-title {
    font-weight: 600;
  }

  .nr-choice-sub {
    color: var(--color-text-secondary);
    font-size: 0.85rem;
  }

  .nr-wait,
  .nr-gate {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    text-align: center;
    padding: 24px 16px;
  }

  .nr-gate p,
  .nr-wait p {
    max-width: 32ch;
  }

  .nr-gate p {
    color: var(--color-text-secondary);
  }

  .nr-sub {
    color: var(--color-text-secondary);
    font-size: 0.85rem;
  }

  .nr-draft {
    width: 100%;
    padding: 12px;
    border: 1px solid var(--color-input-border);
    border-radius: 12px;
    background: var(--color-bg-secondary);
    color: var(--color-text-primary);
    font-size: 0.95rem;
    line-height: 1.45;
    resize: vertical;
  }

  .nr-draft-recipe {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.85rem;
  }

  .nr-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .nr-primary,
  .nr-secondary,
  .nr-ghost {
    min-height: 44px;
    padding: 0 18px;
    border-radius: 999px;
    font-weight: 600;
    cursor: pointer;
    border: none;
  }

  .nr-primary {
    background-color: var(--color-primary);
    color: #fff;
  }

  .nr-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .nr-secondary {
    background: color-mix(in srgb, var(--color-primary) 12%, transparent);
    color: var(--color-primary);
  }

  .nr-ghost {
    background: transparent;
    color: var(--color-text-secondary);
  }
</style>
