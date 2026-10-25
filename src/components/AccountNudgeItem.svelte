<script lang="ts">
  /**
   * The one "guide later" account nudge ($lib/accountNudge), rendered in
   * Settings, at the top of /notifications and in the bell panel. The same
   * state backs every place: dismissing it here dismisses it everywhere.
   *
   * In Settings the action opens the Security section in place (the page
   * listens for `act`); elsewhere it links to /settings#security.
   */
  import { createEventDispatcher, onMount } from 'svelte';
  import XIcon from 'phosphor-svelte/lib/X';
  import KeyIcon from 'phosphor-svelte/lib/Key';
  import FingerprintIcon from 'phosphor-svelte/lib/Fingerprint';
  import { activeNudge, dismissNudge, markBackupSaved } from '$lib/accountNudge';
  import {
    passkeyMethodLabel,
    passkeyNudgeTitle,
    type PasskeyMethodLabel
  } from '$lib/auth/passkeyLabel';

  /** Where it renders: Settings handles the action in place. */
  export let where: 'settings' | 'notifications' | 'bell' = 'notifications';

  const dispatch = createEventDispatcher<{ act: void; navigate: void }>();

  let label: PasskeyMethodLabel = 'passkey';
  onMount(() => {
    label = passkeyMethodLabel({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints
    });
  });

  $: nudge = $activeNudge;
  $: compact = where === 'bell';

  function dismiss() {
    if (nudge) dismissNudge(nudge.pubkey);
  }

  /** "I already have one": record the backup and put the nudge away. */
  function alreadyHaveOne() {
    if (!nudge) return;
    markBackupSaved(nudge.pubkey);
    dismissNudge(nudge.pubkey);
  }
</script>

{#if nudge}
  <section
    class="nudge"
    class:nudge-compact={compact}
    aria-label={nudge.kind === 'backup' ? 'Save a backup key' : passkeyNudgeTitle(label)}
  >
    <span class="nudge-icon" aria-hidden="true">
      {#if nudge.kind === 'backup'}
        <KeyIcon size={compact ? 18 : 22} weight="duotone" />
      {:else}
        <FingerprintIcon size={compact ? 18 : 22} weight="duotone" />
      {/if}
    </span>
    <div class="nudge-main">
      {#if nudge.kind === 'backup'}
        <p class="nudge-title">Save a backup key</p>
        <p class="nudge-body">
          If you haven't saved a backup key yet, add one so you never lose your account if you lose
          your phone.
          {#if !compact}
            A passkey is not a backup: it lives on your devices, so if you lose them, only your
            backup key gets you back in.
          {/if}
        </p>
      {:else}
        <p class="nudge-title">{passkeyNudgeTitle(label)}</p>
        {#if !compact}
          <p class="nudge-body">
            Your key is stored in plain text in this browser. {label === 'passkey'
              ? 'A passkey'
              : label === 'fingerprint'
                ? 'Fingerprint unlock'
                : label} encrypts it so only you can unlock it.
          </p>
        {/if}
      {/if}
      <div class="nudge-actions">
        {#if where === 'settings'}
          <button type="button" class="nudge-primary" on:click={() => dispatch('act')}>
            {nudge.kind === 'backup' ? 'Save backup key' : 'Turn it on'}
          </button>
        {:else}
          <a href="/settings#security" class="nudge-primary" on:click={() => dispatch('navigate')}>
            {nudge.kind === 'backup' ? 'Save backup key' : 'Turn it on'}
          </a>
        {/if}
        {#if nudge.kind === 'backup'}
          <button type="button" class="nudge-secondary" on:click={alreadyHaveOne}>
            I already have one
          </button>
        {/if}
      </div>
    </div>
    <button type="button" class="nudge-dismiss" aria-label="Dismiss" on:click={dismiss}>
      <XIcon size={16} weight="bold" />
    </button>
  </section>
{/if}

<style>
  .nudge {
    position: relative;
    display: flex;
    gap: 0.75rem;
    padding: 1rem 2.5rem 1rem 1rem;
    border: 1px solid var(--color-input-border);
    border-radius: 12px;
    background: var(--color-bg-secondary);
  }
  .nudge-compact {
    padding: 0.75rem 2.25rem 0.75rem 0.75rem;
    border-radius: 0;
    border-width: 0 0 1px;
  }
  .nudge-icon {
    flex-shrink: 0;
    color: var(--color-primary);
    padding-top: 0.125rem;
  }
  .nudge-main {
    min-width: 0;
  }
  .nudge-title {
    margin: 0 0 0.25rem;
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }
  .nudge-compact .nudge-title {
    font-size: 0.875rem;
  }
  .nudge-body {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--color-caption);
  }
  .nudge-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    margin-top: 0.625rem;
  }
  /* Not --color-primary: white on it is 3.84:1 (3.16:1 dark). This is 5.18:1. */
  .nudge-primary {
    display: inline-block;
    background: #c2410c;
    color: #fff;
    border: none;
    border-radius: 10px;
    font-size: 0.8125rem;
    font-weight: 600;
    padding: 0.4rem 0.875rem;
    cursor: pointer;
    text-decoration: none;
  }
  .nudge-secondary {
    background: none;
    border: none;
    padding: 0;
    font-size: 0.8125rem;
    color: var(--color-caption);
    text-decoration: underline;
    cursor: pointer;
  }
  .nudge-dismiss {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border: none;
    border-radius: 999px;
    background: none;
    color: var(--color-caption);
    cursor: pointer;
  }
  .nudge-dismiss:hover {
    background: var(--color-input-bg);
  }
</style>
