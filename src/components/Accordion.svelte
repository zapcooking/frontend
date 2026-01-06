<script lang="ts">
  import CaretDownIcon from 'phosphor-svelte/lib/CaretDown';

  export let title: string = '';
  export let open: boolean = false;
  export let variant: 'default' | 'danger' = 'default';

  function toggle() {
    open = !open;
  }
</script>

<div class="rounded-lg border border-[var(--color-input-border)] overflow-hidden">
  <button
    type="button"
    class="w-full flex items-center justify-between px-4 py-3 text-left font-medium transition-colors
      {variant === 'danger' ? 'hover:bg-red-50 dark:hover:bg-red-900/20' : 'hover:bg-[var(--color-input-bg)]'}"
    style="color: var(--color-text-primary)"
    on:click={toggle}
  >
    <span class="{variant === 'danger' ? 'text-red-600 dark:text-red-400' : ''}">{title}</span>
    <CaretDownIcon
      size={18}
      class="transition-transform duration-200 {open ? 'rotate-180' : ''}"
    />
  </button>

  {#if open}
    <div class="px-4 pb-4 pt-2 border-t border-[var(--color-input-border)]">
      <slot />
    </div>
  {/if}
</div>
