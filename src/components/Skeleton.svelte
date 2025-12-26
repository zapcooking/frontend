<script lang="ts">
  export let width: string | number = '100%';
  export let height: string | number = '1rem';
  export let borderRadius: string = '0.25rem';
  export let className: string = '';
  export let animate: boolean = true;
  export let variant: 'default' | 'circular' | 'rectangular' = 'default';

  // Convert width and height to CSS values
  $: widthValue = typeof width === 'number' ? `${width}px` : width;
  $: heightValue = typeof height === 'number' ? `${height}px` : height;
  
  // Set border radius based on variant
  $: borderRadiusValue = variant === 'circular' ? '50%' : 
                        variant === 'rectangular' ? '0' : 
                        borderRadius;
</script>

<div 
  class="skeleton {className}"
  class:animate={animate}
  style="width: {widthValue}; height: {heightValue}; border-radius: {borderRadiusValue};"
></div>

<style>
  .skeleton {
    background: linear-gradient(90deg, var(--color-skeleton-base) 25%, var(--color-skeleton-highlight) 50%, var(--color-skeleton-base) 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
  }

  .skeleton.animate {
    animation: shimmer 1.5s infinite;
  }


  @keyframes shimmer {
    0% {
      background-position: -200% 0;
    }
    100% {
      background-position: 200% 0;
    }
  }

  /* Disable animation for users who prefer reduced motion */
  @media (prefers-reduced-motion: reduce) {
    .skeleton {
      animation: none;
      background: var(--color-skeleton-base);
    }

  }
</style>
