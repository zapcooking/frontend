<script lang="ts">
  export let size: number = 20;
  export let active: boolean = false;
  let className = '';
  export { className as class };
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  class={`intelligence-icon ${active ? 'is-active' : ''} ${className}`}
  aria-hidden="true"
>
  <g class="orbit-group">
    <ellipse
      cx="12"
      cy="12"
      rx="10"
      ry="3.5"
      stroke="currentColor"
      stroke-width="1.25"
      stroke-linecap="round"
      opacity="0.85"
    />
    <circle cx="2" cy="12" r="1.25" fill="currentColor" />
    <circle cx="22" cy="12" r="1.25" fill="currentColor" />
  </g>

  <path
    class="spark"
    d="M12 7.5 L12.9 11.1 L16.5 12 L12.9 12.9 L12 16.5 L11.1 12.9 L7.5 12 L11.1 11.1 Z"
    fill="currentColor"
  />
</svg>

<style>
  .intelligence-icon {
    display: block;
    color: currentColor;
    transition: filter 200ms ease;
  }

  .orbit-group {
    transform-origin: 12px 12px;
    transform-box: fill-box;
  }

  .spark {
    transform-origin: 12px 12px;
    transform-box: fill-box;
  }

  .is-active {
    filter:
      drop-shadow(0 0 3px rgba(168, 85, 247, 0.7))
      drop-shadow(0 0 7px rgba(168, 85, 247, 0.4));
  }

  .is-active .orbit-group {
    animation: orbit-rotate 6s linear infinite;
  }

  .is-active .spark {
    animation: spark-pulse 2.4s ease-in-out infinite;
  }

  @keyframes orbit-rotate {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  @keyframes spark-pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.12); opacity: 0.92; }
  }

  @media (prefers-reduced-motion: reduce) {
    .is-active .orbit-group,
    .is-active .spark {
      animation: none;
    }
  }
</style>
