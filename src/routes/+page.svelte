<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';

  export const data: PageData = {} as PageData;

  onMount(async () => {
    goto(`/explore`);
  });
</script>
