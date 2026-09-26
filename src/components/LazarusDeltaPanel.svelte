<script lang="ts">
  import type { Event } from 'nostr-tools';
  import {
    computeLazarusDelta,
    computeLazarusProfileChanges,
    fitsLazarusRemoteRestore,
    getLazarusItemRange,
    type LazarusCandidate,
    type LazarusPrivateTags
  } from '$lib/lazarus/recovery';
  import type { LazarusKindProfile } from '$lib/lazarus/registry';
  import WarningIcon from 'phosphor-svelte/lib/Warning';
  import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwise';

  /**
   * The delta-review panel, rendered inline directly beneath the version row
   * the user clicked Review on — where their eyes already are — rather than
   * at the end of the list. Nothing publishes from here; it computes and
   * shows the delta and asks the parent to restore on an explicit click.
   */
  export let candidate: LazarusCandidate;
  export let currentEvent: Event | undefined;
  export let profile: LazarusKindProfile | undefined;
  export let label: string;
  export let pubkey: string;
  export let canSign = false;
  export let remoteSigner = false;
  export let publishing = false;
  export let publishError = '';
  /**
   * Private items decrypted for this review (NIP-51), keyed by event id, so
   * the delta covers them; versions that couldn't be decrypted stay
   * estimated and flagged below.
   */
  export let privateTags: LazarusPrivateTags = new Map();
  /** True while the parent is decrypting the reviewed versions' private items. */
  export let decryptingPrivate = false;
  /** Changes when the review restarts against a newer current version —
   * un-arms the confirmations without moving the panel. */
  export let resetKey: string | number = 0;
  /** Error code of the last failed publish, when it failed at all. */
  export let publishErrorCode: string | undefined;
  /** True once a re-read retry already failed: the spec's explicit
   * restore-anyway override may be offered (never pre-selected). */
  export let showOverride = false;

  let armShrinkConfirm = false;
  let intentConfirmed = false;
  let overrideConfirmed = false;

  const dispatch = createEventDispatcher<{
    restore: void;
    'restore-override': void;
    close: void;
  }>();

  import { createEventDispatcher } from 'svelte';

  function resetConfirms() {
    armShrinkConfirm = false;
    intentConfirmed = false;
    overrideConfirmed = false;
  }

  $: candidate, resetConfirms();
  $: resetKey, resetConfirms();

  $: currentUnreadable = publishErrorCode === 'current-unreadable';

  $: delta = profile?.ranking !== 'recency'
    ? computeLazarusDelta(candidate.event, currentEvent, privateTags)
    : undefined;
  $: profileChanges =
    candidate.event.kind === 0 ? computeLazarusProfileChanges(candidate.event, currentEvent) : undefined;
  $: needsIntent = !!profile?.meaningfulEmpty;
  $: oversize = remoteSigner && pubkey ? !fitsLazarusRemoteRestore(candidate.event, pubkey) : false;

  // The row the user clicked sits right above this panel. Bring the panel
  // into view once layout is committed: the settings page scrolls inside a
  // nested container, and a synchronous onMount scroll can fire before the
  // newly rendered rows have their final positions — one animation frame
  // later is after layout. 'center' guarantees full visibility (nearest can
  // stop a few px short) while keeping the row in context.
  function scrollIntoViewOnFrame(el: HTMLElement) {
    const raf = requestAnimationFrame(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    return { destroy: () => cancelAnimationFrame(raf) };
  }
</script>

<div class="lz-delta" use:scrollIntoViewOnFrame data-testid="lazarus-delta">
  <h4>Review this restore</h4>
  <p class="lz-note">
    Restoring republishes the version from {label} as a new event signed by
    your account.
  </p>

  {#if profileChanges}
    {#if profileChanges.length === 0}
      <p class="lz-note">This version matches your current profile fields.</p>
    {:else}
      <ul class="lz-fields">
        {#each profileChanges as change (change.field)}
          <li>
            <span class="lz-field-name">{change.field}</span>
            <span class="lz-field-from" dir="auto" title={change.from}>{change.from ?? '—'}</span>
            <span class="lz-field-arrow">→</span>
            <span class="lz-field-to" dir="auto" title={change.to}>{change.to ?? '—'}</span>
          </li>
        {/each}
      </ul>
    {/if}
  {:else if delta}
    <p class="lz-delta-line">
      <span class="lz-delta-add">+{delta.addedCount} added</span>
      ·
      <span class="lz-delta-remove">−{delta.removedCount} removed</span>
    </p>
    {#if decryptingPrivate}
      <p class="lz-note">Decrypting private items so the changes cover them too…</p>
    {:else if delta.privateUnknown}
      <p class="lz-warning">
        <WarningIcon size={14} weight="fill" />
        Some private items are encrypted and couldn't be decrypted here, so they aren't listed
        below — they restore exactly as they were. Counts on the version rows are estimates.
      </p>
    {/if}
    {#if delta.added.length}
      <details class="lz-details">
        <summary>Added ({delta.addedCount})</summary>
        <ul>
          {#each delta.added.slice(0, 20) as tag, i (i)}<li>{tag[0]} {tag[1].slice(0, 16)}</li>{/each}
          {#if delta.addedCount > 20}<li>…and {delta.addedCount - 20} more</li>{/if}
        </ul>
      </details>
    {/if}
    {#if delta.removed.length}
      <details class="lz-details">
        <summary>Removed ({delta.removedCount})</summary>
        <ul>
          {#each delta.removed.slice(0, 20) as tag, i (i)}<li>{tag[0]} {tag[1].slice(0, 16)}</li>{/each}
          {#if delta.removedCount > 20}<li>…and {delta.removedCount - 20} more</li>{/if}
        </ul>
      </details>
    {/if}
    {#if profile?.requiredWarnings.includes('remute') && delta.removedCount > 0}
      <p class="lz-warning">
        <WarningIcon size={14} weight="fill" />
        Restoring re-mutes {delta.removedCount} account{delta.removedCount === 1 ? '' : 's'} you may have
        deliberately unmuted since — a moderation action taken on your behalf.
      </p>
    {/if}
  {/if}

  {#if needsIntent}
    <div class="lz-intent">
      <p>
        {#if getLazarusItemRange(candidate.itemCount).max === 0}
          The current empty state announces that you do not use NIP-4e; restoring this
          version re-lists these encryption keys and clients will encrypt direct messages
          to them again.
        {:else}
          This restores your NIP-4e encryption keys. The current empty state would have
          announced that you do not use NIP-4e.
        {/if}
      </p>
      <label>
        <input type="checkbox" bind:checked={intentConfirmed} />
        I intend this change
      </label>
    </div>
  {/if}

  {#if oversize}
    <p class="lz-warning">
      <WarningIcon size={14} weight="fill" />
      This version is too large to sign through a remote signer (NIP-46 requests are capped
      at 65,535 bytes). Restore it from a session with a local key or a NIP-07 extension.
    </p>
  {/if}

  {#if !canSign}
    <p class="lz-warning">
      This is a view-only account — you can scan history, but restoring needs a signing
      account.
    </p>
  {:else if publishing}
    <p class="lz-note">Waiting for your signer…</p>
  {:else if delta?.shrinks || (profileChanges && profileChanges.length > 0)}
    {#if !armShrinkConfirm}
      <button
        type="button"
        class="lz-confirm"
        on:click={() => (armShrinkConfirm = true)}
        disabled={(needsIntent && !intentConfirmed) || decryptingPrivate}
      >
        {delta?.shrinks ? `Continue — this removes ${delta.removedCount} item${delta.removedCount === 1 ? '' : 's'}` : 'Continue'}
      </button>
    {:else}
      <p class="lz-warning">This restore shrinks your list below the current version.</p>
      <div class="lz-confirm-row">
        <button type="button" class="lz-cancel" on:click={() => (armShrinkConfirm = false)}>Cancel</button>
        <button
          type="button"
          class="lz-confirm lz-confirm--danger"
          disabled={decryptingPrivate}
          on:click={() => dispatch('restore')}
        >
          Confirm removal and restore
        </button>
      </div>
    {/if}
  {:else}
    <button
      type="button"
      class="lz-confirm"
      on:click={() => dispatch('restore')}
      disabled={(needsIntent && !intentConfirmed) || oversize || decryptingPrivate}
    >Restore this version</button>
  {/if}
  {#if currentUnreadable}
    <!-- The re-read before signing couldn't reach a write relay. Retry
         re-runs it; only after a retry failed does the spec's override
         appear, unselected, and it is never remembered between restores. -->
    {#if showOverride}
      <p class="lz-warning">
        <WarningIcon size={14} weight="fill" />
        The current version could not be confirmed. Retrying didn't help, so restoring now may
        overwrite edits made since the review.
      </p>
      <label class="lz-intent-label">
        <input type="checkbox" bind:checked={overrideConfirmed} />
        Restore anyway, accepting that risk
      </label>
      <button
        type="button"
        class="lz-confirm lz-confirm--danger"
        disabled={!overrideConfirmed}
        on:click={() => dispatch('restore-override')}
      >Restore without confirming current</button>
    {/if}
    <button type="button" class="lz-cancel" on:click={() => dispatch('restore')}>
      <ArrowClockwiseIcon size={14} />
      Retry the check
    </button>
  {/if}
  <button type="button" class="lz-cancel" on:click={() => dispatch('close')}>Close review</button>
  {#if publishError}<p class="lz-error">{publishError}</p>{/if}
</div>

<style>
  .lz-delta {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    margin: 0.5rem 0 0.25rem;
    border-radius: 0.75rem;
    border: 1px solid var(--color-primary, #f97316);
    background: var(--color-bg-secondary);
  }

  .lz-delta h4 {
    margin: 0;
    font-size: 1rem;
    color: var(--color-text-primary);
  }

  .lz-note {
    color: var(--color-caption);
    line-height: 1.6;
    margin: 0;
    font-size: 0.875rem;
  }

  .lz-delta-line {
    margin: 0;
    font-size: 0.9375rem;
  }

  .lz-delta-add {
    color: #16a34a;
    font-weight: 600;
  }

  .lz-delta-remove {
    color: #ef4444;
    font-weight: 600;
  }

  .lz-details summary {
    cursor: pointer;
    color: var(--color-text-secondary);
    font-size: 0.875rem;
  }

  .lz-details ul {
    margin: 0.25rem 0 0;
    padding-left: 1.25rem;
    color: var(--color-caption);
    font-size: 0.8125rem;
    line-height: 1.6;
    word-break: break-all;
  }

  .lz-warning {
    display: flex;
    gap: 0.4rem;
    align-items: flex-start;
    margin: 0;
    color: #b45309;
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .lz-error {
    color: #ef4444;
    font-size: 0.875rem;
    margin: 0;
  }

  .lz-fields {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .lz-fields li {
    display: grid;
    grid-template-columns: 6.5rem 1fr auto 1fr;
    gap: 0.5rem;
    align-items: center;
    font-size: 0.875rem;
  }

  .lz-field-name {
    color: var(--color-caption);
    font-weight: 600;
  }

  .lz-field-from,
  .lz-field-to {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lz-field-from {
    color: #ef4444;
  }

  .lz-field-to {
    color: #16a34a;
  }

  .lz-intent {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: var(--color-text-secondary);
  }

  .lz-intent-label {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    cursor: pointer;
    color: var(--color-text-primary);
    font-size: 0.875rem;
  }

  .lz-intent label {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    cursor: pointer;
    color: var(--color-text-primary);
  }

  .lz-confirm {
    align-self: flex-start;
    padding: 0.55rem 1.4rem;
    border-radius: 9999px;
    border: none;
    background-image: linear-gradient(to right, #f97316, #f59e0b);
    color: #fff;
    font-size: 0.9375rem;
    font-weight: 600;
    cursor: pointer;
  }

  .lz-confirm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .lz-confirm--danger {
    background-image: linear-gradient(to right, #ef4444, #f97316);
  }

  .lz-cancel {
    align-self: flex-start;
    padding: 0.45rem 1.1rem;
    border-radius: 9999px;
    border: none;
    background: var(--color-accent-gray);
    color: var(--color-text-secondary);
    font-size: 0.875rem;
    cursor: pointer;
  }

  .lz-confirm-row {
    display: flex;
    gap: 0.625rem;
    align-items: center;
    flex-wrap: wrap;
  }
</style>
