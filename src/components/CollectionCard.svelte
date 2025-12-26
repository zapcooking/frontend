<script lang="ts">
  export let title: string;
  export let subtitle: string;
  export let imageUrl: string | undefined = undefined;
  export let onClick: (() => void) | undefined = undefined;
</script>

<button
  on:click={onClick}
  type="button"
  class="flex-shrink-0 w-64 h-40 rounded-xl overflow-hidden relative group cursor-pointer transition-transform duration-200 hover:scale-[1.02]"
>
  <!-- Background Image -->
  <div
    class="absolute inset-0 bg-gradient-to-br from-primary/20 to-primary/40"
    style={imageUrl ? `background-image: url('${imageUrl}'); background-size: cover; background-position: center;` : ''}
  >
    <!-- Dark overlay for text readability -->
    <div class="absolute inset-0 bg-black/30 group-hover:bg-black/20 transition-colors"></div>
  </div>

  <!-- Content -->
  <div class="relative h-full flex flex-col justify-end p-4 text-white">
    <h3 class="!text-white text-lg font-bold mb-1">{title}</h3>
    <p class="text-sm text-white/90">{subtitle}</p>
  </div>
</button>

