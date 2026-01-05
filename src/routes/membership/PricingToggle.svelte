<script lang="ts">
  export let period: 'annual' | '2year';
  export let onPeriodChange: (period: 'annual' | '2year') => void;

  function handleToggle(newPeriod: 'annual' | '2year') {
    onPeriodChange(newPeriod);
  }
</script>

<!-- Mobile: Full-width stacked buttons, Desktop: Centered row -->
<div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2 sm:gap-3 mb-6 sm:mb-8 px-2 sm:px-0">
  <button
    on:click={() => handleToggle('annual')}
    type="button"
    class="flex-1 sm:flex-none px-5 sm:px-6 py-3 sm:py-3 rounded-full font-semibold text-sm sm:text-base transition-all duration-300
           focus:outline-none focus:ring-4 focus:ring-offset-2
           {period === 'annual'
             ? 'bg-primary text-white shadow-lg focus:ring-primary/50'
             : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 focus:ring-gray-500/30'}"
    aria-pressed={period === 'annual'}
  >
    Annual
  </button>
  
  <button
    on:click={() => handleToggle('2year')}
    type="button"
    class="flex-1 sm:flex-none px-5 sm:px-6 py-3 sm:py-3 rounded-full font-semibold text-sm sm:text-base transition-all duration-300
           focus:outline-none focus:ring-4 focus:ring-offset-2
           {period === '2year'
             ? 'bg-primary text-white shadow-lg focus:ring-primary/50'
             : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 focus:ring-gray-500/30'}"
    aria-pressed={period === '2year'}
  >
    <span class="flex items-center justify-center gap-1.5 sm:gap-2">
      <span>2-Year</span>
      <span class="text-xs px-1.5 sm:px-2 py-0.5 rounded-full {period === '2year' ? 'bg-white/20' : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'}">
        Save More
      </span>
    </span>
  </button>
</div>
