<script lang="ts">
  /**
   * NourishFlagButton — tiny flag icon + popover for submitting
   * disagreement with a Nourish score.
   *
   * Popover uses the existing Modal primitive (portal-rendered,
   * compact, with the same blur/scale transitions used elsewhere).
   * No custom mobile bottom-sheet; Modal handles the desktop/mobile
   * story uniformly.
   *
   * Pre-check: if the user has already flagged this target/dimension/
   * direction-pair within 24h, the icon renders in filled state and
   * clicking is a no-op. Prevents opening a popover the user can't
   * meaningfully submit through.
   */
  import FlagIcon from 'phosphor-svelte/lib/Flag';
  import Modal from '../Modal.svelte';
  import Button from '../Button.svelte';
  import { userPublickey } from '$lib/nostr';
  import { showToast } from '$lib/toast';
  import {
    submitFlag,
    hasAnonFlagStamp,
    hasPriorSignedFlag,
    type FlagTarget,
    type NourishDimension,
    type FlagDirection
  } from '$lib/nourish/flagSubmit';

  /** What's being flagged — either a recipe's Nourish event or a scan result. */
  export let target: FlagTarget;

  /** Which dimension this flag is about. */
  export let dimension: NourishDimension;

  /** Score at flag time (0..10). Stored in the flag record for admin triage. */
  export let score: number;

  /** Nourish model/prompt version (from $lib/nourish/types). */
  export let nourishVer: string;

  /** Icon size in px. Default 14 (matches NourishDimensionBar size scale). */
  export let iconSize = 14;

  /**
   * Optional human-readable dimension name override. When unset, derived
   * reactively from `dimension` (so it stays in sync even if `dimension`
   * arrives after component init, which is the common case).
   */
  export let dimensionLabel: string | undefined = undefined;

  function defaultDimensionLabel(d: NourishDimension): string {
    if (d === 'gut') return 'gut-health';
    if (d === 'protein') return 'protein';
    if (d === 'realFood') return 'real-food';
    return 'overall';
  }

  $: resolvedDimensionLabel = dimensionLabel ?? defaultDimensionLabel(dimension);

  // Unique id per instance so <label for="…"> never collides when the
  // page renders multiple flag buttons (one per dimension bar).
  const reasonInputId = `flag-reason-${Math.random().toString(36).slice(2, 10)}`;

  let popoverOpen = false;
  let submitting = false;
  let selectedDirection: FlagDirection | null = null;
  let reason = '';

  // Filled state — user has previously flagged this. Reactive so that it
  // re-runs when $userPublickey / target / dimension change (a common
  // pattern: pubkey arrives after mount).
  let alreadyFlagged = false;
  $: refreshFilledState($userPublickey, target, dimension);

  async function refreshFilledState(
    pubkey: string | null,
    t: FlagTarget,
    dim: NourishDimension
  ) {
    if (pubkey) {
      // Check signed flags for both directions; any prior flag fills the icon.
      const high = await hasPriorSignedFlag(pubkey, t, dim, 'too-high');
      if (high) {
        alreadyFlagged = true;
        return;
      }
      const low = await hasPriorSignedFlag(pubkey, t, dim, 'too-low');
      alreadyFlagged = low;
      return;
    }
    alreadyFlagged =
      hasAnonFlagStamp(t, dim, 'too-high') || hasAnonFlagStamp(t, dim, 'too-low');
  }

  function handleIconClick() {
    if (alreadyFlagged) return; // no-op: no popover for already-flagged
    popoverOpen = true;
  }

  function closePopover() {
    popoverOpen = false;
    selectedDirection = null;
    reason = '';
  }

  async function handleSubmit() {
    if (!selectedDirection || submitting) return;
    submitting = true;

    const result = await submitFlag({
      target,
      dimension,
      direction: selectedDirection,
      score,
      nourishVer,
      reason: reason.trim() || undefined
    });

    submitting = false;

    if (!result.ok) {
      if (result.error === 'rate_limited') {
        showToast(
          'error',
          "You've flagged a few already — take a breather and try again in a minute."
        );
      } else {
        showToast('error', "Couldn't submit your flag — please try again.");
      }
      return;
    }

    // Success OR duplicate both land here; both stamp the filled state.
    alreadyFlagged = true;
    closePopover();
  }
</script>

<button
  type="button"
  class="flag-btn"
  class:filled={alreadyFlagged}
  aria-label={alreadyFlagged
    ? `You flagged the ${resolvedDimensionLabel} score`
    : `Flag the ${resolvedDimensionLabel} score`}
  title={alreadyFlagged ? 'You flagged this' : 'Flag this score'}
  on:click|stopPropagation={handleIconClick}
>
  <FlagIcon size={iconSize} weight={alreadyFlagged ? 'fill' : 'regular'} />
</button>

<Modal bind:open={popoverOpen} compact>
  <span slot="title">Help us improve this score</span>

  <div class="popover-body">
    <p class="subhead">
      The {resolvedDimensionLabel} score seems…
    </p>

    <div class="direction-row">
      <button
        type="button"
        class="dir-btn"
        class:selected={selectedDirection === 'too-high'}
        on:click={() => (selectedDirection = 'too-high')}
      >
        ↑ too high
      </button>
      <button
        type="button"
        class="dir-btn"
        class:selected={selectedDirection === 'too-low'}
        on:click={() => (selectedDirection = 'too-low')}
      >
        ↓ too low
      </button>
    </div>

    <label class="reason-label" for={reasonInputId}>Tell us more (optional)</label>
    <textarea
      id={reasonInputId}
      bind:value={reason}
      rows="3"
      maxlength="500"
      placeholder="What seemed off?"
      class="reason-input"
    ></textarea>

    <div class="actions">
      <button
        type="button"
        class="btn-cancel"
        on:click={closePopover}
        disabled={submitting}
      >
        Cancel
      </button>
      <Button
        on:click={handleSubmit}
        disabled={!selectedDirection || submitting}
      >
        {submitting ? 'Submitting…' : 'Submit'}
      </Button>
    </div>
  </div>
</Modal>

<style>
  .flag-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem;
    border-radius: 0.25rem;
    color: var(--color-text-secondary);
    transition:
      color 0.15s,
      opacity 0.15s;
    cursor: pointer;
  }

  .flag-btn:hover {
    color: var(--color-primary);
  }

  .flag-btn.filled {
    color: var(--color-primary);
    cursor: default;
  }

  .popover-body {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .subhead {
    margin: 0;
    font-size: 0.875rem;
    color: var(--color-text-primary);
  }

  .direction-row {
    display: flex;
    gap: 0.5rem;
  }

  .dir-btn {
    flex: 1 1 0%;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    border: 1px solid var(--color-input-border);
    background: var(--color-input-bg);
    color: var(--color-text-primary);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition:
      border-color 0.15s,
      background 0.15s;
  }

  .dir-btn:hover {
    border-color: var(--color-primary);
  }

  .dir-btn.selected {
    border-color: var(--color-primary);
    background: rgba(249, 115, 22, 0.1);
    color: var(--color-primary);
  }

  .reason-label {
    font-size: 0.75rem;
    color: var(--color-text-secondary);
  }

  .reason-input {
    width: 100%;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    background: var(--color-input-bg);
    border: 1px solid var(--color-input-border);
    color: var(--color-text-primary);
    font-size: 0.875rem;
    resize: vertical;
    min-height: 4.5rem;
  }

  .reason-input:focus {
    outline: none;
    box-shadow: 0 0 0 2px var(--color-primary);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .btn-cancel {
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-text-primary);
    background: var(--color-input);
    border-radius: 0.5rem;
    cursor: pointer;
  }

  .btn-cancel:hover {
    opacity: 0.8;
  }

  .btn-cancel:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
