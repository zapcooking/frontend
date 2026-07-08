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
  import {
    PASSKEY_SYNC_ENABLED,
    isSyncEnabled,
    syncableKeyEntry
  } from '$lib/passkeySync';
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

  // Cross-device sync state (Phase 2, behind PASSKEY_SYNC_ENABLED).
  let syncOn = false;
  let recordSyncable = false;
  // R1: toggle at enrollment, DEFAULT ON.
  let enrollWithSync = true;

  function refresh() {
    const am = getAuthManager();
    authState = am?.getState() ?? null;
    const record = getVaultRecord();
    recordPubkey = record?.pubkey ?? null;
    syncOn = isSyncEnabled();
    recordSyncable = !!syncableKeyEntry(record);
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
      await am.enrollVault(PASSKEY_SYNC_ENABLED ? { sync: enrollWithSync } : undefined);
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

  async function toggleSync() {
    const am = getAuthManager();
    if (!am) return;
    busy = true;
    errorMsg = '';
    notice = '';
    const turningOn = !syncOn;
    try {
      await am.setVaultSync(turningOn);
      notice = turningOn
        ? 'Cross-device sign-in is on. An encrypted copy of your key is stored on Zap Cooking servers.'
        : 'Cross-device sign-in is off. The encrypted copy was removed from Zap Cooking servers.';
      dispatch('changed');
    } catch (e) {
      errorMsg = friendlyError(e, 'Could not change cross-device sign-in. Nothing was changed.');
    } finally {
      busy = false;
      refresh();
    }
  }

  async function migrateForSync() {
    const am = getAuthManager();
    if (!am) return;
    busy = true;
    errorMsg = '';
    notice = '';
    try {
      // Guided re-enrollment: new credential, fresh DEK, record replaced,
      // then uploaded. The OLD passkey becomes an orphan in the user's
      // provider (copy below tells them it is safe to delete).
      await am.enrollVault({ sync: true, migrate: true });
      notice =
        'Done — your passkey was re-created with cross-device sign-in. The previous ' +
        '"Zap Cooking" passkey in your password manager is no longer used and can be deleted.';
      dispatch('changed');
    } catch (e) {
      errorMsg = friendlyError(e, 'Could not re-create the passkey. Nothing was changed.');
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

      {#if PASSKEY_SYNC_ENABLED && !confirmingRemoval}
        <div
          class="bg-input border rounded-lg p-3 mb-3"
          style="border-color: var(--color-input-border)"
        >
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="text-sm font-medium" style="color: var(--color-text-primary)">
                Sign in on other devices
              </p>
              <p class="text-xs text-caption mt-0.5">
                {#if recordSyncable}
                  {syncOn
                    ? 'On — an encrypted copy of your key is stored on Zap Cooking servers. Only your passkey can unlock it. Turning this off requires a quick passkey confirmation.'
                    : 'Off — your key exists only on this device. Turning this on stores an encrypted copy on Zap Cooking servers and requires a quick passkey confirmation.'}
                {:else}
                  This passkey was created before cross-device sign-in existed.
                {/if}
              </p>
            </div>
            {#if recordSyncable}
              <button
                type="button"
                role="switch"
                aria-checked={syncOn}
                aria-label="Sign in on other devices"
                class="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors {syncOn
                  ? 'bg-green-500/15 text-green-600'
                  : 'bg-secondary text-caption'}"
                on:click={toggleSync}
                disabled={busy}
              >
                {busy ? 'Waiting…' : syncOn ? 'On' : 'Off'}
              </button>
            {/if}
          </div>
          {#if !recordSyncable}
            <div class="mt-2">
              <p class="text-xs text-caption mb-2">
                To enable it, the passkey needs to be re-created: one extra passkey prompt, and the
                old "Zap Cooking" passkey left in your password manager can be deleted afterwards.
                Your Nostr key does not change.
              </p>
              <button
                type="button"
                class="px-3 py-1.5 bg-secondary hover:bg-accent-gray rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                style="color: var(--color-text-primary)"
                on:click={migrateForSync}
                disabled={busy}
              >
                {busy ? 'Waiting for passkey…' : 'Re-create passkey & enable'}
              </button>
            </div>
          {/if}
        </div>
      {/if}

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
      {#if PASSKEY_SYNC_ENABLED}
        <!-- R1(b): opt-in toggle at enrollment, default ON, plain disclosure. -->
        <label class="flex items-start gap-2 mb-3 cursor-pointer">
          <input type="checkbox" bind:checked={enrollWithSync} disabled={busy} class="mt-0.5" />
          <span class="text-xs text-caption">
            <span class="font-medium" style="color: var(--color-text-primary)">
              Enable sign-in on other devices.
            </span>
            Stores an encrypted copy of your key on Zap Cooking's servers — only your passkey can
            unlock it, and you can turn this off any time in Settings (turning it off later
            requires a quick passkey confirmation).
          </span>
        </label>
      {/if}
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
