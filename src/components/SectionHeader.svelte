<script lang="ts">
  export let title: string;
  export let subtitle: string | undefined = undefined;
  export let emoji: string | undefined = undefined;
  export let actionLink: { text: string; href: string } | undefined = undefined;
  export let onClick: (() => void) | undefined = undefined;
  export let disabled: boolean = false;
</script>

<div class="flex items-start justify-between gap-4 mb-4">
  <div 
    class="flex-1"
    class:cursor-pointer={onClick !== undefined && !disabled}
    class:hover:opacity-80={onClick !== undefined && !disabled}
    class:opacity-50={disabled}
    on:click={onClick}
    role={onClick ? "button" : undefined}
    tabindex={onClick && !disabled ? 0 : undefined}
    on:keydown={(e) => {
      if (onClick && !disabled && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        onClick();
      }
    }}
  >
    <h2 class="text-2xl font-bold flex items-center gap-2 mb-1">
      {#if emoji}
        <span>{emoji}</span>
      {/if}
      <span>{title}</span>
    </h2>
    {#if subtitle}
      <p class="text-sm text-gray-500 mt-1">{subtitle}</p>
    {/if}
  </div>
  {#if actionLink}
    <a
      href={actionLink.href}
      class="flex-shrink-0 text-sm text-primary hover:underline font-medium whitespace-nowrap"
    >
      {actionLink.text} →
    </a>
  {/if}
</div>












