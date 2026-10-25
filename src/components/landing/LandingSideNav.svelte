<script lang="ts">
  import LandingNavLinks from './LandingNavLinks.svelte';
</script>

<aside class="landing-side-nav" aria-label="Site sidebar">
  <a class="brand" href="/explore" aria-label="Zap Cooking home">
    <img src="/zapcooking-text-light.svg" class="logo-l" alt="" width="160" height="40" />
    <img src="/zapcooking-text-dark.svg" class="logo-d" alt="" width="160" height="40" />
  </a>
  <div class="navigation"><LandingNavLinks /></div>
</aside>

<style>
  .landing-side-nav {
    display: none;
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    width: 14rem;
    padding: 12px;
    overflow-y: auto;
    background: var(--color-bg-primary);
    border-right: 1px dashed var(--color-input-border);
    z-index: 20;
  }
  .brand {
    display: flex;
    align-items: center;
    min-height: var(--header-row-h, 51px);
    padding-left: 8px;
  }
  .navigation {
    margin-top: 37px;
  }
  .logo-d {
    display: none;
  }
  :global(html.dark) .logo-l {
    display: none;
  }
  :global(html.dark) .logo-d {
    display: block;
  }
  @media (min-width: 1024px) {
    .landing-side-nav {
      display: block;
    }
  }
  @media (min-width: 1280px) {
    .landing-side-nav {
      width: 20rem;
    }
  }
</style>
