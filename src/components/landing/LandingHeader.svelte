<script lang="ts">
  import ListIcon from 'phosphor-svelte/lib/List';
  import XIcon from 'phosphor-svelte/lib/X';
  import MagnifyingGlass from 'phosphor-svelte/lib/MagnifyingGlass';
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
          <img src="/zapcooking-text-light.svg" class="logo-l" alt="" width="160" height="22" />
          <img src="/zapcooking-text-dark.svg" class="logo-d" alt="" width="160" height="22" />
        </a>
        <LandingNavLinks label="Mobile navigation" />
      </div>
    </details>
    <span class="page-name">Explore</span>
    <form action="/search" method="GET" class="header-search" role="search">
      <label for="recipe-search" class="sr-only">Search recipes</label>
      <input type="hidden" name="type" value="recipes" />
      <span class="search-icon" aria-hidden="true"><MagnifyingGlass size={20} /></span>
      <input
        id="recipe-search"
        type="search"
        name="q"
        placeholder="What would you like to cook?"
        required
      />
      <button type="submit" aria-label="Search recipes">Search</button>
    </form>
    <div class="account">
      <a href="/login" class="sign-in" data-landing-guest hidden>Sign in</a>
      <a href="/login?join=1" class="join" data-landing-guest hidden>Join free</a>
      <a href="/my-kitchen" class="sign-in" data-landing-account hidden>My Kitchen</a>
    </div>
  </div>
</header>

<style>
  .landing-header {
    --landing-header-height: 80px;
    position: relative;
    z-index: 30;
    border-bottom: 1px solid var(--color-input-border);
    background: var(--color-explore-cream, var(--color-bg-primary));
  }
  .header-inner {
    max-width: 1200px;
    margin: auto;
    min-height: var(--landing-header-height);
    padding: 16px 32px;
    display: grid;
    grid-template-columns: 44px auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 16px;
  }
  .page-name {
    font-size: 17px;
    font-weight: 600;
    line-height: 1.2;
  }
  .header-search {
    display: flex;
    align-items: center;
    min-width: 0;
    min-height: 48px;
    background: var(--color-bg-primary);
    border: 1px solid var(--color-input-border);
    border-radius: 999px;
  }
  .search-icon {
    display: flex;
    margin-left: 16px;
    color: var(--color-caption);
  }
  .header-search input[type='search'] {
    min-height: 44px;
    width: 100%;
    min-width: 0;
    border: 0;
    background: transparent;
    padding: 12px 10px;
    font: inherit;
    font-size: 14px;
    color: var(--color-text-primary);
  }
  .header-search input::placeholder {
    color: var(--color-caption);
    opacity: 1;
  }
  .header-search button {
    align-self: stretch;
    min-width: 68px;
    padding: 0 16px;
    border-left: 1px solid var(--color-input-border);
    border-radius: 0 999px 999px 0;
    color: var(--color-primary);
    font-size: 13px;
    font-weight: 650;
  }
  .account {
    display: flex;
    align-items: center;
    justify-content: end;
    gap: 8px;
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
  }
  .account a {
    min-width: 44px;
    min-height: 44px;
    align-items: center;
    justify-content: center;
    padding: 0 14px;
    border-radius: 999px;
  }
  .account a:not([hidden]) {
    display: inline-flex;
  }
  .sign-in {
    border: 1px solid var(--color-input-border);
  }
  .join {
    background: var(--color-primary);
    color: white !important;
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
    top: calc(var(--landing-header-height) + 1px);
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
  .drawer-brand img {
    height: auto;
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
  summary:focus-visible,
  .header-search input:focus-visible,
  .header-search button:focus-visible {
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
    .header-inner {
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 24px;
    }
    .mobile-navigation {
      display: none;
    }
  }
  @media (max-width: 767px) {
    .landing-header {
      --landing-header-height: 124px;
    }
    .header-inner {
      padding: 12px 20px;
      grid-template-columns: 44px auto 1fr;
      gap: 8px;
    }
    .header-search {
      grid-column: 1 / -1;
      grid-row: 2;
    }
    .account {
      grid-column: 3;
      grid-row: 1;
      gap: 6px;
    }
    .account a {
      padding: 0 12px;
    }
    .search-icon {
      margin-left: 14px;
    }
    .header-search input[type='search'] {
      font-size: 13px;
    }
    .header-search button {
      padding: 0 14px;
    }
  }
</style>
