<script lang="ts">
  import Star from 'phosphor-svelte/lib/Star';
  export let value: number;
  export let large = false;
</script>

<span class="stars" class:large role="img" aria-label={`${value} out of 5 stars`}>
  {#each [1, 2, 3, 4, 5] as n}<span class:filled={n <= value} style={`--i:${n}`}
      ><Star size={large ? 30 : 15} weight={n <= value ? 'fill' : 'regular'} /></span
    >{/each}
</span>

<style>
  .stars {
    display: inline-flex;
    gap: 3px;
    color: var(--table-muted);
  }
  .filled {
    color: var(--table-orange);
  }
  .large {
    gap: 7px;
  }
  .large > span {
    animation: pop 0.35s ease-out both;
    animation-delay: calc(var(--i) * 70ms);
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.7);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .large > span {
      animation: none;
    }
  }
</style>
