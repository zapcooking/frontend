<script lang="ts">
  /**
   * A landing-page image: sized through the routing table, fixed aspect
   * ratio (no layout shift), lazy unless it's the hero.
   */
  import { responsiveImg } from '$lib/landing/responsiveImg';

  export let url: string;
  export let alt: string;
  export let widths: number[] = [320, 640, 960];
  export let sizes = '100vw';
  /** CSS aspect-ratio, e.g. '4 / 3'. */
  export let ratio = '1 / 1';
  /** The LCP image: eager + fetchpriority=high. */
  export let hero = false;
  export let rounded = 'rounded-xl';

  $: img = responsiveImg(url, widths, sizes);
</script>

<img
  src={img.src}
  srcset={img.srcset}
  sizes={img.srcset ? img.sizes : undefined}
  {alt}
  loading={hero ? 'eager' : 'lazy'}
  fetchpriority={hero ? 'high' : undefined}
  decoding="async"
  class="landing-img block w-full object-cover {rounded}"
  style="aspect-ratio: {ratio};"
/>

<style>
  .landing-img {
    background-color: var(--color-card-sunken);
  }
</style>
