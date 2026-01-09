<script lang="ts">
  export let size: 'sm' | 'md' | 'lg' | 'xl' = 'lg';

  const sizeClasses = {
    sm: 'w-32',
    md: 'w-52',
    lg: 'w-64',
    xl: 'w-80'
  };
</script>

<div class="{sizeClasses[size]}">
  <img src="/pan-animated-light.svg" alt="Loading" class="dark:hidden w-full" />
  <img src="/pan-animated-dark.svg" alt="Loading" class="hidden dark:block w-full" />
</div>
