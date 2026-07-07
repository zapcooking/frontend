<script lang="ts">
  /**
   * Settings → Security card for the passkey vault: enroll, status, and the
   * unlock-gated removal/downgrade flow. Renders nothing on platforms
   * without WebAuthn (Capacitor builds, old browsers) unless a vault record
   * already exists (which shouldn't be possible there, but status beats
   * silence if it ever happens).
   */
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { getAuthManager, type AuthState } from '$lib/authManager';
  import {
    detectSupport,
    getVaultRecord,
    isCeremonyCancelled,
    type VaultSupport
  } from '$lib/passkeyVault';
  import { resolveVaultSection } from '$lib/securitySections';
  import ShieldCheckIcon from 'phosphor-svelte/lib/ShieldCheck';

  const dispatch = createEventDispatcher();

  let support: VaultSupport = 'none';
  let recordPubkey: string | null = null;
  let authState: AuthState | null = null;
  let unsubscribe: (() => void) | null = null;
  let busy = false;
  let notice = '';
  let errorMsg = '';
  let confirmingRemoval = false;

  function refresh() {
    const am = getAuthManager();
    authState = am?.getState() ?? null;
    recordPubkey = getVaultRecord()?.pubkey ?? null;
  }

  onMount(async () => {
    support = await detectSupport();
    refresh();
    unsubscribe = getAuthManager()?.subscribe(() => refresh()) ?? null;
  });

  onDestroy(() => unsubscribe?.());

  // Identity-bound gating: enrolled UI only when the live session owns the
  // record; offer only for plaintext nsec sessions. Foreign records and
  // nip07/nip46/anonymous sessions render nothing (vault inert there).
  $: card = resolveVaultSection({
    support,
    sessionMethod: authState?.isAuthenticated ? authState.authMethod : null,
    sessionPubkey: authState?.publicKey ?? '',
    recordPubkey
  });

  function friendlyError(e: unknown, fallback: string): string {
    if (isCeremonyCancelled(e)) return '';
    return e instanceof Error ? e.message : fallback;
  }

  async function enroll() {
    const am = getAuthManager();
    if (!am) return;
    busy = true;
    errorMsg = '';
    notice = '';
    try {
      await am.enrollVault();
      notice =
        'Passkey protection is on. Your key is no longer stored in plain text in this browser. ' +
        'The passkey is not a backup — keep your revealed nsec somewhere safe.';
      dispatch('changed');
    } catch (e) {
      errorMsg = friendlyError(e, 'Could not set up the passkey. Nothing was changed.');
    } finally {
      busy = false;
      refresh();
    }
  }

  async function remove() {
    const am = getAuthManager();
    if (!am) return;
    busy = true;
    errorMsg = '';
    notice = '';
    try {
      await am.removeVault();
      confirmingRemoval = false;
      notice =
        'Passkey removed. Your key is stored in this browser again — anyone with access to this ' +
        'browser profile can read it.';
      dispatch('changed');
    } catch (e) {
      errorMsg = friendlyError(e, 'Could not remove the passkey. Nothing was changed.');
    } finally {
      busy = false;
      refresh();
    }
  }
</script>

{#if card}
  <div class="border-t border-[var(--color-input-border)] pt-5">
    <div class="flex items-center gap-2 mb-1">
      <ShieldCheckIcon
        size={18}
        class={card === 'enrolled' ? 'text-green-500' : 'text-caption'}
        weight={card === 'enrolled' ? 'fill' : 'regular'}
      />
      <p class="text-sm font-medium" style="color: var(--color-text-primary)">Passkey Protection</p>
    </div>

    {#if card === 'enrolled'}
      <p class="text-xs text-caption mb-3">
        Your Nostr key is encrypted on this device and unlocked with your passkey. The passkey is
        <strong>not</strong> a backup of your key — if you lose both the passkey and your nsec
        backup, the account is unrecoverable.
      </p>

      {#if !confirmingRemoval}
        <button
          type="button"
          class="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg text-sm font-medium transition-colors"
          on:click={() => (confirmingRemoval = true)}
          disabled={busy}
        >
          Remove passkey protection…
        </button>
      {:else}
        <div
          class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-3"
        >
          <p class="text-xs text-red-700 dark:text-red-300">
            Removing the passkey stores your key in plain text in this browser again. Before
            continuing, make sure you have your nsec backed up — use "Reveal Private Key" below
            after removal, or confirm you already saved it. You'll be asked to unlock with your
            passkey to confirm.
          </p>
        </div>
        <div class="flex gap-2">
          <button
            type="button"
            class="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            on:click={remove}
            disabled={busy}
          >
            {busy ? 'Waiting for passkey…' : 'Unlock & remove'}
          </button>
          <button
            type="button"
            class="px-4 py-2 bg-secondary hover:bg-accent-gray rounded-lg text-sm transition-colors"
            style="color: var(--color-text-primary)"
            on:click={() => (confirmingRemoval = false)}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      {/if}
    {:else}
      <p class="text-xs text-caption mb-3">
        Your key is currently stored in plain text in this browser. A passkey encrypts it so only
        you can unlock it. The passkey is <strong>not</strong> a backup — reveal and save your nsec
        below first.
      </p>
      <button
        type="button"
        class="px-4 py-2 bg-secondary hover:bg-accent-gray rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        style="color: var(--color-text-primary)"
        on:click={enroll}
        disabled={busy}
      >
        {busy ? 'Waiting for passkey…' : 'Set up passkey protection'}
      </button>
    {/if}

    {#if notice}
      <p class="text-xs mt-2" style="color: #16a34a">{notice}</p>
    {/if}
    {#if errorMsg}
      <p class="text-xs mt-2" style="color: #ef4444">{errorMsg}</p>
    {/if}
  </div>
{/if}
