<script lang="ts">
  /**
   * Headless: keeps $lib/accountNudge's activeNudge current for the signed-in
   * account, and counts this browser session as a visit (the third-visit
   * fallback). Renders nothing — the nudge only appears in Settings and
   * Notifications (AccountNudgeItem).
   */
  import { onMount, onDestroy } from 'svelte';
  import { getAuthManager, type AuthState } from '$lib/authManager';
  import {
    detectSupport,
    getVaultRecord,
    isVaultUnconfirmed,
    type VaultSupport
  } from '$lib/passkeyVault';
  import {
    activeNudge,
    nudgeChanges,
    nudgeFor,
    readNudgeState,
    recordVisit,
    hasBackupSaved,
    legacyPromptDismissedForever,
    type NudgeContext
  } from '$lib/accountNudge';

  let support: VaultSupport = 'none';
  let authState: AuthState | null = null;
  const unsubs: Array<() => void> = [];

  function vaultFor(pubkey: string): NudgeContext['vault'] {
    const record = getVaultRecord();
    if (!record) return 'none';
    if (record.pubkey !== pubkey) return 'other';
    return isVaultUnconfirmed(record) ? 'unconfirmed' : 'confirmed';
  }

  function recompute() {
    const pubkey = authState?.isAuthenticated ? authState.publicKey : '';
    if (!authState || !pubkey) {
      activeNudge.set(null);
      return;
    }
    const state = readNudgeState(pubkey);
    const kind = nudgeFor({
      isAuthenticated: authState.isAuthenticated,
      authMethod: authState.authMethod,
      vault: vaultFor(pubkey),
      support,
      backupSaved: hasBackupSaved(pubkey),
      state,
      legacyDismissedForever: legacyPromptDismissedForever()
    });
    activeNudge.set(kind ? { kind, pubkey, seen: state.seen } : null);
  }

  onMount(async () => {
    const am = getAuthManager();
    if (!am) return;
    authState = am.getState();
    if (authState.isAuthenticated && authState.publicKey) recordVisit(authState.publicKey);
    unsubs.push(
      am.subscribe((s: AuthState) => {
        authState = s;
        if (s.isAuthenticated && s.publicKey) recordVisit(s.publicKey);
        recompute();
      })
    );
    // nudgeChanges fires synchronously on subscribe, so this also runs the
    // first recompute.
    unsubs.push(nudgeChanges.subscribe(recompute));
    support = await detectSupport();
    recompute();
  });

  onDestroy(() => {
    unsubs.forEach((u) => u());
    activeNudge.set(null);
  });
</script>
