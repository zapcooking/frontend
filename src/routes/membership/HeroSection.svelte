<script lang="ts">
  import LightningIcon from 'phosphor-svelte/lib/Lightning';
</script>

<div class="text-center py-6 sm:py-8 lg:py-12">
  <!-- Title with lightning icons - hide icons on very small screens -->
  <div class="flex items-center justify-center gap-2 sm:gap-3 mb-3 sm:mb-4">
    <LightningIcon size={24} weight="fill" class="text-primary hidden sm:block sm:w-8 sm:h-8" />
    <h1 class="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 dark:text-white">
      Choose Your Kitchen
    </h1>
    <LightningIcon size={24} weight="fill" class="text-primary hidden sm:block sm:w-8 sm:h-8" />
  </div>
  
  <!-- Subtitle -->
  <p class="text-base sm:text-lg md:text-xl lg:text-2xl text-gray-600 dark:text-gray-400 max-w-3xl mx-auto mt-2 sm:mt-4 px-2">
    Join a community where food culture lives openly. Support creators directly with Bitcoin or card. No algorithms. No ads.
  </p>

  <!-- Payment Methods Badge -->
  <div class="flex items-center justify-center gap-4 mt-4 sm:mt-6">
    <div class="flex items-center gap-2 px-4 py-2 bg-orange-100 dark:bg-orange-900/30 rounded-full">
      <span class="text-orange-600 dark:text-orange-400 font-medium text-sm">⚡ Lightning</span>
    </div>
    <div class="flex items-center gap-2 px-4 py-2 bg-blue-100 dark:bg-blue-900/30 rounded-full">
      <span class="text-blue-600 dark:text-blue-400 font-medium text-sm">💳 Card</span>
    </div>
  </div>
</div>
