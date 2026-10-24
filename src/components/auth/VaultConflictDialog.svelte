<script lang="ts">
  import Modal from '../Modal.svelte';
  import Button from '../Button.svelte';
  import {
    vaultConflict,
    confirmVaultConflict,
    cancelVaultConflict
  } from '$lib/auth/vaultConflict';

  // Backdrop/Escape close runs `cleanup` (cancel), which closes the store.
  let open = false;
  $: open = $vaultConflict.open;
</script>

<!-- Replacing the enrolled passkey login requires an explicit decision — it
     deletes the wrapped key for the other account on this device. -->
<Modal bind:open cleanup={cancelVaultConflict} noHeader>
  <div class="login-modal-body">
    <h2 class="login-modal-title">⚠️ Replace saved login?</h2>
    <div class="flex flex-col gap-4">
      <div class="bg-input border rounded-lg p-3" style="border-color: var(--color-input-border)">
        <p class="text-sm text-caption">{$vaultConflict.message}</p>
      </div>
      <div class="flex gap-2">
        <Button on:click={confirmVaultConflict} primary={true} disabled={$vaultConflict.busy}>
          {$vaultConflict.busy ? 'Signing in…' : 'Replace saved login'}
        </Button>
        <Button on:click={cancelVaultConflict} primary={false} disabled={$vaultConflict.busy}>
          Cancel
        </Button>
      </div>
    </div>
  </div>
</Modal>
