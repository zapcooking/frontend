<script lang="ts">
  import ListIcon from 'phosphor-svelte/lib/List';
  import XIcon from 'phosphor-svelte/lib/X';
  import LandingNavLinks from './LandingNavLinks.svelte';
  import drawerScript from '$lib/landing/drawer.client.js?url';
</script>

<svelte:head><script type="module" src={drawerScript}></script></svelte:head>

<header class="landing-header">
  <a href="#main" class="skip-link">Skip to content</a>
  <div class="header-inner">
    <details class="mobile-navigation" data-landing-drawer>
      <summary aria-label="Navigation menu" aria-controls="landing-mobile-navigation">
        <span class="open-icon"><ListIcon size={24} /></span><span class="close-icon"
          ><XIcon size={24} /></span
        >
      </summary>
      <div class="drawer-panel" id="landing-mobile-navigation">
        <a href="/explore" class="drawer-brand" aria-label="Zap Cooking home">
          <img src="/zapcooking-text-light.svg" class="logo-l" alt="" width="160" height="40" />
          <img src="/zapcooking-text-dark.svg" class="logo-d" alt="" width="160" height="40" />
        </a>
        <LandingNavLinks label="Mobile navigation" />
      </div>
    </details>
    <h1 class="page-name">Explore</h1>
    <div class="account">
      <a href="/login" data-landing-guest hidden>Sign in</a>
      <a href="/login?join=1" class="join" data-landing-guest hidden>Join free</a>
    </div>
  </div>
</header>

<style>
  .landing-header {
    position: relative;
    z-index: 30;
    border-bottom: 1px solid var(--color-input-border);
    background: var(--color-bg-primary);
  }
  .header-inner {
    max-width: 1200px;
    margin: auto;
    min-height: calc(var(--header-row-h, 51px) + 24px);
    padding: 12px 26px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .page-name {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    line-height: 1.2;
  }
  .account {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 18px;
    font-size: 14px;
    font-weight: 600;
  }
  .account a {
    min-width: 44px;
    min-height: 44px;
    align-items: center;
  }
  .account a:not([hidden]) {
    display: inline-flex;
  }
  .join {
    background: var(--color-primary);
    color: white !important;
    padding: 0 18px;
    border-radius: 999px;
  }
  .mobile-navigation > summary {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    cursor: pointer;
    list-style: none;
    border-radius: 12px;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  .close-icon {
    display: none;
  }
  .mobile-navigation[open] .close-icon {
    display: block;
  }
  .mobile-navigation[open] .open-icon {
    display: none;
  }
  .drawer-panel {
    position: fixed;
    top: calc(var(--header-row-h, 51px) + 24px);
    bottom: 0;
    left: 0;
    width: min(20rem, 88vw);
    padding: 12px;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--color-bg-primary);
    border-right: 1px solid var(--color-input-border);
    box-shadow: 12px 8px 24px #0002;
  }
  .drawer-brand {
    display: flex;
    align-items: center;
    min-height: 56px;
    padding-left: 12px;
    margin-bottom: 16px;
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
  summary:focus-visible {
    outline: 3px solid var(--color-primary);
    outline-offset: 3px;
  }
  .skip-link {
    position: absolute;
    left: -9999px;
  }
  .skip-link:focus {
    left: 16px;
    top: 8px;
    z-index: 40;
    padding: 12px;
    background: var(--color-bg-primary);
  }
  @media (min-width: 1024px) {
    .mobile-navigation {
      display: none;
    }
  }
  @media (max-width: 767px) {
    .header-inner {
      padding: 8px 16px;
      min-height: 64px;
    }
    .drawer-panel {
      top: 64px;
    }
    .account {
      gap: 12px;
    }
    .join {
      padding: 0 14px;
    }
  }
</style>
