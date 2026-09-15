<script lang="ts">
  /**
   * Settings → Security card for the passkey vault: enroll, status, and the
   * unlock-gated removal/downgrade flow. When the feature is gated off
   * (Capacitor builds, off-domain origins, old browsers, no PRF, extension /
   * bunker sessions, a record owned by another account) the card still
   * renders — as one muted explanatory row, no button — so a hidden feature
   * never looks like a missing one. Only logged-out / anonymous renders
   * nothing.
   */
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { getAuthManager, type AuthState } from '$lib/authManager';
  import {
    VAULT_STORAGE_KEY,
    detectSupportDetail,
    getVaultRecord,
    isCeremonyCancelled,
    type VaultSupport,
    type VaultSupportReason
  } from '$lib/passkeyVault';
  import { resolveVaultSection, type VaultHiddenReason } from '$lib/securitySections';
  import {
    PASSKEY_SYNC_ENABLED,
    isSyncEnabled,
    syncableKeyEntry
  } from '$lib/passkeySync';
  import ShieldCheckIcon from 'phosphor-svelte/lib/ShieldCheck';
  import { nip19 } from 'nostr-tools';
  import KeyBackupGate from './KeyBackupGate.svelte';
  import { downloadKeysBackupFile } from '$lib/keyBackupGate';
  import { hexToBytes } from '$lib/passkeyVaultCrypto';

  const dispatch = createEventDispatcher();

  let support: VaultSupport = 'none';
  let supportReason: VaultSupportReason = null;
  let recordPubkey: string | null = null;
  let authState: AuthState | null = null;
  let unsubscribe: (() => void) | null = null;
  let attachRetry: ReturnType<typeof setInterval> | null = null;
  let busy = false;
  let notice = '';
  let errorMsg = '';
  let confirmingRemoval = false;

  // Cross-device sync state (Phase 2, behind PASSKEY_SYNC_ENABLED).
  let syncOn = false;
  let recordSyncable = false;
  // R1: toggle at enrollment, DEFAULT ON.
  let enrollWithSync = true;
  // Backup gate before enrollment (offer) — and the download button while
  // enrolled — both need the session key, which for an unlocked passkey
  // session exists ONLY in memory: same gate as the nsec reveal below.
  let sessionKeyHex: string | null = null;
  let backupOk = false;

  function refresh() {
    const am = getAuthManager();
    authState = am?.getState() ?? null;
    const record = getVaultRecord();
    recordPubkey = record?.pubkey ?? null;
    sessionKeyHex = am?.getSessionPrivateKeyHex() ?? null;
    syncOn = isSyncEnabled();
    recordSyncable = !!syncableKeyEntry(record);
  }

  // Auth flows notify subscribers synchronously from updateState(), and the
  // synced passkey sign-in persists its vault record only AFTER that notify.
  // Reading the record inside the listener would see a passkey session with
  // no record; deferring one microtask lets the same-task persist land first.
  function onAuthChange() {
    refresh();
    queueMicrotask(refresh);
  }

  // On a HARD load of /settings this component mounts before the layout's
  // onMount has created the AuthManager, so a one-shot subscribe attaches
  // nothing and authState stays null — the card (even the explanatory row)
  // would be omitted for an authenticated session. Same retry as +page.svelte.
  function attachAuthSubscription(): boolean {
    const am = getAuthManager();
    if (!am) return false;
    unsubscribe = am.subscribe(onAuthChange);
    refresh();
    return true;
  }

  // Cross-tab: the vault record lives in localStorage, so a removal or
  // enrollment in another tab must refresh this card (foreign / stale copy).
  function onStorage(e: StorageEvent) {
    if (e.key === null || e.key === VAULT_STORAGE_KEY) refresh();
  }

  onMount(async () => {
    ({ support, reason: supportReason } = await detectSupportDetail());
    refresh();
    window.addEventListener('storage', onStorage);
    if (!attachAuthSubscription()) {
      let tries = 0;
      attachRetry = setInterval(() => {
        if (attachAuthSubscription() || ++tries >= 20) {
          if (attachRetry) clearInterval(attachRetry);
          attachRetry = null;
        }
      }, 500);
    }
  });

  onDestroy(() => {
    if (attachRetry) clearInterval(attachRetry);
    attachRetry = null;
    unsubscribe?.();
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  });

  // Identity-bound gating: enrolled UI only when the live session owns the
  // record; offer only for plaintext nsec sessions. Foreign records and
  // nip07/nip46 sessions get an explanatory row (vault inert there);
  // anonymous sessions render nothing.
  $: card = resolveVaultSection({
    support,
    supportReason,
    sessionMethod: authState?.isAuthenticated ? authState.authMethod : null,
    sessionPubkey: authState?.publicKey ?? '',
    recordPubkey
  });

  const HIDDEN_COPY: Record<VaultHiddenReason, string> = {
    native: 'Passkey vault is available in the web app at zap.cooking.',
    'unsupported-origin': 'Passkeys only work on zap.cooking, not on preview or local builds.',
    'insecure-context': "This browser doesn't support passkeys.",
    'no-webauthn': "This browser doesn't support passkeys.",
    'no-prf':
      "This browser doesn't support the passkey feature we need (PRF). Try Chrome, Edge, or Safari.",
    'external-signer':
      'Passkey sign-in is available when you log in with your nsec. Your key currently lives in your extension or signer.',
    'foreign-record':
      'A passkey vault for a different account exists in this browser. Sign in to that account to manage it.',
    'stale-session':
      'This browser no longer has the vault for your passkey session. Sign out and back in to refresh passkey status.'
  };

  $: sessionNpub = authState?.publicKey ? nip19.npubEncode(authState.publicKey) : '';
  // backupOk mirrors the CURRENT offer gate only. Enroll → the gate is
  // destroyed; turn off later → `offer` returns with a fresh, unsatisfied
  // gate, and a stale true here would enable enrollment without a new
  // backup. (A key change while the gate is mounted resets inside the gate.)
  $: if (card?.kind !== 'offer') backupOk = false;

  function downloadBackup() {
    if (!sessionKeyHex || !sessionNpub) return;
    downloadKeysBackupFile(nip19.nsecEncode(hexToBytes(sessionKeyHex)), sessionNpub);
  }

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
        'Passkey protection is off. Your key is stored in this browser again — anyone with ' +
        'access to this browser profile can read it.';
      dispatch('changed');
    } catch (e) {
      errorMsg = friendlyError(e, 'Could not remove the passkey. Nothing was changed.');
    } finally {
      busy = false;
      refresh();
    }
  }
</script>

{#if card?.kind === 'hidden'}
  <div class="border-t border-[var(--color-input-border)] pt-5">
    <div class="flex items-center gap-2 mb-1">
      <ShieldCheckIcon size={18} class="text-caption" weight="regular" />
      <p class="text-sm font-medium" style="color: var(--color-text-primary)">Passkey Protection</p>
    </div>
    <p class="text-xs text-caption" data-vault-hidden={card.reason}>{HIDDEN_COPY[card.reason]}</p>
  </div>
{:else if card}
  <div class="border-t border-[var(--color-input-border)] pt-5">
    <div class="flex items-center gap-2 mb-1">
      <ShieldCheckIcon
        size={18}
        class={card.kind === 'enrolled' ? 'text-green-500' : 'text-caption'}
        weight={card.kind === 'enrolled' ? 'fill' : 'regular'}
      />
      <p class="text-sm font-medium" style="color: var(--color-text-primary)">Passkey Protection</p>
    </div>

    {#if card.kind === 'enrolled'}
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
                Sign in on other devices{#if recordSyncable}: {syncOn ? 'On' : 'Off'}{/if}
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
                aria-label="Sign in on other devices: {syncOn ? 'On' : 'Off'}"
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
        <div class="flex flex-wrap gap-2">
          {#if sessionKeyHex && sessionNpub}
            <button
              type="button"
              class="px-4 py-2 bg-secondary hover:bg-accent-gray rounded-lg text-sm font-medium transition-colors"
              style="color: var(--color-text-primary)"
              on:click={downloadBackup}
              disabled={busy}
            >
              Download key backup
            </button>
          {/if}
          <button
            type="button"
            class="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg text-sm font-medium transition-colors"
            on:click={() => (confirmingRemoval = true)}
            disabled={busy}
          >
            Turn off passkey protection
          </button>
        </div>
      {:else}
        <div
          class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-3"
        >
          <p class="text-xs text-red-700 dark:text-red-300">
            Turning off passkey protection stores your key in plain text in this browser again.
            Before continuing, make sure you have your nsec backed up — use "Download key backup"
            or "Reveal Private Key" below, or confirm you already saved it. You'll be asked to
            unlock with your passkey to confirm.
          </p>
        </div>
        <div class="flex gap-2">
          <button
            type="button"
            class="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            on:click={remove}
            disabled={busy}
          >
            {busy ? 'Waiting for passkey…' : 'Unlock & turn off'}
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
        you can unlock it. The passkey is <strong>not</strong> a backup — save your nsec first.
      </p>
      {#if sessionKeyHex && sessionNpub}
        <div class="mb-3">
          <KeyBackupGate
            nsecHex={sessionKeyHex}
            npub={sessionNpub}
            allowAcknowledge={true}
            on:satisfied={() => (backupOk = true)}
            on:unsatisfied={() => (backupOk = false)}
          />
        </div>
      {/if}
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
      {#if !backupOk}
        <p class="text-xs text-caption mb-2">
          Save your key to continue — download the file, reveal and copy it, or confirm you already
          have it.
        </p>
      {/if}
      <button
        type="button"
        class="px-4 py-2 bg-secondary hover:bg-accent-gray rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        style="color: var(--color-text-primary)"
        on:click={enroll}
        disabled={busy || !backupOk}
      >
        {busy ? 'Waiting for passkey…' : 'Turn on passkey protection'}
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
