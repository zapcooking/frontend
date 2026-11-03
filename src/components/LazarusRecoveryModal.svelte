<script lang="ts">
  import Modal from './Modal.svelte';
  import LazarusRecoverySection from './LazarusRecoverySection.svelte';

  /** Modal wrapper around the Lazarus recovery screen — the entry point the
   * profile page uses; settings embeds the section directly. */
  export let open = false;
  export let initialKind = 3;

  function handleCleanup() {
    open = false;
  }
</script>

<Modal bind:open cleanup={handleCleanup} wide>
  <span slot="title">Data Recovery</span>
  <LazarusRecoverySection {initialKind} />
</Modal>
