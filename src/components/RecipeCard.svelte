<script lang="ts">
  import type { NDKEvent } from '@nostr-dev-kit/ndk';
  import { nip19 } from 'nostr-tools';
  import { onMount } from 'svelte';

  export let event: NDKEvent;
  export let list = false;

  let link = '';
  $: {
    if (event) {
      const d = event.tags.find((t) => t[0] == 'd')?.[1];
      if (d) {
        const naddr = nip19.naddrEncode({
          identifier: d,
          kind: event.kind,
          pubkey: event.author.pubkey
        });
        link = `/${list ? 'list' : 'recipe'}/${naddr}`;
      }
    }
  }

  // TODO FIX TYPES HERE
  let imageElement;

  onMount(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const lazyImage = entry.target;
          lazyImage.style.backgroundImage = `url('${
            event.tags.find((e) => e[0] == 'image')?.[1] || ''
          }')`;
          observer.unobserve(lazyImage);
        }
      });
    });

    observer.observe(imageElement);
  });
</script>

<a
  href={link}
  class="flex flex-col gap-4 max-w-[160px] place-self-center md:place-self-start self-start hover:text-primary transition-colors duration-300"
>
  <div class="relative image" style={`background-image: url('/placeholder.png');`}>
    <div
      bind:this={imageElement}
      class="absolute top-0 left-0 bottom-0 right-0 image hover:scale-105 transition-transform duration-700 ease-in-out"
    />
  </div>

  <h5 class="text-md leading-tight text-wrap">
    {#if event?.tags.find((e) => e[0] == 'title')?.[0] && event?.tags.find((e) => e[0] == 'title')?.[1]}
      {event.tags.find((e) => e[0] == 'title')?.[1]}
    {:else}
      {event.tags.find((e) => e[0] == 'd')?.[1]}
    {/if}
  </h5>
</a>

<style lang="postcss">
  .image {
    @apply rounded-2xl w-[160px] h-[237px] cursor-pointer relative overflow-hidden object-cover bg-cover bg-center aspect-auto before:animate-pulse;
  }
</style>
