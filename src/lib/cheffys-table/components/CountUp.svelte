<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { tweened } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  export let value: number;
  export let reduced = false;
  const count = tweened(value);
  onMount(() => {
    if (!reduced) {
      count.set(0, { duration: 0 });
      void count.set(value, { duration: 550, easing: cubicOut });
    }
  });
  onDestroy(() => {
    void count.set(value, { duration: 0 });
  });
</script>

<span aria-label={value.toLocaleString()}
  ><span aria-hidden="true">{Math.round($count).toLocaleString()}</span></span
>
