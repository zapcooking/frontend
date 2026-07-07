<script lang="ts">
  /**
   * Dismissible migration prompt: offers (never forces) moving a plaintext
   * localStorage nsec into the passkey vault. Web-only by construction —
   * shouldOfferEnrollment is false whenever detectSupport() is 'none'
   * (which includes every Capacitor build).
   *
   * The plaintext key is deleted only inside AuthManager.enrollVault after
   * the round-trip verification; a dismissed or failed prompt changes
   * nothing.
   */
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import { getAuthManager, type AuthState } from '$lib/authManager';
  import {
    detectSupport,
    getVaultRecord,
    shouldOfferEnrollment,
    isCeremonyCancelled,
    VAULT_PROMPT_DISMISSED_KEY,
    type VaultSupport
  } from '$lib/passkeyVault';

  let support: VaultSupport = 'none';
  let authState: AuthState | null = null;
  let unsubscribe: (() => void) | null = null;
  let visible = false;
  let busy = false;
  let done = false;
  let errorMsg = '';

  function evaluate() {
    if (!browser || !authState || busy || done) return;
    visible = shouldOfferEnrollment({
      authMethod: authState.authMethod,
      isAuthenticated: authState.isAuthenticated,
      hasPlaintextKey: !!localStorage.getItem('nostrcooking_privateKey'),
      hasVault: !!getVaultRecord(),
      support,
      dismissed: localStorage.getItem(VAULT_PROMPT_DISMISSED_KEY) === '1'
    });
  }

  onMount(async () => {
    support = await detectSupport();
    const am = getAuthManager();
    if (!am) return;
    authState = am.getState();
    unsubscribe = am.subscribe((s: AuthState) => {
      authState = s;
      evaluate();
    });
    evaluate();
  });

  onDestroy(() => unsubscribe?.());

  function dismiss() {
    if (browser) localStorage.setItem(VAULT_PROMPT_DISMISSED_KEY, '1');
    visible = false;
  }

  async function setUp() {
    const am = getAuthManager();
    if (!am) return;
    busy = true;
    errorMsg = '';
    try {
      await am.enrollVault();
      done = true;
    } catch (e) {
      if (isCeremonyCancelled(e)) {
        errorMsg = '';
      } else {
        errorMsg =
          e instanceof Error && /PRF|prf/.test(e.message)
            ? "Your passkey provider doesn't support the required feature. Nothing was changed — your key stays as it was. (A passkey may have been created in your password manager; it's safe to delete.)"
            : e instanceof Error
              ? e.message
              : 'Could not set up the passkey. Nothing was changed.';
      }
    } finally {
      busy = false;
      evaluate();
    }
  }
</script>

{#if visible || done}
  <aside class="vault-prompt" aria-label="Protect your key with a passkey">
    {#if done}
      <p class="vault-prompt-title">🔒 Passkey protection is on</p>
      <p class="vault-prompt-body">
        Your key is no longer stored in plain text in this browser. You'll unlock with your passkey
        next time. Remember: the passkey is <strong>not</strong> a backup — keep your nsec backup
        safe.
      </p>
      <div class="vault-prompt-actions">
        <button type="button" class="vault-prompt-primary" on:click={() => (done = false)}>
          Done
        </button>
      </div>
    {:else}
      <p class="vault-prompt-title">🔑 Protect your key with a passkey</p>
      <p class="vault-prompt-body">
        Your Nostr key is currently stored in plain text in this browser. A passkey encrypts it so
        only you can unlock it. The passkey is <strong>not</strong> a backup of your key — make
        sure your nsec is backed up first (Settings → Security → Reveal Private Key).
      </p>
      {#if errorMsg}
        <p class="vault-prompt-error" role="alert">{errorMsg}</p>
      {/if}
      <div class="vault-prompt-actions">
        <button type="button" class="vault-prompt-primary" on:click={setUp} disabled={busy}>
          {busy ? 'Waiting for passkey…' : 'Set up passkey'}
        </button>
        <a href="/settings" class="vault-prompt-link">Back up first</a>
        <button type="button" class="vault-prompt-dismiss" on:click={dismiss} disabled={busy}>
          Not now
        </button>
      </div>
    {/if}
  </aside>
{/if}

<style>
  .vault-prompt {
    position: fixed;
    right: 1rem;
    bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
    z-index: 60;
    max-width: 22rem;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-input-border);
    border-radius: 14px;
    padding: 1rem 1.125rem;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25);
  }
  @media (max-width: 480px) {
    .vault-prompt {
      left: 1rem;
      right: 1rem;
      max-width: none;
      /* Clear the mobile bottom nav */
      bottom: calc(4.5rem + env(safe-area-inset-bottom, 0px));
    }
  }
  .vault-prompt-title {
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--color-text-primary);
    margin: 0 0 0.375rem;
  }
  .vault-prompt-body {
    font-size: 0.8125rem;
    color: var(--color-caption);
    line-height: 1.5;
    margin: 0 0 0.75rem;
  }
  .vault-prompt-error {
    font-size: 0.8125rem;
    color: #ef4444;
    margin: 0 0 0.75rem;
  }
  .vault-prompt-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .vault-prompt-primary {
    background: var(--color-primary, #f97316);
    color: #fff;
    border: none;
    border-radius: 10px;
    font-size: 0.8125rem;
    font-weight: 600;
    padding: 0.5rem 0.875rem;
    cursor: pointer;
  }
  .vault-prompt-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .vault-prompt-link {
    font-size: 0.8125rem;
    color: var(--color-primary, #f97316);
    text-decoration: underline;
  }
  .vault-prompt-dismiss {
    background: none;
    border: none;
    font-size: 0.8125rem;
    color: var(--color-caption);
    cursor: pointer;
    margin-left: auto;
  }
</style>
