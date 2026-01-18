<script lang="ts">
  import Modal from './Modal.svelte';
  import PostComposer from './PostComposer.svelte';

  export let open = false;
</script>

<Modal bind:open allowOverflow={true}>
  <svelte:fragment slot="title">
    <h2 class="text-lg font-semibold" style="color: var(--color-text-primary)">New Post</h2>
  </svelte:fragment>

  <PostComposer variant="modal" on:close={() => (open = false)} />
</Modal>
